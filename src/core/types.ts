import type { Coords } from './geo'
import type { Frac } from './frac'

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

declare const Brand: unique symbol
type Id<T extends string> = string & { readonly [Brand]: T }

export type TripId = Id<'trip'>
export type PlaceId = Id<'place'>
export type DayId = Id<'day'>
export type ItemId = Id<'item'>
export type ActorId = Id<'actor'>
export type SlotId = Id<'slot'>
export type BookingId = Id<'booking'>

export function asId<T extends string>(s: string): Id<T> {
  return s as Id<T>
}

/* -------------------------------------------------------------------------- */
/* Places                                                                     */
/* -------------------------------------------------------------------------- */

export const CATEGORIES = [
  'sight',
  'food',
  'stay',
  'activity',
  'shopping',
  'transit',
  'other',
] as const

export type Category = (typeof CATEGORIES)[number]

/** A provider's handle on a place. Namespaced, because ids are not portable. */
export interface PlaceRef {
  provider: string
  id: string
}

export interface Photo {
  url: string
  width?: number
  height?: number
  attribution?: string
}

/**
 * A card. The same shape whether it sits in the wishlist or in a day — which is
 * what lets a drag be one field write rather than a delete plus a create.
 */
export interface Place {
  readonly id: PlaceId

  /** `null` means the wishlist. This one field *is* the scheduling model. */
  readonly dayId: DayId | null
  readonly frac: Frac

  readonly name: string
  readonly address: string
  readonly category: Category
  readonly coords: Coords

  readonly rating?: number
  readonly ratingCount?: number
  readonly photos: readonly Photo[]
  readonly notes: string
  readonly cost?: number
  readonly startTime?: string
  readonly durationMin?: number
  readonly website?: string
  readonly phone?: string

  readonly ref?: PlaceRef
  /** Details or photos are still streaming in from the provider. */
  readonly pending: boolean

  readonly createdBy: ActorId
  readonly createdAt: number
}

/** The hero image for a card. */
export function heroPhoto(p: Place): Photo | undefined {
  return p.photos[0]
}

/* -------------------------------------------------------------------------- */
/* Days                                                                       */
/* -------------------------------------------------------------------------- */

export interface Day {
  readonly id: DayId
  readonly frac: Frac
  /** 1-based position, derived from `frac` order — not stored. */
  readonly number: number
  /** ISO date, or null for an unscheduled day. */
  readonly date: string | null
  readonly title: string
  readonly stops: readonly Place[]
  /** `legs[i]` connects `stops[i]` to `stops[i + 1]`. */
  readonly legs: readonly Leg[]
  readonly subtotal: number
}

export type TravelMode = 'drive' | 'transit' | 'walk' | 'bike'

export interface Leg {
  readonly from: PlaceId
  readonly to: PlaceId
  readonly mode: TravelMode
  readonly durationSec: number | null
  readonly distanceM: number | null
  readonly polyline?: string
  /** No cached route yet; a resolver ticket is outstanding. */
  readonly pending: boolean
}

/* -------------------------------------------------------------------------- */
/* The other sections                                                         */
/* -------------------------------------------------------------------------- */

export interface ChecklistItem {
  readonly id: ItemId
  readonly frac: Frac
  readonly text: string
  readonly done: boolean
}

export interface Checklist {
  readonly id: ItemId
  readonly frac: Frac
  readonly title: string
  readonly items: readonly ChecklistItem[]
}

export type ReservationKind = 'flight' | 'lodging' | 'car' | 'rail' | 'other'

export interface Reservation {
  readonly id: ItemId
  readonly frac: Frac
  readonly kind: ReservationKind
  readonly title: string
  readonly confirmation: string
  readonly start: string | null
  readonly end: string | null
  readonly from: string
  readonly to: string
  readonly cost?: number
  readonly notes: string
}

export interface Expense {
  readonly id: ItemId
  readonly frac: Frac
  readonly title: string
  readonly amount: number
  readonly category: Category
  readonly paidBy: string
  readonly dayId: DayId | null
  readonly placeId: PlaceId | null
}

/* -------------------------------------------------------------------------- */
/* Trip                                                                       */
/* -------------------------------------------------------------------------- */

export type Locale = 'en' | 'zh'

export interface Trip {
  readonly id: TripId
  readonly title: string
  readonly startDate: string | null
  readonly endDate: string | null
  readonly currency: string
  readonly coverUrl: string | null
  readonly summary: string

  readonly days: readonly Day[]
  readonly wishlist: readonly Place[]
  /** Wishlist plus every scheduled stop, flat. */
  readonly places: readonly Place[]

  readonly checklists: readonly Checklist[]
  readonly reservations: readonly Reservation[]
  readonly expenses: readonly Expense[]

  readonly budget: {
    readonly total: number
    readonly byCategory: Readonly<Partial<Record<Category, number>>>
  }
}

/* -------------------------------------------------------------------------- */
/* Collaboration                                                              */
/* -------------------------------------------------------------------------- */

export type Role = 'owner' | 'editor' | 'commenter' | 'viewer'

export interface Peer {
  readonly actor: ActorId
  readonly name: string
  readonly color: string
  readonly role: Role
  /** The card they currently have focused, for the live outline. */
  readonly editing: PlaceId | null
  readonly self: boolean
}

export type SyncState = 'local' | 'connecting' | 'live' | 'offline' | 'read-only'

/** How the app is being viewed. One value drives edit / public / print. */
export type Mode = 'edit' | 'public' | 'print'
