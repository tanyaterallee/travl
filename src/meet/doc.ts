import * as Y from 'yjs'
import { coordsFromJSON, coordsToJSON, type Coords, type CoordsJSON } from '../core/geo'
import { asId, type BookingId, type SlotId } from '../core/types'
import { ms } from './schedule'
import {
  NO_SOURCE,
  type Booking,
  type BookingKind,
  type BusyEvent,
  type ItinerarySource,
  type MeetPage,
  type Slot,
  type SourceKind,
} from './types'

/**
 * The meet document.
 *
 * Same substrate as a trip — a Yjs document, persisted locally and optionally
 * relayed — for one reason that matters: a booking made by a guest on their
 * phone has to land on the owner's screen without either of them refreshing.
 * A REST endpoint would need a server, an account, and a migration; a shared
 * document needs the relay that already exists.
 *
 * Two shapes, chosen deliberately:
 *
 * **Slots and bookings are maps of maps.** Two guests booking two different
 * slots at the same moment write two different keys, so their edits merge
 * instead of one overwriting the other. This is the whole reason the booking
 * page can be handed to five people at once.
 *
 * **The imported itinerary is one plain array.** It is a *cache* of somebody
 * else's calendar, not collaborative state: re-importing should replace it
 * wholesale, and last-writer-wins is exactly the semantics wanted.
 */

export const MEET_ROOT = {
  page: 'meet:page',
  slots: 'meet:slots',
  bookings: 'meet:bookings',
} as const

type YMapAny = Y.Map<unknown>

export function pageOf(doc: Y.Doc): YMapAny {
  return doc.getMap(MEET_ROOT.page)
}
export function slotsOf(doc: Y.Doc): Y.Map<YMapAny> {
  return doc.getMap(MEET_ROOT.slots)
}
export function bookingsOf(doc: Y.Doc): Y.Map<YMapAny> {
  return doc.getMap(MEET_ROOT.bookings)
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

function str(m: YMapAny, k: string, fallback = ''): string {
  const v = m.get(k)
  return typeof v === 'string' ? v : fallback
}

function num(m: YMapAny, k: string, fallback = 0): number {
  const v = m.get(k)
  return typeof v === 'number' ? v : fallback
}

function readSlot(id: string, m: YMapAny): Slot | null {
  const start = str(m, 'start')
  const end = str(m, 'end')
  if (!start || !end) return null
  const coords = m.get('coords')
  return {
    id: asId<'slot'>(id),
    start,
    end,
    title: str(m, 'title'),
    locationName: str(m, 'locationName'),
    address: str(m, 'address'),
    coords: coords && typeof coords === 'object' ? coordsFromJSON(coords as CoordsJSON) : null,
    blurb: str(m, 'blurb'),
    gcalEventId: str(m, 'gcalEventId') || null,
    createdAt: num(m, 'createdAt'),
  }
}

function readBooking(id: string, m: YMapAny): Booking | null {
  const slotId = str(m, 'slotId')
  if (!slotId) return null
  const kind = str(m, 'kind', 'primary')
  return {
    id: asId<'booking'>(id),
    slotId: asId<'slot'>(slotId),
    name: str(m, 'name'),
    email: str(m, 'email'),
    kind: (kind === 'tentative' ? 'tentative' : 'primary') satisfies BookingKind,
    note: str(m, 'note'),
    createdAt: num(m, 'createdAt'),
    gcalEventId: str(m, 'gcalEventId') || null,
  }
}

function readSource(m: YMapAny): ItinerarySource {
  const raw = m.get('source')
  if (!raw || typeof raw !== 'object') return NO_SOURCE
  const s = raw as Partial<ItinerarySource>
  const kind = (s.kind ?? 'none') as SourceKind
  return {
    kind,
    label: s.label ?? '',
    url: s.url ?? '',
    calendarId: s.calendarId ?? '',
    importedAt: s.importedAt ?? 0,
  }
}

function readBusy(m: YMapAny): readonly BusyEvent[] {
  const raw = m.get('busy')
  if (!Array.isArray(raw)) return []
  return (raw as BusyEvent[])
    .filter((e) => typeof e?.start === 'string' && typeof e?.end === 'string')
    .sort((a, b) => ms(a.start) - ms(b.start))
}

export function readPage(doc: Y.Doc): MeetPage {
  const p = pageOf(doc)

  const slots: Slot[] = []
  slotsOf(doc).forEach((m, id) => {
    const slot = readSlot(id, m)
    if (slot) slots.push(slot)
  })
  slots.sort((a, b) => ms(a.start) - ms(b.start) || (a.id < b.id ? -1 : 1))

  const bookings: Booking[] = []
  bookingsOf(doc).forEach((m, id) => {
    const booking = readBooking(id, m)
    if (booking) bookings.push(booking)
  })
  bookings.sort((a, b) => a.createdAt - b.createdAt)

  return {
    title: str(p, 'title'),
    headline: str(p, 'headline'),
    ownerName: str(p, 'ownerName'),
    ownerEmail: str(p, 'ownerEmail'),
    ownerAvatar: str(p, 'ownerAvatar'),
    timezone: str(p, 'timezone'),
    syncCalendarId: str(p, 'syncCalendarId'),
    syncCalendarName: str(p, 'syncCalendarName'),
    slots,
    bookings,
    busy: readBusy(p),
    source: readSource(p),
  }
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

export type PagePatch = Partial<
  Pick<
    MeetPage,
    | 'title'
    | 'headline'
    | 'ownerName'
    | 'ownerEmail'
    | 'ownerAvatar'
    | 'timezone'
    | 'syncCalendarId'
    | 'syncCalendarName'
  >
>

export function setPage(doc: Y.Doc, patch: PagePatch): void {
  const p = pageOf(doc)
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) p.set(k, v)
  }
}

/**
 * Attach an itinerary. The events replace whatever was there: an import is a
 * fresh reading of the source, so a stop the owner deleted in Wanderlog has to
 * disappear here too rather than linger as a blocked afternoon.
 */
export function setItinerary(
  doc: Y.Doc,
  source: ItinerarySource,
  events: readonly BusyEvent[],
): void {
  const p = pageOf(doc)
  p.set('source', { ...source })
  p.set('busy', events.map((e) => ({ ...e })))
}

export function clearItinerary(doc: Y.Doc): void {
  const p = pageOf(doc)
  p.set('source', { ...NO_SOURCE })
  p.set('busy', [])
}

export interface NewSlot {
  start: string
  end: string
  title: string
  locationName?: string
  address?: string
  coords?: Coords | null
  blurb?: string
}

export function createSlot(doc: Y.Doc, id: SlotId, input: NewSlot): void {
  const m = new Y.Map<unknown>()
  m.set('start', input.start)
  m.set('end', input.end)
  m.set('title', input.title)
  m.set('locationName', input.locationName ?? '')
  m.set('address', input.address ?? '')
  if (input.coords) m.set('coords', coordsToJSON(input.coords))
  m.set('blurb', input.blurb ?? '')
  m.set('gcalEventId', '')
  m.set('createdAt', Date.now())
  slotsOf(doc).set(id, m)
}

export type SlotPatch = Partial<Omit<NewSlot, 'coords'>> & {
  coords?: Coords | null
  gcalEventId?: string | null
}

export function patchSlot(doc: Y.Doc, id: SlotId, patch: SlotPatch): void {
  const m = slotsOf(doc).get(id)
  if (!m) return
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (k === 'coords') {
      if (v === null) m.delete('coords')
      else m.set('coords', coordsToJSON(v as Coords))
    } else if (k === 'gcalEventId') {
      m.set('gcalEventId', v ?? '')
    } else {
      m.set(k, v)
    }
  }
}

/**
 * Removing a slot removes its bookings with it.
 *
 * A booking pointing at a slot that no longer exists is not merely untidy: it
 * would keep a guest's name on the owner's list with nothing to show them, and
 * `holdsOf` would keep counting it against that guest's one-primary limit.
 */
export function removeSlot(doc: Y.Doc, id: SlotId): void {
  slotsOf(doc).delete(id)
  const bookings = bookingsOf(doc)
  for (const key of [...bookings.keys()]) {
    if (bookings.get(key)?.get('slotId') === id) bookings.delete(key)
  }
}

export interface NewBooking {
  slotId: SlotId
  name: string
  email: string
  kind: BookingKind
  note?: string
}

export function createBooking(doc: Y.Doc, id: BookingId, input: NewBooking): void {
  const m = new Y.Map<unknown>()
  m.set('slotId', input.slotId)
  m.set('name', input.name.trim())
  m.set('email', input.email.trim())
  m.set('kind', input.kind)
  m.set('note', input.note ?? '')
  m.set('gcalEventId', '')
  m.set('createdAt', Date.now())
  bookingsOf(doc).set(id, m)
}

export function patchBooking(
  doc: Y.Doc,
  id: BookingId,
  patch: { kind?: BookingKind; note?: string; gcalEventId?: string | null },
): void {
  const m = bookingsOf(doc).get(id)
  if (!m) return
  if (patch.kind !== undefined) m.set('kind', patch.kind)
  if (patch.note !== undefined) m.set('note', patch.note)
  if (patch.gcalEventId !== undefined) m.set('gcalEventId', patch.gcalEventId ?? '')
}

export function removeBooking(doc: Y.Doc, id: BookingId): void {
  bookingsOf(doc).delete(id)
}
