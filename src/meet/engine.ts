import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import type { SyncState } from '../core/types'
import { readPage } from './doc'
import type { MeetMode, MeetPage } from './types'

/**
 * The meet engine: one document, its storage, and its relay.
 *
 * Deliberately thinner than `TripEngine`. There is no presence here — a guest
 * picking a time does not need to see the owner's cursor — and no undo, since
 * every owner action on this page is a single explicit button rather than a
 * stream of keystrokes.
 *
 * ## Who may write what
 *
 * The owner console writes everything. The booking page writes bookings and
 * nothing else, which `mutate` refuses and `book` allows.
 *
 * That split is a *product* rule, not a security boundary, and it is worth
 * being precise about which: with no server, a booking page and an owner
 * console are the same document over the same unauthenticated relay, so a
 * determined guest with a console could write anything the owner could. This
 * is the same caveat that already applies to trip sharing — see the README.
 * What the split does buy is that the ordinary path cannot go wrong: a guest's
 * client has no code that writes a slot, so no bug in it can delete one.
 */

export interface MeetEngineOptions {
  pageId: string
  mode: MeetMode
  /** Without a relay the page is real but local to this browser. */
  relayUrl?: string
}

type Listener = () => void

export class MeetEngine {
  readonly doc: Y.Doc
  readonly pageId: string
  readonly mode: MeetMode

  private persistence: IndexeddbPersistence
  private relay?: WebsocketProvider
  private listeners = new Set<Listener>()
  private snapshot: MeetPage
  private syncState: SyncState

  /** Resolves once local storage has been replayed into the document. */
  readonly whenReady: Promise<void>

  constructor(opts: MeetEngineOptions) {
    this.pageId = opts.pageId
    this.mode = opts.mode

    this.doc = new Y.Doc({ guid: `meet:${opts.pageId}` })
    this.syncState = 'local'

    this.persistence = new IndexeddbPersistence(`travl-meet:${opts.pageId}`, this.doc)
    this.persistence.on('synced', () => this.emit())
    this.whenReady = this.persistence.whenSynced.then(() => undefined)

    if (opts.relayUrl) {
      this.syncState = 'connecting'
      // The room name carries the `meet:` prefix so a meet page and a trip
      // with the same id can never land in the same relay room and merge two
      // unrelated schemas into one document.
      this.relay = new WebsocketProvider(opts.relayUrl, `meet:${opts.pageId}`, this.doc, {
        connect: true,
      })
      this.relay.on('status', ({ status }: { status: string }) => {
        this.syncState = status === 'connected' ? 'live' : 'offline'
        this.emit()
      })
    }

    this.snapshot = readPage(this.doc)
    this.doc.on('update', this.onUpdate)
  }

  private onUpdate = (): void => {
    this.snapshot = readPage(this.doc)
    this.emit()
  }

  private emit(): void {
    for (const l of this.listeners) l()
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): MeetPage => this.snapshot

  get sync(): SyncState {
    return this.syncState
  }

  /** True when this browser is the one publishing the page. */
  get isOwner(): boolean {
    return this.mode === 'own'
  }

  /** An owner edit: slots, the profile, the linked itinerary. */
  mutate(fn: (doc: Y.Doc) => void): void {
    if (!this.isOwner) return
    this.doc.transact(() => fn(this.doc), LOCAL_ORIGIN)
  }

  /** A booking. The one write a guest is meant to make. */
  book(fn: (doc: Y.Doc) => void): void {
    this.doc.transact(() => fn(this.doc), LOCAL_ORIGIN)
  }

  destroy(): void {
    this.doc.off('update', this.onUpdate)
    this.listeners.clear()
    this.relay?.destroy()
    this.persistence.destroy()
    this.doc.destroy()
  }
}

export const LOCAL_ORIGIN = Symbol('travl.meet.local')
