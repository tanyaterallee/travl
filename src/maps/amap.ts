import { coordsOf, distanceM, inChina, toGCJ02, toWGS84, type Coords } from '../core/geo'
import type { Locale } from '../core/types'
import {
  categoryFromTypes,
  estimateLeg,
  type MapAnswer,
  type MapHandle,
  type MapProvider,
  type MapQuery,
  type MapView,
  type PlaceHit,
  type RouteLeg,
} from './provider'
import { CATEGORY_COLOR, markerElement } from './marker'

/**
 * Amap / 高德地图.
 *
 * The mainland China provider. Google's tiles, places and directions are all
 * unreachable behind the Great Firewall, so without this the app is unusable
 * for exactly the trips it most needs to support.
 *
 * Two things differ from every western provider and both are load-bearing:
 *
 *  - **Coordinates are GCJ-02.** Every value crossing this boundary is
 *    converted. `coordsOf(..., 'gcj02')` on the way in keeps the provider's
 *    own value so it never round-trips; `toGCJ02` on the way out converts only
 *    when the point came from somewhere else.
 *  - **Two different keys.** The JS SDK key and the web service key are
 *    separate credentials in the Amap console, and the static map endpoint
 *    needs the web service one.
 */

const SDK_TIMEOUT_MS = 8000

export interface AmapConfig {
  /** JS API key (地图 JS API). */
  jsKey: string
  /** Required by newer JS API accounts alongside the JS key. */
  securityCode?: string
  /** Web service key (Web服务), for the static map endpoint. */
  webKey?: string
}

interface AmapGlobal {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => AMapMap
  Marker: new (opts: Record<string, unknown>) => AMapMarker
  Polyline: new (opts: Record<string, unknown>) => AMapOverlay
  Bounds: new (sw: [number, number], ne: [number, number]) => unknown
  PlaceSearch: new (opts: Record<string, unknown>) => AMapPlaceSearch
  Driving: new (opts: Record<string, unknown>) => AMapRouter
  Walking: new (opts: Record<string, unknown>) => AMapRouter
  Riding: new (opts: Record<string, unknown>) => AMapRouter
  Transfer: new (opts: Record<string, unknown>) => AMapRouter
}

let sdkPromise: Promise<AmapGlobal> | null = null

function loadSdk(cfg: AmapConfig, locale: Locale): Promise<AmapGlobal> {
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise<AmapGlobal>((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new Error('no document'))

    const w = globalThis as unknown as {
      AMap?: AmapGlobal
      _AMapSecurityConfig?: { securityJsCode: string }
    }
    if (w.AMap) return resolve(w.AMap)

    // Must be set before the loader script runs, not after.
    if (cfg.securityCode) w._AMapSecurityConfig = { securityJsCode: cfg.securityCode }

    const script = document.createElement('script')
    script.async = true
    const params = new URLSearchParams({
      v: '2.0',
      key: cfg.jsKey,
      plugin: 'AMap.PlaceSearch,AMap.Driving,AMap.Walking,AMap.Riding,AMap.Transfer',
      lang: locale === 'zh' ? 'zh_cn' : 'en',
    })
    script.src = `https://webapi.amap.com/maps?${params}`
    const timer = setTimeout(() => reject(new Error('Amap SDK timed out')), SDK_TIMEOUT_MS)
    script.onload = () => {
      clearTimeout(timer)
      if (w.AMap) resolve(w.AMap)
      else reject(new Error('Amap SDK loaded without AMap global'))
    }
    script.onerror = () => {
      clearTimeout(timer)
      reject(new Error('Amap SDK failed to load'))
    }
    document.head.appendChild(script)
  }).catch((err) => {
    sdkPromise = null
    throw err
  })
  return sdkPromise
}

export function createAmapProvider(cfg: AmapConfig): MapProvider {
  return {
    id: 'amap',
    label: '高德地图',
    datum: 'gcj02',

    // Amap's data is mainland China plus reasonable coverage of Hong Kong,
    // Macau and Taiwan; it thins out sharply elsewhere. Claiming worldwide
    // coverage here would strand a Tokyo leg with no search results.
    covers: (c: Coords) => {
      const p = toWGS84(c)
      return inChina(p) || nearGreaterChina(p)
    },

    async available() {
      if (!cfg.jsKey) return false
      try {
        await loadSdk(cfg, 'zh')
        return true
      } catch {
        return false
      }
    },

    async query(q: MapQuery, signal?: AbortSignal): Promise<MapAnswer> {
      if (q.kind === 'static') {
        return { kind: 'static', url: staticUrl(q, cfg.webKey ?? cfg.jsKey) }
      }

      const AMap = await loadSdk(cfg, q.locale)

      switch (q.kind) {
        case 'search': {
          const search = new AMap.PlaceSearch({
            pageSize: 8,
            pageIndex: 1,
            extensions: 'all',
            ...(q.near ? { location: gcjString(q.near) } : {}),
          })
          const pois = await new Promise<AMapPoi[]>((resolve) => {
            search.search(q.text, (status, result) => {
              if (status !== 'complete' || !result?.poiList?.pois) return resolve([])
              resolve(result.poiList.pois)
            })
          })
          if (signal?.aborted) return { kind: 'search', hits: [] }

          const hits: PlaceHit[] = pois.map((poi) => ({
            ref: { provider: 'amap', id: poi.id },
            name: poi.name,
            secondary: [poi.cityname, poi.adname].filter(Boolean).join(' · '),
            // Amap speaks GCJ-02; keeping the native value here is what stops
            // the pin drifting on every save/load cycle.
            coords: coordsOf(poi.location.lat, poi.location.lng, 'gcj02'),
            category: categoryFromTypes((poi.type ?? '').split(';')),
            photo: poi.photos?.[0] ? { url: poi.photos[0].url, attribution: '高德地图' } : undefined,
          }))
          return { kind: 'search', hits }
        }

        case 'details': {
          const search = new AMap.PlaceSearch({ extensions: 'all' })
          const poi = await new Promise<AMapPoi | null>((resolve) => {
            search.getDetails(q.ref.id, (status, result) => {
              if (status !== 'complete' || !result?.poiList?.pois?.[0]) return resolve(null)
              resolve(result.poiList.pois[0])
            })
          })
          if (!poi) throw new Error(`Amap has no details for ${q.ref.id}`)

          return {
            kind: 'details',
            place: {
              ref: { provider: 'amap', id: poi.id },
              name: poi.name,
              address: [poi.cityname, poi.adname, poi.address].filter(Boolean).join(' '),
              coords: coordsOf(poi.location.lat, poi.location.lng, 'gcj02'),
              category: categoryFromTypes((poi.type ?? '').split(';')),
              photos: (poi.photos ?? []).slice(0, 6).map((p) => ({
                url: p.url,
                attribution: '高德地图',
              })),
              website: poi.website || undefined,
              phone: poi.tel || undefined,
            },
          }
        }

        case 'route': {
          const Router = { drive: AMap.Driving, walk: AMap.Walking, bike: AMap.Riding, transit: AMap.Transfer }[
            q.mode
          ]
          const legs: RouteLeg[] = []
          for (let i = 0; i < q.stops.length - 1; i++) {
            const from = q.stops[i]
            const to = q.stops[i + 1]
            try {
              const router = new Router({
                policy: 0,
                // Transfer needs a city; the origin's is the sane default.
                ...(q.mode === 'transit' ? { city: '全国' } : {}),
              })
              const leg = await new Promise<RouteLeg | null>((resolve) => {
                router.search(gcjPair(from), gcjPair(to), (status, result) => {
                  if (status !== 'complete') return resolve(null)
                  const route = result?.routes?.[0]
                  if (!route) return resolve(null)
                  resolve({
                    durationSec: route.time ?? 0,
                    distanceM: route.distance ?? 0,
                  })
                })
              })
              legs.push(leg ?? estimateLeg(distanceM(from, to), q.mode))
            } catch {
              legs.push(estimateLeg(distanceM(from, to), q.mode))
            }
          }
          return { kind: 'route', legs }
        }
      }
    },

    async mount(el: HTMLElement, view: MapView): Promise<MapHandle> {
      const AMap = await loadSdk(cfg, view.locale)
      const map = new AMap.Map(el, {
        zoom: view.zoom ?? 11,
        center: view.center ? gcjPair(view.center) : [116.397, 39.908],
        lang: view.locale === 'zh' ? 'zh_cn' : 'en',
        viewMode: '2D',
      })
      return new AmapHandle(AMap, map, view)
    },
  }
}

/* -------------------------------------------------------------------------- */

/** Hong Kong, Macau and Taiwan, where Amap has data but no GCJ-02 shift. */
function nearGreaterChina(p: { lat: number; lng: number }): boolean {
  const hkMacau = p.lat > 22.0 && p.lat < 22.6 && p.lng > 113.4 && p.lng < 114.5
  const taiwan = p.lat > 21.7 && p.lat < 25.4 && p.lng > 119.3 && p.lng < 122.1
  return hkMacau || taiwan
}

function gcjPair(c: Coords): [number, number] {
  const { lat, lng } = toGCJ02(c)
  return [lng, lat]
}

function gcjString(c: Coords): string {
  const { lat, lng } = toGCJ02(c)
  return `${lng.toFixed(6)},${lat.toFixed(6)}`
}

function staticUrl(q: Extract<MapQuery, { kind: 'static' }>, key: string): string {
  const [w, h] = q.size
  const params = new URLSearchParams({
    key,
    size: `${Math.min(w, 1024)}*${Math.min(h, 1024)}`,
    scale: String(q.scale ?? 2),
  })
  if (q.markers.length > 0) {
    // mid,color,label:lng,lat|lng,lat — Amap caps labels at one character.
    const grouped = q.markers
      .map((m, i) => `mid,0x1a6ec8,${(m.label || String(i + 1)).slice(0, 1)}:${gcjString(m.coords)}`)
      .join('|')
    params.set('markers', grouped)
  }
  if (q.path && q.path.length > 1) {
    params.set('paths', `3,0x1a6ec8,1,,:${q.path.map(gcjString).join(';')}`)
  }
  return `https://restapi.amap.com/v3/staticmap?${params}`
}

class AmapHandle implements MapHandle {
  private markers = new Map<string, AMapMarker>()
  private line: AMapOverlay | null = null
  private AMap: AmapGlobal
  private map: AMapMap

  constructor(AMap: AmapGlobal, map: AMapMap, view: MapView) {
    this.AMap = AMap
    this.map = map
    if (view.onMoveEnd) {
      this.map.on('moveend', () => {
        const c = this.map.getCenter()
        // Amap hands back GCJ-02; tagging it correctly is what keeps the
        // stored value in WGS-84.
        view.onMoveEnd?.(coordsOf(c.lat, c.lng, 'gcj02'), this.map.getZoom())
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
        existing.setPosition(gcjPair(m.coords))
        existing.setContent(markerElement(m))
      } else {
        const marker = new this.AMap.Marker({
          position: gcjPair(m.coords),
          content: markerElement(m),
          anchor: 'bottom-center',
        })
        marker.on('click', () => next.onPick?.(m.id))
        this.map.add(marker)
        this.markers.set(m.id, marker)
      }
    }
    for (const [id, marker] of this.markers) {
      if (!seen.has(id)) {
        this.map.remove(marker)
        this.markers.delete(id)
      }
    }

    if (this.line) {
      this.map.remove(this.line)
      this.line = null
    }
    if (next.path && next.path.length > 1) {
      this.line = new this.AMap.Polyline({
        path: next.path.map(gcjPair),
        strokeColor: CATEGORY_COLOR.sight.startsWith('#') ? CATEGORY_COLOR.sight : '#1a6ec8',
        strokeWeight: 3,
        strokeOpacity: 0.75,
        strokeStyle: 'dashed',
      })
      this.map.add(this.line)
    }

    if (next.fit && next.fit.length === 1) {
      this.map.setCenter(gcjPair(next.fit[0]))
      this.map.setZoom(14)
    } else if (next.fit && next.fit.length > 1) {
      this.map.setFitView(null, false, [64, 64, 64, 64])
    } else if (next.center) {
      this.map.setCenter(gcjPair(next.center))
      if (next.zoom) this.map.setZoom(next.zoom)
    }
  }

  destroy(): void {
    for (const m of this.markers.values()) this.map.remove(m)
    this.markers.clear()
    if (this.line) this.map.remove(this.line)
    this.map.destroy?.()
  }
}

/* -------------------------------------------------------------------------- */
/* Minimal structural types for the bits of the SDK we touch                  */
/* -------------------------------------------------------------------------- */

interface AMapMap {
  add(o: unknown): void
  remove(o: unknown): void
  setCenter(p: [number, number]): void
  setZoom(z: number): void
  getZoom(): number
  getCenter(): { lat: number; lng: number }
  setFitView(overlays: unknown, immediately: boolean, avoid: number[]): void
  on(ev: string, cb: () => void): void
  destroy?(): void
}
interface AMapMarker {
  setPosition(p: [number, number]): void
  setContent(el: HTMLElement): void
  on(ev: string, cb: () => void): void
}
type AMapOverlay = object
interface AMapPoi {
  id: string
  name: string
  address?: string
  type?: string
  cityname?: string
  adname?: string
  tel?: string
  website?: string
  location: { lat: number; lng: number }
  photos?: { url: string }[]
}
interface AMapPlaceSearch {
  search(keyword: string, cb: (status: string, result?: { poiList?: { pois: AMapPoi[] } }) => void): void
  getDetails(id: string, cb: (status: string, result?: { poiList?: { pois: AMapPoi[] } }) => void): void
}
interface AMapRouter {
  search(
    origin: [number, number],
    destination: [number, number],
    cb: (status: string, result?: { routes?: { time?: number; distance?: number }[] }) => void,
  ): void
}
