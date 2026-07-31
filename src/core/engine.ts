import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import { Awareness } from 'y-protocols/awareness'
import { readTrip } from './doc'
import { docFromSnapshot } from './share'
import type { Identity } from './identity'
import { asId, type Mode, type Peer, type PlaceId, type Role, type SyncState, type Trip, type TripId } from './types'

/**
 * The engine owns the document and everything attached to it: persistence,
 * the optional relay, presence, and undo.
 *
 * React never touches Yjs directly. It reads an immutable `Trip` snapshot and
 * calls `mutate`, which is what keeps components from having to know that any
 * of this is a CRDT.
 */

export interface EngineOptions {
  tripId: TripId
  identity: Identity
  mode: Mode
  /** For `public` and `print` modes: the sealed snapshot from the link. */
  snapshot?: string
  /** Relay URL. Without one the trip is local to this browser but still real. */
  relayUrl?: string
}

type Listener = () => void

export class TripEngine {
  readonly doc: Y.Doc
  readonly tripId: TripId
  readonly mode: Mode
  readonly identity: Identity
  readonly awareness: Awareness | null

  private persistence?: IndexeddbPersistence
  private relay?: WebsocketProvider
  private undoManager?: Y.UndoManager

  private listeners = new Set<Listener>()
  private snapshot: Trip
  private syncState: SyncState

  /**
   * Bumped on every presence change. `useSyncExternalStore` needs a value it
   * can compare by identity, and the peer list is rebuilt on each read.
   */
  peersVersion = 0

  /** Resolves once local storage has been replayed into the document. */
  readonly whenReady: Promise<void>

  constructor(opts: EngineOptions) {
    this.tripId = opts.tripId
    this.mode = opts.mode
    this.identity = opts.identity

    if (opts.snapshot) {
      // A shared link. The doc is a frozen copy with no transport attached, so
      // there is nowhere for an edit to go even if one were attempted.
      this.doc = docFromSnapshot(opts.snapshot)
      this.awareness = null
      this.syncState = 'read-only'
      this.whenReady = Promise.resolve()
    } else {
      this.doc = new Y.Doc({ guid: opts.tripId })
      this.awareness = new Awareness(this.doc)
      this.syncState = 'local'

      this.persistence = new IndexeddbPersistence(`travl:${opts.tripId}`, this.doc)
      this.persistence.on('synced', () => this.emit())
      this.whenReady = this.persistence.whenSynced.then(() => undefined)

      if (opts.relayUrl) {
        this.syncState = 'connecting'
        this.relay = new WebsocketProvider(opts.relayUrl, opts.tripId, this.doc, {
          awareness: this.awareness,
          connect: true,
        })
        this.relay.on('status', ({ status }: { status: string }) => {
          this.syncState = status === 'connected' ? 'live' : 'offline'
          this.emit()
        })
      }

      this.awareness.setLocalState({
        actor: opts.identity.actor,
        name: opts.identity.name,
        color: opts.identity.color,
        role: 'editor' satisfies Role,
        editing: null,
      })
      this.awareness.on('change', () => {
        this.peersVersion++
        this.emit()
      })

      // Undo is scoped to this actor's own operations. Undoing a
      // collaborator's edit because they happened to type last is the single
      // most alarming thing a shared editor can do.
      this.undoManager = new Y.UndoManager(
        [
          this.doc.getMap('meta'),
          this.doc.getMap('places'),
          this.doc.getMap('days'),
          this.doc.getMap('checklists'),
          this.doc.getMap('reservations'),
          this.doc.getMap('expenses'),
        ],
        { trackedOrigins: new Set([LOCAL_ORIGIN]) },
      )
      this.undoManager.on('stack-item-added', () => this.emit())
      this.undoManager.on('stack-item-popped', () => this.emit())
    }

    this.snapshot = readTrip(this.doc, this.tripId)
    this.doc.on('update', this.onUpdate)
  }

  private onUpdate = (): void => {
    this.snapshot = readTrip(this.doc, this.tripId)
    this.emit()
  }

  private emit(): void {
    for (const l of this.listeners) l()
  }

  /* ---------------------------------------------------------------------- */

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): Trip => this.snapshot

  get canEdit(): boolean {
    return this.mode === 'edit'
  }

  get sync(): SyncState {
    return this.syncState
  }

  /**
   * Apply a change. Everything funnels through here, which is what makes undo
   * automatic and makes read-only enforcement a property of the write path
   * rather than of whichever button happened to be rendered.
   */
  mutate(fn: (doc: Y.Doc) => void): void {
    if (!this.canEdit) return
    this.doc.transact(() => fn(this.doc), LOCAL_ORIGIN)
  }

  undo(): void {
    this.undoManager?.undo()
  }

  redo(): void {
    this.undoManager?.redo()
  }

  get canUndo(): boolean {
    return (this.undoManager?.undoStack.length ?? 0) > 0
  }

  get canRedo(): boolean {
    return (this.undoManager?.redoStack.length ?? 0) > 0
  }

  setFocus(placeId: PlaceId | null): void {
    const state = this.awareness?.getLocalState()
    if (!state) return
    if (state.editing === placeId) return
    this.awareness!.setLocalState({ ...state, editing: placeId })
  }

  setIdentity(name: string, color: string): void {
    const state = this.awareness?.getLocalState()
    if (!state) return
    this.awareness!.setLocalState({ ...state, name, color })
  }

  peers(): Peer[] {
    if (!this.awareness) return []
    const out: Peer[] = []
    this.awareness.getStates().forEach((raw, clientId) => {
      const s = raw as Record<string, unknown>
      if (typeof s.actor !== 'string') return
      out.push({
        actor: asId<'actor'>(s.actor),
        name: typeof s.name === 'string' ? s.name : 'Traveller',
        color: typeof s.color === 'string' ? s.color : 'oklch(58% 0.17 235)',
        role: (s.role as Role) ?? 'editor',
        editing: typeof s.editing === 'string' ? asId<'place'>(s.editing) : null,
        self: clientId === this.awareness!.clientID,
      })
    })
    return out
  }

  destroy(): void {
    this.doc.off('update', this.onUpdate)
    this.listeners.clear()
    this.undoManager?.destroy()
    this.relay?.destroy()
    this.persistence?.destroy()
    this.awareness?.destroy()
    this.doc.destroy()
  }
}

/** Marks operations this browser originated, so undo skips remote edits. */
export const LOCAL_ORIGIN = Symbol('travl.local')
