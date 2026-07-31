import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import * as Y from 'yjs'
import { TripEngine } from './engine'
import { loadIdentity, saveIdentity, type Identity } from './identity'
import {
  addChecklistItem,
  createChecklist,
  createDay,
  createPlace,
  fracForIndex,
  movePlace,
  patchChecklistItem,
  patchDay,
  patchPlace,
  removeChecklistItem,
  removeDay,
  removePlace,
  setMeta,
  setPlaceNotes,
  setSummary,
  upsertRecord,
  expensesOf,
  reservationsOf,
  type NewPlace,
  type PlacePatch,
} from './doc'
import { between } from './frac'
import { shareUrl, isShareable } from './share'
import {
  asId,
  type Day,
  type DayId,
  type ItemId,
  type Mode,
  type Peer,
  type Place,
  type PlaceId,
  type SyncState,
  type Trip,
  type TripId,
} from './types'

const Ctx = createContext<TripEngine | null>(null)

export function TripProvider({
  tripId,
  mode = 'edit',
  snapshot,
  relayUrl,
  seed,
  children,
}: {
  tripId: TripId
  mode?: Mode
  snapshot?: string
  relayUrl?: string
  /** Populates a brand-new document. Ignored once the trip has content. */
  seed?: (engine: TripEngine) => void
  children: ReactNode
}) {
  const [identity] = useState<Identity>(loadIdentity)
  const [engine, setEngine] = useState<TripEngine | null>(null)

  useEffect(() => {
    const next = new TripEngine({ tripId, identity, mode, snapshot, relayUrl })
    setEngine(next)
    return () => {
      next.destroy()
      setEngine(null)
    }
  }, [tripId, mode, snapshot, relayUrl, identity])

  // Seeding waits for IndexedDB, otherwise a reload would duplicate the demo
  // trip on top of the user's own edits.
  const seeded = useRef(false)
  useEffect(() => {
    if (!engine || !seed || seeded.current || mode !== 'edit') return
    seeded.current = true
    let cancelled = false
    void engine.whenReady.then(() => {
      if (cancelled) return
      const current = engine.getSnapshot()
      if (current.places.length === 0 && current.days.length === 0) seed(engine)
    })
    return () => {
      cancelled = true
    }
  }, [engine, seed, mode])

  if (!engine) return null
  return <Ctx.Provider value={engine}>{children}</Ctx.Provider>
}

function useEngine(): TripEngine {
  const engine = useContext(Ctx)
  if (!engine) throw new Error('useTrip and friends must be used inside <TripProvider>')
  return engine
}

/** Re-render whenever anything in the engine changes. */
function useEngineSnapshot(): Trip {
  const engine = useEngine()
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot)
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export function useTrip(): Trip {
  return useEngineSnapshot()
}

export function useWishlist(): readonly Place[] {
  return useEngineSnapshot().wishlist
}

export function useDays(): readonly Day[] {
  return useEngineSnapshot().days
}

export function useDay(id: DayId): Day | undefined {
  const days = useEngineSnapshot().days
  return useMemo(() => days.find((d) => d.id === id), [days, id])
}

export function usePlace(id: PlaceId): Place | undefined {
  const places = useEngineSnapshot().places
  return useMemo(() => places.find((p) => p.id === id), [places, id])
}

export function useMode(): Mode {
  return useEngine().mode
}

export function useCan(): { edit: boolean; comment: boolean; manage: boolean } {
  const engine = useEngine()
  // Advisory only — for hiding affordances. Enforcement lives in the write
  // path, so a missed check here yields an inert button, never a leak.
  return { edit: engine.canEdit, comment: engine.canEdit, manage: engine.canEdit }
}

export function useSyncStatus(): SyncState {
  const engine = useEngine()
  return useSyncExternalStore(
    engine.subscribe,
    () => engine.sync,
    () => engine.sync,
  )
}

export function useWhosHere(): { me: Peer | undefined; others: Peer[] } {
  const engine = useEngine()
  const peers = useSyncExternalStore(
    engine.subscribe,
    () => engine.peersVersion,
    () => engine.peersVersion,
  )
  return useMemo(() => {
    void peers
    const all = engine.peers()
    return { me: all.find((p) => p.self), others: all.filter((p) => !p.self) }
  }, [engine, peers])
}

export function useIdentity(): {
  identity: Identity
  rename: (name: string, color: string) => void
} {
  const engine = useEngine()
  const [identity, setIdentity] = useState(engine.identity)
  const rename = useCallback(
    (name: string, color: string) => {
      const next = { ...identity, name, color }
      setIdentity(next)
      saveIdentity(next)
      engine.setIdentity(name, color)
    },
    [engine, identity],
  )
  return { identity, rename }
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export interface TripActions {
  setTitle(title: string): void
  setDates(start: string | null, end: string | null): void
  setCurrency(code: string): void
  setSummaryText(text: string): void

  addPlace(input: NewPlace, dayId?: DayId | null, index?: number): PlaceId
  patchPlace(id: PlaceId, patch: PlacePatch): void
  setNotes(id: PlaceId, notes: string): void
  movePlace(id: PlaceId, dayId: DayId | null, index: number): void
  removePlace(id: PlaceId): void

  addDay(afterNumber?: number): DayId
  patchDay(id: DayId, patch: { title?: string; date?: string | null }): void
  removeDay(id: DayId): void

  addChecklist(title: string): ItemId
  addChecklistItem(listId: ItemId, text: string): void
  toggleChecklistItem(listId: ItemId, itemId: ItemId, done: boolean): void
  editChecklistItem(listId: ItemId, itemId: ItemId, text: string): void
  removeChecklistItem(listId: ItemId, itemId: ItemId): void

  addReservation(kind: string, title: string): ItemId
  patchReservation(id: ItemId, patch: Record<string, unknown>): void
  removeReservation(id: ItemId): void

  addExpense(title: string, amount: number, category: string): ItemId
  patchExpense(id: ItemId, patch: Record<string, unknown>): void
  removeExpense(id: ItemId): void

  undo(): void
  redo(): void
}

export function useActions(): TripActions {
  const engine = useEngine()
  const trip = useEngineSnapshot()
  const tripRef = useRef(trip)
  tripRef.current = trip

  return useMemo<TripActions>(() => {
    const m = (fn: (doc: Y.Doc) => void) => engine.mutate(fn)
    const newId = () => crypto.randomUUID()

    return {
      setTitle: (title) => m((d) => setMeta(d, { title })),
      setDates: (startDate, endDate) => m((d) => setMeta(d, { startDate, endDate })),
      setCurrency: (currency) => m((d) => setMeta(d, { currency })),
      setSummaryText: (textValue) => m((d) => setSummary(d, textValue)),

      addPlace: (input, dayId = null, index) => {
        const id = asId<'place'>(newId())
        const siblings =
          dayId === null
            ? tripRef.current.wishlist
            : (tripRef.current.days.find((x) => x.id === dayId)?.stops ?? [])
        const frac = fracForIndex(siblings, index ?? siblings.length)
        m((d) => createPlace(d, id, engine.identity.actor, input, dayId, frac))
        return id
      },
      patchPlace: (id, patch) => m((d) => patchPlace(d, id, patch)),
      setNotes: (id, notes) => m((d) => setPlaceNotes(d, id, notes)),
      movePlace: (id, dayId, index) => {
        const siblings =
          dayId === null
            ? tripRef.current.wishlist
            : (tripRef.current.days.find((x) => x.id === dayId)?.stops ?? [])
        const frac = fracForIndex(siblings, index, id)
        m((d) => movePlace(d, id, dayId, frac))
      },
      removePlace: (id) => m((d) => removePlace(d, id)),

      addDay: (afterNumber) => {
        const id = asId<'day'>(newId())
        const days = tripRef.current.days
        const at = afterNumber ?? days.length
        const before = at > 0 ? (days[at - 1]?.frac ?? null) : null
        const after = at < days.length ? (days[at]?.frac ?? null) : null
        const frac = between(before, after)
        // Give the new day the date that follows the one before it, which is
        // what "add a day" means on a dated trip.
        const prevDate = at > 0 ? days[at - 1]?.date : null
        const date = prevDate ? isoAddDays(prevDate, 1) : null
        m((d) => createDay(d, id, frac, date))
        return id
      },
      patchDay: (id, patch) => m((d) => patchDay(d, id, patch)),
      removeDay: (id) => m((d) => removeDay(d, id)),

      addChecklist: (title) => {
        const id = asId<'item'>(newId())
        const frac = between(tripRef.current.checklists.at(-1)?.frac ?? null, null)
        m((d) => createChecklist(d, id, frac, title))
        return id
      },
      addChecklistItem: (listId, textValue) => {
        const list = tripRef.current.checklists.find((c) => c.id === listId)
        const frac = between(list?.items.at(-1)?.frac ?? null, null)
        m((d) => addChecklistItem(d, listId, asId<'item'>(newId()), frac, textValue))
      },
      toggleChecklistItem: (listId, itemId, done) =>
        m((d) => patchChecklistItem(d, listId, itemId, { done })),
      editChecklistItem: (listId, itemId, textValue) =>
        m((d) => patchChecklistItem(d, listId, itemId, { text: textValue })),
      removeChecklistItem: (listId, itemId) => m((d) => removeChecklistItem(d, listId, itemId)),

      addReservation: (kind, title) => {
        const id = asId<'item'>(newId())
        const frac = between(tripRef.current.reservations.at(-1)?.frac ?? null, null)
        m((d) =>
          upsertRecord(reservationsOf(d), id, {
            frac,
            kind,
            title,
            confirmation: '',
            start: '',
            end: '',
            from: '',
            to: '',
            notes: '',
          }),
        )
        return id
      },
      patchReservation: (id, patch) => m((d) => upsertRecord(reservationsOf(d), id, patch)),
      removeReservation: (id) => m((d) => reservationsOf(d).delete(id)),

      addExpense: (title, amount, category) => {
        const id = asId<'item'>(newId())
        const frac = between(tripRef.current.expenses.at(-1)?.frac ?? null, null)
        m((d) =>
          upsertRecord(expensesOf(d), id, {
            frac,
            title,
            amount,
            category,
            paidBy: engine.identity.name,
            dayId: null,
            placeId: null,
          }),
        )
        return id
      },
      patchExpense: (id, patch) => m((d) => upsertRecord(expensesOf(d), id, patch)),
      removeExpense: (id) => m((d) => expensesOf(d).delete(id)),

      undo: () => engine.undo(),
      redo: () => engine.redo(),
    }
  }, [engine])
}

export function useUndo(): { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean } {
  const engine = useEngine()
  const version = useSyncExternalStore(
    engine.subscribe,
    () => `${engine.canUndo}:${engine.canRedo}`,
    () => `${engine.canUndo}:${engine.canRedo}`,
  )
  return useMemo(
    () => ({
      undo: () => engine.undo(),
      redo: () => engine.redo(),
      canUndo: version.startsWith('true'),
      canRedo: version.endsWith('true'),
    }),
    [engine, version],
  )
}

/* -------------------------------------------------------------------------- */
/* Presence + sharing                                                         */
/* -------------------------------------------------------------------------- */

export function useFocusReporter(): (id: PlaceId | null) => void {
  const engine = useEngine()
  return useCallback((id: PlaceId | null) => engine.setFocus(id), [engine])
}

export function useShareLink(): {
  build: (opts?: { excludeBudget?: boolean }) => { url: string; ok: boolean }
} {
  const engine = useEngine()
  return useMemo(
    () => ({
      build: (opts = {}) => {
        const url = shareUrl(engine.doc, window.location.href.split('#')[0], {
          exclude: opts.excludeBudget ? ['expenses'] : [],
        })
        return { url, ok: isShareable(url) }
      },
    }),
    [engine],
  )
}

/** The raw document, for the resolver and the export paths. */
export function useDoc(): { doc: Y.Doc; mutate: (fn: (doc: Y.Doc) => void) => void } {
  const engine = useEngine()
  return useMemo(
    () => ({ doc: engine.doc, mutate: (fn: (d: Y.Doc) => void) => engine.mutate(fn) }),
    [engine],
  )
}

/* -------------------------------------------------------------------------- */

function isoAddDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
