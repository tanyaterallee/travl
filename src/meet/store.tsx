import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { asId, type BookingId, type SlotId, type SyncState } from '../core/types'
import {
  clearItinerary,
  createBooking,
  createSlot,
  patchBooking,
  patchSlot,
  removeBooking,
  removeSlot,
  setItinerary,
  setPage,
  type NewSlot,
  type PagePatch,
  type SlotPatch,
} from './doc'
import { MeetEngine } from './engine'
import { canBook, duplicateAt, holdsOf, type BookingProblem } from './schedule'
import type {
  Booking,
  BookingKind,
  BusyEvent,
  ItinerarySource,
  MeetMode,
  MeetPage,
  Slot,
} from './types'

const Ctx = createContext<MeetEngine | null>(null)

export function MeetProvider({
  pageId,
  mode,
  relayUrl,
  seed,
  children,
}: {
  pageId: string
  mode: MeetMode
  relayUrl?: string
  /** Populates a brand-new page. Ignored once it has any content. */
  seed?: (engine: MeetEngine) => void
  children: ReactNode
}) {
  const [engine, setEngine] = useState<MeetEngine | null>(null)

  useEffect(() => {
    const next = new MeetEngine({ pageId, mode, relayUrl })
    setEngine(next)
    return () => {
      next.destroy()
      setEngine(null)
    }
  }, [pageId, mode, relayUrl])

  // Seeding waits for IndexedDB. Seeding before the replay finishes would add
  // the example slots on top of the owner's real ones on every reload.
  const seeded = useRef(false)
  useEffect(() => {
    if (!engine || !seed || seeded.current || mode !== 'own') return
    seeded.current = true
    let cancelled = false
    void engine.whenReady.then(() => {
      if (cancelled) return
      const page = engine.getSnapshot()
      if (page.slots.length === 0 && page.bookings.length === 0) seed(engine)
    })
    return () => {
      cancelled = true
    }
  }, [engine, seed, mode])

  if (!engine) return null
  return <Ctx.Provider value={engine}>{children}</Ctx.Provider>
}

function useEngine(): MeetEngine {
  const engine = useContext(Ctx)
  if (!engine) throw new Error('meet hooks must be used inside <MeetProvider>')
  return engine
}

export function useMeetPage(): MeetPage {
  const engine = useEngine()
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot)
}

export function useMeetMode(): MeetMode {
  return useEngine().mode
}

export function useMeetSync(): SyncState {
  const engine = useEngine()
  return useSyncExternalStore(
    engine.subscribe,
    () => engine.sync,
    () => engine.sync,
  )
}

export function useMeetPageId(): string {
  return useEngine().pageId
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export type BookResult =
  | { ok: true; id: BookingId; booking: Booking }
  | { ok: false; problem: BookingProblem }

export interface MeetActions {
  setProfile(patch: PagePatch): void
  linkItinerary(source: ItinerarySource, events: readonly BusyEvent[]): void
  unlinkItinerary(): void

  /** Returns the slot as written, so the caller can mirror it without a round trip. */
  addSlot(input: NewSlot): Slot
  editSlot(id: SlotId, patch: SlotPatch): void
  deleteSlot(id: SlotId): void
  /** Copy a slot onto the next free day. */
  duplicateSlot(id: SlotId): Slot | null

  /** Take a slot. Re-checks the rules against the live page before writing. */
  book(input: { slotId: SlotId; name: string; email: string; kind: BookingKind; note?: string }): BookResult
  cancelBooking(id: BookingId): void
  /** Turn a second choice into the booking, once the first falls through. */
  promoteBooking(id: BookingId): void
  setBookingEventId(id: BookingId, eventId: string | null): void
}

export function useMeetActions(): MeetActions {
  const engine = useEngine()
  const page = useMeetPage()
  const pageRef = useRef(page)
  pageRef.current = page

  return useMemo<MeetActions>(() => {
    const newSlotId = () => asId<'slot'>(crypto.randomUUID())
    const newBookingId = () => asId<'booking'>(crypto.randomUUID())

    return {
      setProfile: (patch) => engine.mutate((d) => setPage(d, patch)),
      linkItinerary: (source, events) => engine.mutate((d) => setItinerary(d, source, events)),
      unlinkItinerary: () => engine.mutate((d) => clearItinerary(d)),

      addSlot: (input) => {
        const id = newSlotId()
        engine.mutate((d) => createSlot(d, id, input))
        return materialise(id, input)
      },
      editSlot: (id, patch) => engine.mutate((d) => patchSlot(d, id, patch)),
      deleteSlot: (id) => engine.mutate((d) => removeSlot(d, id)),
      duplicateSlot: (id) => {
        const current = pageRef.current
        const slot = current.slots.find((s) => s.id === id)
        if (!slot) return null
        const when = duplicateAt(slot, current.slots, current.busy)
        const copy = newSlotId()
        const input: NewSlot = {
          start: when.start,
          end: when.end,
          title: slot.title,
          locationName: slot.locationName,
          address: slot.address,
          coords: slot.coords,
          blurb: slot.blurb,
        }
        engine.mutate((d) => createSlot(d, copy, input))
        return materialise(copy, input)
      },

      book: (input) => {
        const current = pageRef.current
        // The check runs here rather than only in the form, because between a
        // guest opening the page and pressing Confirm somebody else may have
        // taken the slot — and on a relayed page that is a normal Tuesday.
        const check = canBook(
          { name: input.name, email: input.email, slotId: input.slotId, kind: input.kind },
          current,
        )
        if (!check.ok) return check

        // Re-picking replaces the guest's own hold of that kind rather than
        // stacking a second one; "change my mind" is the common case.
        const holds = holdsOf(input.email, current.bookings)
        const previous = input.kind === 'primary' ? holds.primary : holds.tentative

        const id = newBookingId()
        engine.book((d) => {
          if (previous) removeBooking(d, previous.id)
          createBooking(d, id, {
            slotId: input.slotId,
            name: input.name,
            email: input.email,
            kind: input.kind,
            note: input.note,
          })
        })

        const booking = engine.getSnapshot().bookings.find((b) => b.id === id)
        return booking ? { ok: true, id, booking } : { ok: false, problem: 'gone' }
      },

      cancelBooking: (id) => engine.book((d) => removeBooking(d, id)),
      promoteBooking: (id) => engine.mutate((d) => patchBooking(d, id, { kind: 'primary' })),
      setBookingEventId: (id, eventId) =>
        engine.book((d) => patchBooking(d, id, { gcalEventId: eventId })),
    }
  }, [engine])
}

/**
 * The slot a write just produced, without waiting for the document to come
 * back around through React. Calendar mirroring happens on the same click as
 * the write, and a mirror that ran a render late would push the previous
 * version of the slot.
 */
function materialise(id: SlotId, input: NewSlot): Slot {
  return {
    id,
    start: input.start,
    end: input.end,
    title: input.title,
    locationName: input.locationName ?? '',
    address: input.address ?? '',
    coords: input.coords ?? null,
    blurb: input.blurb ?? '',
    gcalEventId: null,
    createdAt: Date.now(),
  }
}
