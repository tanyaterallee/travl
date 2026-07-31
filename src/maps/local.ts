import type { Map as MlMap, Marker as MlMarker } from 'maplibre-gl'
import { boundsOf, coordsOf, distanceM, toWGS84, type Coords } from '../core/geo'
import type { Locale } from '../core/types'
import {
  estimateLeg,
  type MapAnswer,
  type MapHandle,
  type MapProvider,
  type MapQuery,
  type MapView,
  type PlaceHit,
  type ResolvedPlace,
} from './provider'
import { SEED_PLACES, scoreSeedPlace, type SeedPlace } from './places.data'
import { markerElement } from './marker'

/**
 * The keyless provider.
 *
 * Google and Amap both need a billing account before they will return a single
 * result, which would make the app unusable out of the box. This one runs on
 * OpenStreetMap raster tiles and a bundled place index, so search, the
 * itinerary, the map and print all work with no configuration — and it is the
 * automatic fallback whenever a configured provider is unreachable.
 *
 * It is honest about its limits: routes are straight-line estimates flagged as
 * such, not driving directions.
 */

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '© OpenStreetMap contributors'

function toHit(p: SeedPlace, locale: Locale): PlaceHit {
  return {
    ref: { provider: 'local', id: p.id },
    name: locale === 'zh' ? p.nameZh : p.name,
    secondary: locale === 'zh' ? p.cityZh : `${p.city}`,
    coords: coordsOf(p.lat, p.lng, 'wgs84'),
    category: p.category,
    rating: p.rating,
    ratingCount: p.ratingCount,
  }
}

function toResolved(p: SeedPlace, locale: Locale): ResolvedPlace {
  return {
    ref: { provider: 'local', id: p.id },
    name: locale === 'zh' ? p.nameZh : p.name,
    address: locale === 'zh' ? `${p.cityZh} · ${p.address}` : `${p.address}, ${p.city}`,
    coords: coordsOf(p.lat, p.lng, 'wgs84'),
    category: p.category,
    rating: p.rating,
    ratingCount: p.ratingCount,
    photos: [],
  }
}

export function createLocalProvider(): MapProvider {
  return {
    id: 'local',
    label: 'OpenStreetMap',
    datum: 'wgs84',
    covers: () => true,
    available: async () => true,

    async query(q: MapQuery): Promise<MapAnswer> {
      switch (q.kind) {
        case 'search': {
          const scored = SEED_PLACES.map((p) => ({ p, score: scoreSeedPlace(p, q.text) }))
            .filter((s) => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 8)
          return { kind: 'search', hits: scored.map((s) => toHit(s.p, q.locale)) }
        }

        case 'details': {
          const found = SEED_PLACES.find((p) => p.id === q.ref.id)
          if (!found) throw new Error(`unknown place: ${q.ref.id}`)
          return { kind: 'details', place: toResolved(found, q.locale) }
        }

        case 'route': {
          const legs = []
          for (let i = 0; i < q.stops.length - 1; i++) {
            legs.push(estimateLeg(distanceM(q.stops[i], q.stops[i + 1]), q.mode))
          }
          return { kind: 'route', legs }
        }

        case 'static': {
          return { kind: 'static', url: await renderStaticMap(q.markers, q.size, q.scale ?? 2) }
        }
      }
    },

    async mount(el: HTMLElement, view: MapView): Promise<MapHandle> {
      // Deferred: maplibre is by far the largest dependency here, and the
      // print view and the search box never need it.
      const maplibregl = await import('maplibre-gl')
      const map = new maplibregl.Map({
        container: el,
        style: {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: [TILES],
              tileSize: 256,
              attribution: ATTRIBUTION,
              maxzoom: 19,
            },
          },
          layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
        },
        center: view.center ? llOf(view.center) : [0, 20],
        zoom: view.zoom ?? 2,
        attributionControl: false,
      })
      map.addControl(new maplibregl.AttributionControl({ compact: true }))
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

      // Wait for the *style*, not for `load`. `load` also waits on tiles, so a
      // blocked or slow tile server would hang the mount forever and the map
      // would come up with no markers at all — worse than a map with no
      // basemap, which is still a usable plot of the day's stops.
      await new Promise<void>((resolve) => {
        if (map.isStyleLoaded()) return resolve()
        const done = () => resolve()
        map.once('style.load', done)
        setTimeout(done, 3000)
      })

      return new MapLibreHandle(maplibregl, map, view)
    },
  }
}

/* -------------------------------------------------------------------------- */
/* The interactive surface                                                    */
/* -------------------------------------------------------------------------- */

function llOf(c: Coords): [number, number] {
  const { lat, lng } = toWGS84(c)
  return [lng, lat]
}

const PATH_SOURCE = 'travl-path'
const PATH_LAYER = 'travl-path-line'

type MapLibre = typeof import('maplibre-gl')

class MapLibreHandle implements MapHandle {
  private markers = new Map<string, MlMarker>()
  private destroyed = false
  private ml: MapLibre
  private map: MlMap
  private pathReady = false
  private lastPath: readonly Coords[] = []

  constructor(ml: MapLibre, map: MlMap, view: MapView) {
    this.ml = ml
    this.map = map
    this.addPathLayer()
    if (view.onMoveEnd) {
      this.map.on('moveend', () => {
        const c = this.map.getCenter()
        view.onMoveEnd?.(coordsOf(c.lat, c.lng, 'wgs84'), this.map.getZoom())
      })
    }
    this.update(view)
  }

  /**
   * The route line needs a loaded style; markers do not. Adding it separately
   * means a map that came up before its style was ready still shows every
   * stop, and gains the connecting line once the style arrives.
   */
  private addPathLayer(): void {
    if (!this.map.isStyleLoaded()) {
      this.map.once('style.load', () => {
        if (!this.destroyed) this.addPathLayer()
      })
      return
    }
    if (this.map.getSource(PATH_SOURCE)) return

    this.map.addSource(PATH_SOURCE, {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
    })
    this.map.addLayer({
      id: PATH_LAYER,
      type: 'line',
      source: PATH_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#1a6ec8',
        'line-width': 3,
        'line-opacity': 0.75,
        'line-dasharray': [2, 1.5],
      },
    })
    this.pathReady = true
    if (this.lastPath.length > 0) this.setPath(this.lastPath)
  }

  private setPath(coords: readonly Coords[]): void {
    this.lastPath = coords
    if (!this.pathReady) return
    const source = this.map.getSource(PATH_SOURCE) as { setData(d: unknown): void } | undefined
    source?.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords.map(llOf) },
    })
  }

  update(next: MapView): void {
    if (this.destroyed) return

    const seen = new Set<string>()
    for (const m of next.markers) {
      seen.add(m.id)
      const existing = this.markers.get(m.id)
      const el = markerElement(m)
      if (existing) {
        existing.getElement().replaceChildren(...el.childNodes)
        existing.getElement().className = el.className
        existing.setLngLat(llOf(m.coords))
      } else {
        const marker = new this.ml.Marker({ element: el, anchor: 'bottom' })
          .setLngLat(llOf(m.coords))
          .addTo(this.map)
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          next.onPick?.(m.id)
        })
        this.markers.set(m.id, marker)
      }
    }
    for (const [id, marker] of this.markers) {
      if (!seen.has(id)) {
        marker.remove()
        this.markers.delete(id)
      }
    }

    this.setPath(next.path ?? [])

    if (next.fit && next.fit.length > 0) {
      const b = boundsOf(next.fit, 0)
      if (b) {
        if (next.fit.length === 1) {
          this.map.easeTo({ center: llOf(next.fit[0]), zoom: 14, duration: 400 })
        } else {
          this.map.fitBounds(
            [
              [b.west, b.south],
              [b.east, b.north],
            ],
            { padding: 64, maxZoom: 15, duration: 400 },
          )
        }
      }
    } else if (next.center) {
      this.map.easeTo({ center: llOf(next.center), zoom: next.zoom ?? this.map.getZoom(), duration: 400 })
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    for (const m of this.markers.values()) m.remove()
    this.markers.clear()
    this.map.remove()
  }
}

/* -------------------------------------------------------------------------- */
/* Static map for print                                                       */
/* -------------------------------------------------------------------------- */

const TILE_SIZE = 256

/**
 * Stitch raster tiles into a single image.
 *
 * Print needs a plain `<img>`: a live WebGL canvas does not survive a print
 * dialog reliably, and the shared/print view must render without a live map
 * SDK at all.
 */
export async function renderStaticMap(
  markers: readonly { coords: Coords; label: string; color?: string }[],
  size: readonly [number, number],
  scale: 1 | 2,
): Promise<string> {
  const [w, h] = size
  const canvas = document.createElement('canvas')
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.scale(scale, scale)
  ctx.fillStyle = '#e8e6e1'
  ctx.fillRect(0, 0, w, h)

  const points = markers.map((m) => toWGS84(m.coords))
  if (points.length === 0) return canvas.toDataURL('image/png')

  const b = boundsOf(
    markers.map((m) => m.coords),
    0,
  )!
  const zoom = fitZoom(b, w, h)
  const centerLat = (b.north + b.south) / 2
  const centerLng = (b.east + b.west) / 2
  const cx = lngToX(centerLng, zoom)
  const cy = latToY(centerLat, zoom)

  const originX = cx - w / 2
  const originY = cy - h / 2
  const minTx = Math.floor(originX / TILE_SIZE)
  const maxTx = Math.floor((originX + w) / TILE_SIZE)
  const minTy = Math.floor(originY / TILE_SIZE)
  const maxTy = Math.floor((originY + h) / TILE_SIZE)
  const n = 2 ** zoom

  const jobs: Promise<void>[] = []
  for (let tx = minTx; tx <= maxTx; tx++) {
    for (let ty = minTy; ty <= maxTy; ty++) {
      if (ty < 0 || ty >= n) continue
      const wrapped = ((tx % n) + n) % n
      const url = TILES.replace('{z}', String(zoom))
        .replace('{x}', String(wrapped))
        .replace('{y}', String(ty))
      jobs.push(
        loadImage(url)
          .then((img) => {
            ctx.drawImage(img, tx * TILE_SIZE - originX, ty * TILE_SIZE - originY, TILE_SIZE, TILE_SIZE)
          })
          .catch(() => {
            // A missing tile leaves the base fill showing rather than failing
            // the whole print.
          }),
      )
    }
  }
  await Promise.all(jobs)

  markers.forEach((m, i) => {
    const p = toWGS84(m.coords)
    const x = lngToX(p.lng, zoom) - originX
    const y = latToY(p.lat, zoom) - originY
    drawPin(ctx, x, y, m.label || String(i + 1), m.color ?? '#1a6ec8')
  })

  ctx.font = '10px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.textAlign = 'right'
  ctx.fillText(ATTRIBUTION, w - 6, h - 6)

  return canvas.toDataURL('image/png')
}

function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, color: string): void {
  const r = 11
  ctx.beginPath()
  ctx.arc(x, y - r, r, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#fff'
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(x - 5, y - r + 7)
  ctx.lineTo(x, y + 4)
  ctx.lineTo(x + 5, y - r + 7)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()

  ctx.fillStyle = '#fff'
  ctx.font = 'bold 11px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x, y - r)
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`tile failed: ${url}`))
    img.src = url
  })
}

function lngToX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * TILE_SIZE * 2 ** zoom
}

function latToY(lat: number, zoom: number): number {
  const s = Math.sin((lat * Math.PI) / 180)
  const clamped = Math.max(-0.9999, Math.min(0.9999, s))
  return (0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI)) * TILE_SIZE * 2 ** zoom
}

function fitZoom(b: { north: number; south: number; east: number; west: number }, w: number, h: number): number {
  for (let z = 17; z >= 1; z--) {
    const dx = Math.abs(lngToX(b.east, z) - lngToX(b.west, z))
    const dy = Math.abs(latToY(b.south, z) - latToY(b.north, z))
    if (dx <= w * 0.82 && dy <= h * 0.82) return z
  }
  return 1
}
