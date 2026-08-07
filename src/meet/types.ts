import type { Coords } from '../core/geo'
import type { BookingId, SlotId } from '../core/types'

/**
 * travl meet — the scheduling half of the app.
 *
 * A trip is a plan you make for yourself. A *meet page* is the same trip
 * turned outward: the hours you are willing to give away while you are on it,
 * published as a link, so a friend in the city can take one without a thread
 * of messages about what you are doing on Thursday.
 *
 * The model is deliberately smaller than Calendly's. There are no recurring
 * availability rules, no round-robin, no buffers: a traveller's week does not
 * repeat, so the unit here is a concrete slot on a concrete afternoon at a
 * concrete place, not a rule that generates them.
 */

/* -------------------------------------------------------------------------- */
/* Slots                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The three states the calendar preview shows, and the only three.
 *
 * - `open`     nobody has it; a guest may take it
 * - `booked`   someone confirmed it as their first choice
 * - `blocked`  the linked itinerary already puts you somewhere else then
 *
 * `blocked` is derived from the itinerary rather than stored, so re-importing
 * a changed trip re-derives it instead of leaving a stale flag behind.
 */
export type SlotState = 'open' | 'booked' | 'blocked'

export interface Slot {
  readonly id: SlotId
  /** ISO 8601 instant. Rendered in the viewer's own zone, always. */
  readonly start: string
  readonly end: string
  /** What you would be doing — "Coffee at the Bund", "Dumpling crawl". */
  readonly title: string
  readonly locationName: string
  readonly address: string
  readonly coords: Coords | null
  /** Two or three lines the guest sees before committing. */
  readonly blurb: string
  /** The Google Calendar event this slot is mirrored to, when signed in. */
  readonly gcalEventId: string | null
  readonly createdAt: number
}

/* -------------------------------------------------------------------------- */
/* Bookings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `primary` is the booking. `tentative` is the guest saying "this one if the
 * first falls through" — it holds nothing, blocks nobody, and exists so a
 * guest can express a second preference without the owner having to hold two
 * afternoons open for one person.
 */
export type BookingKind = 'primary' | 'tentative'

export interface Booking {
  readonly id: BookingId
  readonly slotId: SlotId
  readonly name: string
  readonly email: string
  readonly kind: BookingKind
  readonly note: string
  readonly createdAt: number
  readonly gcalEventId: string | null
}

/* -------------------------------------------------------------------------- */
/* The linked itinerary                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Something already on the owner's plan. These are what turn a slot grey: the
 * guest is told an hour is taken and, when the source gave us one, what it is
 * taken by.
 */
export interface BusyEvent {
  readonly id: string
  readonly title: string
  readonly start: string
  readonly end: string
  readonly location: string
  readonly description: string
  /** Where it came from, shown to the owner so two sources stay tellable apart. */
  readonly source: string
}

export type SourceKind = 'none' | 'trip' | 'ics' | 'gcal'

export interface ItinerarySource {
  readonly kind: SourceKind
  /** Human label — the trip title, the calendar name, the Wanderlog trip name. */
  readonly label: string
  /** The URL the owner pasted, kept so the import can be repeated. */
  readonly url: string
  /** Google calendar id, when `kind` is `gcal`. */
  readonly calendarId: string
  readonly importedAt: number
}

export const NO_SOURCE: ItinerarySource = {
  kind: 'none',
  label: '',
  url: '',
  calendarId: '',
  importedAt: 0,
}

/* -------------------------------------------------------------------------- */
/* The page                                                                   */
/* -------------------------------------------------------------------------- */

/** The immutable snapshot React renders. Rebuilt on every document change. */
export interface MeetPage {
  readonly title: string
  readonly headline: string
  readonly ownerName: string
  readonly ownerEmail: string
  readonly ownerAvatar: string
  /** IANA zone the owner published in, for the "times shown in…" line. */
  readonly timezone: string
  /** Google calendar that slots are mirrored into. Empty means no mirroring. */
  readonly syncCalendarId: string
  readonly syncCalendarName: string

  /** Sorted by start. */
  readonly slots: readonly Slot[]
  readonly bookings: readonly Booking[]
  readonly busy: readonly BusyEvent[]
  readonly source: ItinerarySource
}

/** Owner console or guest booking page. One value drives the whole surface. */
export type MeetMode = 'own' | 'guest'
