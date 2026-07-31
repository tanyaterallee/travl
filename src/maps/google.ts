import { coordsOf, toWGS84, type Coords } from '../core/geo'
import type { Category, Locale } from '../core/types'
import {
  categoryFromTypes,
  estimateLeg,
  type MapAnswer,
  type MapHandle,
  type MapMarker,
  type MapProvider,
  type MapQuery,
  type MapView,
  type PlaceHit,
  type RouteLeg,
} from './provider'
import { CATEGORY_COLOR } from './marker'
import { distanceM } from '../core/geo'

/**
 * Google Maps.
 *
 * Everything goes through the JS SDK rather than the web service REST
 * endpoints: the REST endpoints have no CORS headers, so calling them from a
 * browser needs a proxy, and the SDK also handles session tokens for
 * autocomplete billing.
 *
 * Blocked in mainland China. The registry treats an SDK that fails to load as
 * "unavailable" and falls through to Amap, which is the whole reason the
 * provider contract exists.
 */

const SDK_TIMEOUT_MS = 8000

interface GoogleGlobal {
  maps: {
    importLibrary(name: string): Promise<Record<string, unknown>>
  }
}

declare const google: GoogleGlobal

let sdkPromise: Promise<void> | null = null

function loadSdk(apiKey: string, locale: Locale): Promise<void> {
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new Error('no document'))
    const existing = document.querySelector('script[data-travl-google]')
    if (existing) return resolve()

    const script = document.createElement('script')
    script.dataset.travlGoogle = 'true'
    script.async = true
    const params = new URLSearchParams({
      key: apiKey,
      v: 'weekly',
      libraries: 'places,routes,marker',
      language: locale === 'zh' ? 'zh-CN' : 'en',
      loading: 'async',
    })
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`
    const timer = setTimeout(() => reject(new Error('Google Maps SDK timed out')), SDK_TIMEOUT_MS)
    script.onload = () => {
      clearTimeout(timer)
      resolve()
    }
    script.onerror = () => {
      clearTimeout(timer)
      reject(new Error('Google Maps SDK failed to load'))
    }
    document.head.appendChild(script)
  }).catch((err) => {
    // Let a later attempt retry rather than caching the failure forever.
    sdkPromise = null
    throw err
  })
  return sdkPromise
}

export interface GoogleConfig {
  apiKey: string
  /** Static Maps is a separate REST endpoint and may use a different key. */
  staticKey?: string
}

export function createGoogleProvider(cfg: GoogleConfig): MapProvider {
  let sessionToken: unknown = null

  return {
    id: 'google',
    label: 'Google Maps',
    datum: 'wgs84',
    // Google has worldwide data, but is unreachable inside mainland China.
    // Reachability is decided by `available`, not by geography.
    covers: () => true,

    async available() {
      if (!cfg.apiKey) return false
      try {
        await loadSdk(cfg.apiKey, 'en')
        return true
      } catch {
        return false
      }
    },

    async query(q: MapQuery, signal?: AbortSignal): Promise<MapAnswer> {
      if (q.kind === 'static') {
        return { kind: 'static', url: staticUrl(q, cfg.staticKey ?? cfg.apiKey) }
      }

      await loadSdk(cfg.apiKey, q.locale)
      const language = q.locale === 'zh' ? 'zh-CN' : 'en'

      switch (q.kind) {
        case 'search': {
          const { Place, AutocompleteSessionToken } = (await google.maps.importLibrary(
            'places',
          )) as unknown as {
            Place: GPlaceCtor
            AutocompleteSessionToken: new () => unknown
          }
          sessionToken ??= new AutocompleteSessionToken()

          const { places } = await Place.searchByText({
            textQuery: q.text,
            fields: ['id', 'displayName', 'formattedAddress', 'location', 'types', 'rating', 'userRatingCount', 'photos'],
            language,
            maxResultCount: 8,
            ...(q.near ? { locationBias: { center: llOf(q.near), radius: 30000 } } : {}),
          })
          if (signal?.aborted) return { kind: 'search', hits: [] }

          const hits: PlaceHit[] = places.map((p) => ({
            ref: { provider: 'google', id: p.id },
            name: p.displayName ?? '',
            secondary: shortAddress(p.formattedAddress ?? ''),
            coords: coordsOf(p.location!.lat(), p.location!.lng(), 'wgs84'),
            category: categoryFromTypes(p.types ?? []),
            rating: p.rating ?? undefined,
            ratingCount: p.userRatingCount ?? undefined,
            photo: p.photos?.[0]
              ? { url: p.photos[0].getURI({ maxWidth: 640 }), attribution: 'Google' }
              : undefined,
          }))
          return { kind: 'search', hits }
        }

        case 'details': {
          const { Place } = (await google.maps.importLibrary('places')) as unknown as {
            Place: GPlaceCtor
          }
          const place = new Place({ id: q.ref.id, requestedLanguage: language })
          await place.fetchFields({
            fields: [
              'id',
              'displayName',
              'formattedAddress',
              'location',
              'types',
              'rating',
              'userRatingCount',
              'photos',
              'websiteURI',
              'nationalPhoneNumber',
            ],
          })
          // Autocomplete billing sessions end when details are fetched.
          sessionToken = null

          return {
            kind: 'details',
            place: {
              ref: { provider: 'google', id: place.id },
              name: place.displayName ?? '',
              address: place.formattedAddress ?? '',
              coords: coordsOf(place.location!.lat(), place.location!.lng(), 'wgs84'),
              category: categoryFromTypes(place.types ?? []),
              rating: place.rating ?? undefined,
              ratingCount: place.userRatingCount ?? undefined,
              photos: (place.photos ?? []).slice(0, 6).map((ph) => ({
                url: ph.getURI({ maxWidth: 1200 }),
                attribution: 'Google',
              })),
              website: place.websiteURI ?? undefined,
              phone: place.nationalPhoneNumber ?? undefined,
            },
          }
        }

        case 'route': {
          const { DirectionsService } = (await google.maps.importLibrary('routes')) as unknown as {
            DirectionsService: new () => GDirectionsService
          }
          const service = new DirectionsService()
          const legs: RouteLeg[] = []

          // One request per pair. Google returns a whole multi-leg route, but
          // pairwise keeps the leg cache keyed per adjacent pair, so inserting
          // one stop re-fetches two legs rather than the entire day.
          for (let i = 0; i < q.stops.length - 1; i++) {
            const from = q.stops[i]
            const to = q.stops[i + 1]
            try {
              const result = await service.route({
                origin: llOf(from),
                destination: llOf(to),
                travelMode: TRAVEL_MODE[q.mode],
                language,
              })
              const leg = result.routes[0]?.legs[0]
              if (leg) {
                legs.push({
                  durationSec: leg.duration?.value ?? 0,
                  distanceM: leg.distance?.value ?? 0,
                  polyline: result.routes[0].overview_polyline,
                })
                continue
              }
              legs.push(estimateLeg(distanceM(from, to), q.mode))
            } catch {
              // No route exists (an overseas flight leg, say). An honest
              // estimate beats a blank row.
              legs.push(estimateLeg(distanceM(from, to), q.mode))
            }
          }
          return { kind: 'route', legs }
        }
      }
    },

    async mount(el: HTMLElement, view: MapView): Promise<MapHandle> {
      await loadSdk(cfg.apiKey, view.locale)
      const { Map } = (await google.maps.importLibrary('maps')) as unknown as { Map: GMapCtor }
      const { AdvancedMarkerElement } = (await google.maps.importLibrary('marker')) as unknown as {
        AdvancedMarkerElement: GAdvancedMarkerCtor
      }

      const map = new Map(el, {
        center: view.center ? llOf(view.center) : { lat: 20, lng: 0 },
        zoom: view.zoom ?? 2,
        mapId: 'travl',
        disableDefaultUI: true,
        zoomControl: true,
        clickableIcons: false,
      })

      return new GoogleHandle(map, AdvancedMarkerElement, view)
    },
  }
}

/* -------------------------------------------------------------------------- */

const TRAVEL_MODE = {
  drive: 'DRIVING',
  transit: 'TRANSIT',
  walk: 'WALKING',
  bike: 'BICYCLING',
} as const

function llOf(c: Coords): { lat: number; lng: number } {
  return toWGS84(c)
}

function shortAddress(full: string): string {
  const parts = full.split(',').map((s) => s.trim())
  return parts.slice(Math.max(0, parts.length - 2)).join(', ')
}

function staticUrl(
  q: Extract<MapQuery, { kind: 'static' }>,
  key: string,
): string {
  const [w, h] = q.size
  const params = new URLSearchParams({
    size: `${w}x${h}`,
    scale: String(q.scale ?? 2),
    language: q.locale === 'zh' ? 'zh-CN' : 'en',
    key,
  })
  for (const [i, m] of q.markers.entries()) {
    const { lat, lng } = toWGS84(m.coords)
    const color = (m.color ?? CATEGORY_COLOR.sight).startsWith('#') ? m.color! : '0x1a6ec8'
    params.append('markers', `color:${color}|label:${m.label || i + 1}|${lat},${lng}`)
  }
  if (q.path && q.path.length > 1) {
    const pts = q.path.map((c) => {
      const { lat, lng } = toWGS84(c)
      return `${lat.toFixed(5)},${lng.toFixed(5)}`
    })
    params.append('path', `color:0x1a6ec8aa|weight:3|${pts.join('|')}`)
  }
  return `https://maps.googleapis.com/maps/api/staticmap?${params}`
}

class GoogleHandle implements MapHandle {
  private markers = new Map<string, GAdvancedMarker>()
  private line: GPolyline | null = null
  private map: GMap
  private MarkerCtor: GAdvancedMarkerCtor

  constructor(map: GMap, MarkerCtor: GAdvancedMarkerCtor, view: MapView) {
    this.map = map
    this.MarkerCtor = MarkerCtor
    if (view.onMoveEnd) {
      this.map.addListener('idle', () => {
        const c = this.map.getCenter()
        if (c) view.onMoveEnd?.(coordsOf(c.lat(), c.lng(), 'wgs84'), this.map.getZoom())
      })
    }
    this.update(view)
  }

  update(next: MapView): void {
    const seen = new Set<string>()
    for (const m of next.markers) {
      seen.add(m.id)
      const existing = this.markers.get(m.id)
      if (existing) {
        existing.position = llOf(m.coords)
        existing.content = pinContent(m)
      } else {
        const marker = new this.MarkerCtor({
          map: this.map,
          position: llOf(m.coords),
          content: pinContent(m),
        })
        marker.addListener('click', () => next.onPick?.(m.id))
        this.markers.set(m.id, marker)
      }
    }
    for (const [id, marker] of this.markers) {
      if (!seen.has(id)) {
        marker.map = null
        this.markers.delete(id)
      }
    }

    this.line?.setMap(null)
    this.line = null
    if (next.path && next.path.length > 1) {
      const g = (globalThis as unknown as { google: { maps: Record<string, unknown> } }).google
      const Polyline = g.maps.Polyline as new (o: unknown) => GPolyline
      this.line = new Polyline({
        map: this.map,
        path: next.path.map(llOf),
        strokeColor: '#1a6ec8',
        strokeOpacity: 0.75,
        strokeWeight: 3,
      })
    }

    if (next.fit && next.fit.length > 0) {
      const g = (globalThis as unknown as { google: { maps: Record<string, unknown> } }).google
      const LatLngBounds = g.maps.LatLngBounds as new () => GBounds
      const bounds = new LatLngBounds()
      for (const c of next.fit) bounds.extend(llOf(c))
      if (next.fit.length === 1) {
        this.map.setCenter(llOf(next.fit[0]))
        this.map.setZoom(14)
      } else {
        this.map.fitBounds(bounds, 64)
      }
    } else if (next.center) {
      this.map.setCenter(llOf(next.center))
      if (next.zoom) this.map.setZoom(next.zoom)
    }
  }

  destroy(): void {
    for (const m of this.markers.values()) m.map = null
    this.markers.clear()
    this.line?.setMap(null)
  }
}

function pinContent(m: MapMarker): HTMLElement {
  const el = document.createElement('div')
  el.className = 'travl-pin'
  el.dataset.active = String(m.active ?? false)
  el.dataset.dim = String(m.dim ?? false)
  const body = document.createElement('span')
  body.className = 'travl-pin__body'
  body.style.background = CATEGORY_COLOR[m.category] ?? CATEGORY_COLOR.other
  body.textContent = m.label
  el.appendChild(body)
  const stem = document.createElement('span')
  stem.className = 'travl-pin__stem'
  stem.style.background = CATEGORY_COLOR[m.category] ?? CATEGORY_COLOR.other
  el.appendChild(stem)
  return el
}

/* -------------------------------------------------------------------------- */
/* Minimal structural types for the bits of the SDK we touch                  */
/* -------------------------------------------------------------------------- */

interface GLatLng {
  lat(): number
  lng(): number
}
interface GPhoto {
  getURI(opts: { maxWidth: number }): string
}
interface GPlace {
  id: string
  displayName?: string
  formattedAddress?: string
  location?: GLatLng
  types?: string[]
  rating?: number
  userRatingCount?: number
  photos?: GPhoto[]
  websiteURI?: string
  nationalPhoneNumber?: string
  fetchFields(opts: { fields: string[] }): Promise<unknown>
}
interface GPlaceCtor {
  new (opts: { id: string; requestedLanguage?: string }): GPlace
  searchByText(opts: Record<string, unknown>): Promise<{ places: GPlace[] }>
}
interface GDirectionsService {
  route(opts: Record<string, unknown>): Promise<{
    routes: {
      overview_polyline: string
      legs: { duration?: { value: number }; distance?: { value: number } }[]
    }[]
  }>
}
interface GMap {
  getCenter(): GLatLng | undefined
  getZoom(): number
  setCenter(ll: { lat: number; lng: number }): void
  setZoom(z: number): void
  fitBounds(b: GBounds, pad?: number): void
  addListener(ev: string, cb: () => void): void
}
type GMapCtor = new (el: HTMLElement, opts: Record<string, unknown>) => GMap
interface GBounds {
  extend(ll: { lat: number; lng: number }): void
}
interface GAdvancedMarker {
  position: { lat: number; lng: number } | null
  content: HTMLElement | null
  map: GMap | null
  addListener(ev: string, cb: () => void): void
}
type GAdvancedMarkerCtor = new (opts: Record<string, unknown>) => GAdvancedMarker
interface GPolyline {
  setMap(m: GMap | null): void
}

export type { Category }
