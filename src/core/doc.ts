import * as Y from 'yjs'
import { between, sortByFrac, type Frac } from './frac'
import { coordsFromJSON, coordsToJSON, type Coords } from './geo'
import {
  asId,
  type ActorId,
  type Category,
  type Checklist,
  type ChecklistItem,
  type Day,
  type DayId,
  type Expense,
  type ItemId,
  type Leg,
  type Photo,
  type Place,
  type PlaceId,
  type PlaceRef,
  type Reservation,
  type ReservationKind,
  type TravelMode,
  type Trip,
  type TripId,
} from './types'

/**
 * The document.
 *
 * Every collaborative field lives in a Yjs type so that concurrent edits merge
 * rather than clobber. Place notes are `Y.Text` specifically — two people
 * typing in the same note is a normal thing to do on a trip plan, and
 * last-writer-wins would silently drop one of them.
 *
 * Ordering is never an array index. Cards carry a fractional key, so a drag
 * writes one field and two people rearranging different parts of the same day
 * never collide.
 */

export const ROOT = {
  meta: 'meta',
  places: 'places',
  days: 'days',
  checklists: 'checklists',
  reservations: 'reservations',
  expenses: 'expenses',
  legs: 'legs',
} as const

type YMapAny = Y.Map<unknown>

export function metaOf(doc: Y.Doc): YMapAny {
  return doc.getMap(ROOT.meta)
}
export function placesOf(doc: Y.Doc): Y.Map<YMapAny> {
  return doc.getMap(ROOT.places)
}
export function daysOf(doc: Y.Doc): Y.Map<YMapAny> {
  return doc.getMap(ROOT.days)
}
export function checklistsOf(doc: Y.Doc): Y.Map<YMapAny> {
  return doc.getMap(ROOT.checklists)
}
export function reservationsOf(doc: Y.Doc): Y.Map<YMapAny> {
  return doc.getMap(ROOT.reservations)
}
export function expensesOf(doc: Y.Doc): Y.Map<YMapAny> {
  return doc.getMap(ROOT.expenses)
}
export function legsOf(doc: Y.Doc): YMapAny {
  return doc.getMap(ROOT.legs)
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

function str(m: YMapAny, k: string, fallback = ''): string {
  const v = m.get(k)
  return typeof v === 'string' ? v : fallback
}
function num(m: YMapAny, k: string): number | undefined {
  const v = m.get(k)
  return typeof v === 'number' ? v : undefined
}
function bool(m: YMapAny, k: string): boolean {
  return m.get(k) === true
}
function text(m: YMapAny, k: string): string {
  const v = m.get(k)
  return v instanceof Y.Text ? v.toString() : typeof v === 'string' ? v : ''
}

function readPlace(id: string, m: YMapAny): Place | null {
  const coordsJson = m.get('coords')
  if (!coordsJson || typeof coordsJson !== 'object') return null
  const dayId = m.get('dayId')
  return {
    id: asId<'place'>(id),
    dayId: typeof dayId === 'string' ? asId<'day'>(dayId) : null,
    frac: str(m, 'frac', '1'),
    name: str(m, 'name'),
    address: str(m, 'address'),
    category: (str(m, 'category', 'other') as Category) ?? 'other',
    coords: coordsFromJSON(coordsJson as never),
    rating: num(m, 'rating'),
    ratingCount: num(m, 'ratingCount'),
    photos: (m.get('photos') as Photo[] | undefined) ?? [],
    notes: text(m, 'notes'),
    cost: num(m, 'cost'),
    startTime: str(m, 'startTime') || undefined,
    durationMin: num(m, 'durationMin'),
    website: str(m, 'website') || undefined,
    phone: str(m, 'phone') || undefined,
    ref: (m.get('ref') as PlaceRef | undefined) ?? undefined,
    pending: bool(m, 'pending'),
    createdBy: asId<'actor'>(str(m, 'createdBy')),
    createdAt: num(m, 'createdAt') ?? 0,
  }
}

export function legKey(from: PlaceId, to: PlaceId, mode: TravelMode): string {
  return `${from}|${to}|${mode}`
}

interface CachedLeg {
  durationSec: number
  distanceM: number
  polyline?: string
  provider: string
  at: number
}

function readLegs(doc: Y.Doc, stops: readonly Place[], mode: TravelMode): Leg[] {
  const cache = legsOf(doc)
  const out: Leg[] = []
  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i].id
    const to = stops[i + 1].id
    const hit = cache.get(legKey(from, to, mode)) as CachedLeg | undefined
    out.push({
      from,
      to,
      mode,
      durationSec: hit?.durationSec ?? null,
      distanceM: hit?.distanceM ?? null,
      polyline: hit?.polyline,
      pending: !hit,
    })
  }
  return out
}

export function readTrip(doc: Y.Doc, id: TripId): Trip {
  const meta = metaOf(doc)

  const allPlaces: Place[] = []
  placesOf(doc).forEach((m, key) => {
    const p = readPlace(key, m)
    if (p) allPlaces.push(p)
  })

  const byFrac = (p: Place | Day) => [p.frac, p.id] as const
  const sortedPlaces = sortByFrac(allPlaces, byFrac)

  const rawDays: { id: DayId; frac: Frac; date: string | null; title: string }[] = []
  daysOf(doc).forEach((m, key) => {
    rawDays.push({
      id: asId<'day'>(key),
      frac: str(m, 'frac', '1'),
      date: str(m, 'date') || null,
      title: str(m, 'title'),
    })
  })
  const sortedDays = sortByFrac(rawDays, (d) => [d.frac, d.id] as const)

  const mode = (str(meta, 'travelMode', 'drive') as TravelMode) || 'drive'

  const days: Day[] = sortedDays.map((d, i) => {
    const stops = sortedPlaces.filter((p) => p.dayId === d.id)
    return {
      ...d,
      number: i + 1,
      stops,
      legs: readLegs(doc, stops, mode),
      subtotal: stops.reduce((sum, p) => sum + (p.cost ?? 0), 0),
    }
  })

  const wishlist = sortedPlaces.filter((p) => p.dayId === null)

  const checklists: Checklist[] = []
  checklistsOf(doc).forEach((m, key) => {
    const itemsMap = m.get('items')
    const items: ChecklistItem[] = []
    if (itemsMap instanceof Y.Map) {
      itemsMap.forEach((im: YMapAny, ik: string) => {
        items.push({
          id: asId<'item'>(ik),
          frac: str(im, 'frac', '1'),
          text: str(im, 'text'),
          done: bool(im, 'done'),
        })
      })
    }
    checklists.push({
      id: asId<'item'>(key),
      frac: str(m, 'frac', '1'),
      title: str(m, 'title'),
      items: sortByFrac(items, (i) => [i.frac, i.id] as const),
    })
  })

  const reservations: Reservation[] = []
  reservationsOf(doc).forEach((m, key) => {
    reservations.push({
      id: asId<'item'>(key),
      frac: str(m, 'frac', '1'),
      kind: (str(m, 'kind', 'other') as ReservationKind) ?? 'other',
      title: str(m, 'title'),
      confirmation: str(m, 'confirmation'),
      start: str(m, 'start') || null,
      end: str(m, 'end') || null,
      from: str(m, 'from'),
      to: str(m, 'to'),
      cost: num(m, 'cost'),
      notes: text(m, 'notes'),
    })
  })

  const expenses: Expense[] = []
  expensesOf(doc).forEach((m, key) => {
    const dayId = m.get('dayId')
    const placeId = m.get('placeId')
    expenses.push({
      id: asId<'item'>(key),
      frac: str(m, 'frac', '1'),
      title: str(m, 'title'),
      amount: num(m, 'amount') ?? 0,
      category: (str(m, 'category', 'other') as Category) ?? 'other',
      paidBy: str(m, 'paidBy'),
      dayId: typeof dayId === 'string' ? asId<'day'>(dayId) : null,
      placeId: typeof placeId === 'string' ? asId<'place'>(placeId) : null,
    })
  })

  // Place costs and standalone expenses are one budget. Counting them
  // separately is the classic way a trip's total quietly stops adding up.
  const byCategory: Partial<Record<Category, number>> = {}
  let total = 0
  for (const p of sortedPlaces) {
    if (!p.cost) continue
    byCategory[p.category] = (byCategory[p.category] ?? 0) + p.cost
    total += p.cost
  }
  for (const e of expenses) {
    if (e.placeId) continue // already counted through the place
    byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount
    total += e.amount
  }

  return {
    id,
    title: str(meta, 'title', 'Untitled trip'),
    startDate: str(meta, 'startDate') || null,
    endDate: str(meta, 'endDate') || null,
    currency: str(meta, 'currency', 'USD'),
    coverUrl: str(meta, 'coverUrl') || null,
    summary: text(meta, 'summary'),
    days,
    wishlist,
    places: sortedPlaces,
    checklists: sortByFrac(checklists, (c) => [c.frac, c.id] as const),
    reservations: sortByFrac(reservations, (r) => [r.frac, r.id] as const),
    expenses: sortByFrac(expenses, (e) => [e.frac, e.id] as const),
    budget: { total, byCategory },
  }
}

/* -------------------------------------------------------------------------- */
/* Ordering helpers                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A key placing a card at `index` within `siblings`. Passing the list's own
 * length appends. The moved card is excluded first so that dragging a card two
 * slots down inside its own list lands where the user dropped it rather than
 * one slot short.
 */
export function fracForIndex(
  siblings: readonly { id: string; frac: Frac }[],
  index: number,
  movingId?: string,
): Frac {
  const others = movingId ? siblings.filter((s) => s.id !== movingId) : siblings
  const clamped = Math.max(0, Math.min(index, others.length))
  const before = clamped > 0 ? others[clamped - 1].frac : null
  const after = clamped < others.length ? others[clamped].frac : null
  return between(before, after)
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

export interface NewPlace {
  name: string
  address?: string
  category?: Category
  coords: Coords
  rating?: number
  ratingCount?: number
  photos?: Photo[]
  notes?: string
  cost?: number
  website?: string
  phone?: string
  ref?: PlaceRef
  pending?: boolean
}

export function createPlace(
  doc: Y.Doc,
  id: PlaceId,
  actor: ActorId,
  input: NewPlace,
  dayId: DayId | null,
  frac: Frac,
): void {
  const m = new Y.Map<unknown>()
  const notes = new Y.Text()
  if (input.notes) notes.insert(0, input.notes)

  m.set('dayId', dayId)
  m.set('frac', frac)
  m.set('name', input.name)
  m.set('address', input.address ?? '')
  m.set('category', input.category ?? 'other')
  m.set('coords', coordsToJSON(input.coords))
  if (input.rating !== undefined) m.set('rating', input.rating)
  if (input.ratingCount !== undefined) m.set('ratingCount', input.ratingCount)
  m.set('photos', input.photos ?? [])
  m.set('notes', notes)
  if (input.cost !== undefined) m.set('cost', input.cost)
  if (input.website) m.set('website', input.website)
  if (input.phone) m.set('phone', input.phone)
  if (input.ref) m.set('ref', input.ref)
  m.set('pending', input.pending ?? false)
  m.set('createdBy', actor)
  m.set('createdAt', Date.now())

  placesOf(doc).set(id, m)
}

export type PlacePatch = Partial<
  Pick<
    Place,
    | 'name'
    | 'address'
    | 'category'
    | 'rating'
    | 'ratingCount'
    | 'cost'
    | 'startTime'
    | 'durationMin'
    | 'website'
    | 'phone'
    | 'pending'
  >
> & { coords?: Coords; photos?: Photo[]; ref?: PlaceRef }

export function patchPlace(doc: Y.Doc, id: PlaceId, patch: PlacePatch): void {
  const m = placesOf(doc).get(id)
  if (!m) return
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (k === 'coords') m.set('coords', coordsToJSON(v as Coords))
    else m.set(k, v)
  }
}

/**
 * Replace a place's notes.
 *
 * The diff is deliberate: rewriting the whole `Y.Text` on every keystroke
 * would destroy a collaborator's concurrent edit and reset their cursor. This
 * finds the common prefix and suffix and touches only the span that changed.
 */
export function setPlaceNotes(doc: Y.Doc, id: PlaceId, next: string): void {
  const m = placesOf(doc).get(id)
  if (!m) return
  const t = m.get('notes')
  if (!(t instanceof Y.Text)) {
    const fresh = new Y.Text()
    fresh.insert(0, next)
    m.set('notes', fresh)
    return
  }
  spliceText(t, next)
}

export function spliceText(t: Y.Text, next: string): void {
  const prev = t.toString()
  if (prev === next) return

  let start = 0
  const max = Math.min(prev.length, next.length)
  while (start < max && prev[start] === next[start]) start++

  let end = 0
  while (
    end < max - start &&
    prev[prev.length - 1 - end] === next[next.length - 1 - end]
  ) {
    end++
  }

  const removed = prev.length - start - end
  if (removed > 0) t.delete(start, removed)
  const added = next.slice(start, next.length - end)
  if (added) t.insert(start, added)
}

/** Move a card to a day (or to the wishlist when `dayId` is null). */
export function movePlace(doc: Y.Doc, id: PlaceId, dayId: DayId | null, frac: Frac): void {
  const m = placesOf(doc).get(id)
  if (!m) return
  m.set('dayId', dayId)
  m.set('frac', frac)
}

export function removePlace(doc: Y.Doc, id: PlaceId): void {
  placesOf(doc).delete(id)
  // Legs referencing the card are dead weight; drop them so a re-added place
  // does not inherit a stale drive time.
  const legs = legsOf(doc)
  for (const key of [...legs.keys()]) {
    if (key.startsWith(`${id}|`) || key.includes(`|${id}|`)) legs.delete(key)
  }
}

export function cacheLeg(
  doc: Y.Doc,
  from: PlaceId,
  to: PlaceId,
  mode: TravelMode,
  leg: CachedLeg,
): void {
  legsOf(doc).set(legKey(from, to, mode), leg)
}

export function createDay(doc: Y.Doc, id: DayId, frac: Frac, date: string | null): void {
  const m = new Y.Map<unknown>()
  m.set('frac', frac)
  m.set('date', date ?? '')
  m.set('title', '')
  daysOf(doc).set(id, m)
}

export function patchDay(
  doc: Y.Doc,
  id: DayId,
  patch: { title?: string; date?: string | null; frac?: Frac },
): void {
  const m = daysOf(doc).get(id)
  if (!m) return
  if (patch.title !== undefined) m.set('title', patch.title)
  if (patch.date !== undefined) m.set('date', patch.date ?? '')
  if (patch.frac !== undefined) m.set('frac', patch.frac)
}

/** Remove a day. Its stops fall back to the wishlist rather than vanishing. */
export function removeDay(doc: Y.Doc, id: DayId): void {
  const places = placesOf(doc)
  places.forEach((m) => {
    if (m.get('dayId') === id) m.set('dayId', null)
  })
  daysOf(doc).delete(id)
}

export function setMeta(
  doc: Y.Doc,
  patch: Partial<{
    title: string
    startDate: string | null
    endDate: string | null
    currency: string
    coverUrl: string | null
    travelMode: TravelMode
  }>,
): void {
  const m = metaOf(doc)
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    m.set(k, v ?? '')
  }
}

export function setSummary(doc: Y.Doc, next: string): void {
  const m = metaOf(doc)
  const t = m.get('summary')
  if (!(t instanceof Y.Text)) {
    const fresh = new Y.Text()
    fresh.insert(0, next)
    m.set('summary', fresh)
    return
  }
  spliceText(t, next)
}

/* -------------------------------------------------------------------------- */
/* Generic list sections                                                      */
/* -------------------------------------------------------------------------- */

export function upsertRecord(
  map: Y.Map<YMapAny>,
  id: string,
  fields: Record<string, unknown>,
): void {
  let m = map.get(id)
  if (!m) {
    m = new Y.Map<unknown>()
    map.set(id, m)
  }
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue
    m.set(k, v)
  }
}

export function createChecklist(doc: Y.Doc, id: ItemId, frac: Frac, title: string): void {
  const m = new Y.Map<unknown>()
  m.set('frac', frac)
  m.set('title', title)
  m.set('items', new Y.Map<unknown>())
  checklistsOf(doc).set(id, m)
}

export function addChecklistItem(
  doc: Y.Doc,
  listId: ItemId,
  itemId: ItemId,
  frac: Frac,
  text: string,
): void {
  const list = checklistsOf(doc).get(listId)
  const items = list?.get('items')
  if (!(items instanceof Y.Map)) return
  const m = new Y.Map<unknown>()
  m.set('frac', frac)
  m.set('text', text)
  m.set('done', false)
  items.set(itemId, m)
}

export function patchChecklistItem(
  doc: Y.Doc,
  listId: ItemId,
  itemId: ItemId,
  patch: { text?: string; done?: boolean },
): void {
  const list = checklistsOf(doc).get(listId)
  const items = list?.get('items')
  if (!(items instanceof Y.Map)) return
  const m = items.get(itemId) as YMapAny | undefined
  if (!m) return
  if (patch.text !== undefined) m.set('text', patch.text)
  if (patch.done !== undefined) m.set('done', patch.done)
}

export function removeChecklistItem(doc: Y.Doc, listId: ItemId, itemId: ItemId): void {
  const list = checklistsOf(doc).get(listId)
  const items = list?.get('items')
  if (items instanceof Y.Map) items.delete(itemId)
}
