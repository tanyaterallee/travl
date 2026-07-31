import type { Coords, Datum } from '../core/geo'
import type { Category, Locale, Photo, PlaceRef, TravelMode } from '../core/types'

/**
 * The map provider contract.
 *
 * Two methods. `query` answers questions, `mount` draws. Everything a provider
 * differs on — SDK loading, key handling, session tokens, coordinate datum,
 * response shape, rate limits — stays behind them, so feature code never names
 * Google or Amap and adding a third provider touches nothing else.
 *
 * `MapQuery` and `MapAnswer` are discriminated on `kind` rather than on which
 * keys happen to be present, so call sites narrow without casting.
 */

export interface MapProvider {
  readonly id: string
  readonly label: string
  /** The coordinate system this provider speaks. */
  readonly datum: Datum
  /** Whether this provider has usable data for a location. */
  covers(c: Coords): boolean
  /** Whether it is configured and reachable from here. */
  available(): Promise<boolean>

  query(q: MapQuery, signal?: AbortSignal): Promise<MapAnswer>
  mount(el: HTMLElement, view: MapView): Promise<MapHandle>
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

export type MapQuery =
  | { kind: 'search'; text: string; near?: Coords; locale: Locale }
  | { kind: 'details'; ref: PlaceRef; locale: Locale }
  | { kind: 'route'; stops: readonly Coords[]; mode: TravelMode; locale: Locale }
  | {
      kind: 'static'
      markers: readonly StaticMarker[]
      path?: readonly Coords[]
      size: readonly [number, number]
      scale?: 1 | 2
      locale: Locale
    }

export type MapAnswer =
  | { kind: 'search'; hits: readonly PlaceHit[] }
  | { kind: 'details'; place: ResolvedPlace }
  | { kind: 'route'; legs: readonly RouteLeg[] }
  | { kind: 'static'; url: string }

export interface PlaceHit {
  ref: PlaceRef
  name: string
  /** Neighbourhood and city — the line under the name in a result list. */
  secondary: string
  coords: Coords
  category: Category
  rating?: number
  ratingCount?: number
  photo?: Photo
}

export interface ResolvedPlace {
  ref: PlaceRef
  name: string
  address: string
  coords: Coords
  category: Category
  rating?: number
  ratingCount?: number
  photos: Photo[]
  website?: string
  phone?: string
}

export interface RouteLeg {
  durationSec: number
  distanceM: number
  polyline?: string
  /** The provider could not route this pair and returned an estimate. */
  estimated?: boolean
}

export interface StaticMarker {
  coords: Coords
  label: string
  color?: string
}

/* -------------------------------------------------------------------------- */
/* The interactive surface                                                    */
/* -------------------------------------------------------------------------- */

export interface MapMarker {
  id: string
  coords: Coords
  label: string
  category: Category
  /** Dimmed markers stay visible but recede — used for other days' stops. */
  dim?: boolean
  active?: boolean
}

export interface MapView {
  markers: readonly MapMarker[]
  path?: readonly Coords[]
  /** Fit these points; takes precedence over centre and zoom. */
  fit?: readonly Coords[]
  center?: Coords
  zoom?: number
  locale: Locale
  onPick?: (markerId: string) => void
  onMoveEnd?: (center: Coords, zoom: number) => void
}

export interface MapHandle {
  /** Declarative: hand it the next view and it works out the difference. */
  update(next: MapView): void
  destroy(): void
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Rough travel speeds, for providers that cannot route a given pair. */
const SPEED_MPS: Record<TravelMode, number> = {
  drive: 11.1, // ~40 km/h with urban stops
  transit: 8.3,
  walk: 1.35,
  bike: 4.2,
}

/**
 * A straight-line fallback leg.
 *
 * Real road distance runs longer than the great-circle line, so the detour
 * factor keeps the estimate from reading implausibly fast. It is flagged
 * `estimated` so the UI can say so rather than presenting a guess as a
 * routed answer.
 */
export function estimateLeg(distanceM: number, mode: TravelMode): RouteLeg {
  const detour = mode === 'walk' || mode === 'bike' ? 1.25 : 1.35
  const road = distanceM * detour
  return {
    durationSec: Math.round(road / SPEED_MPS[mode]),
    distanceM: Math.round(road),
    estimated: true,
  }
}

export function categoryFromTypes(types: readonly string[]): Category {
  const t = new Set(types.map((s) => s.toLowerCase()))
  const has = (...keys: string[]) => keys.some((k) => t.has(k))

  if (has('restaurant', 'cafe', 'bar', 'bakery', 'food', 'meal_takeaway', '餐饮服务')) return 'food'
  if (has('lodging', 'hotel', 'campground', 'guest_house', '住宿服务')) return 'stay'
  if (has('store', 'shopping_mall', 'supermarket', 'clothing_store', '购物服务')) return 'shopping'
  if (has('airport', 'train_station', 'subway_station', 'bus_station', 'transit_station', '交通设施服务'))
    return 'transit'
  if (has('amusement_park', 'aquarium', 'zoo', 'spa', 'gym', 'stadium', '体育休闲服务')) return 'activity'
  if (
    has(
      'tourist_attraction',
      'museum',
      'art_gallery',
      'park',
      'church',
      'hindu_temple',
      'mosque',
      'synagogue',
      'point_of_interest',
      '风景名胜',
    )
  ) {
    return 'sight'
  }
  return 'other'
}

export function formatDuration(sec: number, locale: Locale): string {
  const mins = Math.max(1, Math.round(sec / 60))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (locale === 'zh') {
    if (h === 0) return `${m} 分钟`
    return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`
  }
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
}

export function formatDistance(m: number, locale: Locale): string {
  if (m < 1000) return locale === 'zh' ? `${Math.round(m)} 米` : `${Math.round(m)} m`
  const km = m / 1000
  const value = km < 10 ? km.toFixed(1) : Math.round(km).toString()
  return locale === 'zh' ? `${value} 公里` : `${value} km`
}
