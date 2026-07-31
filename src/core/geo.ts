/**
 * Geodesy.
 *
 * Mainland China requires GCJ-02 ("Mars coordinates"); the rest of the world
 * uses WGS-84. Amap speaks GCJ-02, Google speaks WGS-84, and mixing them puts
 * every pin roughly 500 m from where it belongs.
 *
 * Two rules hold this together:
 *
 *  1. `Coords` is opaque. You cannot read `.lat` off it, so you cannot hand a
 *     WGS-84 number to Amap by accident — it is a compile error, not a bug that
 *     ships. Unwrap deliberately with `toWGS84` / `toGCJ02`.
 *  2. WGS-84 is the stored truth, and the provider-native value is carried
 *     alongside it when we have one. We never overwrite truth with a
 *     conversion: converting an Amap-native GCJ-02 point to WGS-84 and back
 *     lands it 1-3 m off its own building, and that error compounds every time
 *     the document round-trips.
 */

export type Datum = 'wgs84' | 'gcj02'

const BRAND: unique symbol = Symbol('coords')

/** A location. Opaque by design — see the module comment. */
export interface Coords {
  readonly [BRAND]: true
}

interface CoordsInner {
  readonly [BRAND]: true
  /** The stored truth. Always WGS-84. */
  readonly wgs: LatLng
  /** Present only when a GCJ-02 provider gave us this point directly. */
  readonly native?: LatLng
  readonly origin: { datum: Datum; converted: boolean }
}

export interface LatLng {
  lat: number
  lng: number
}

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Build a `Coords` from a provider response. `datum` describes what the
 * provider actually returned, which is what lets us keep the native value.
 */
export function coordsOf(lat: number, lng: number, datum: Datum): Coords {
  if (datum === 'wgs84') {
    const inner: CoordsInner = {
      [BRAND]: true,
      wgs: { lat, lng },
      origin: { datum, converted: false },
    }
    return inner
  }
  const native = { lat, lng }
  const inner: CoordsInner = {
    [BRAND]: true,
    wgs: gcj02ToWgs84(native),
    native,
    origin: { datum, converted: true },
  }
  return inner
}

/* -------------------------------------------------------------------------- */
/* Unwrapping — the deliberate escape hatches                                 */
/* -------------------------------------------------------------------------- */

export function toWGS84(c: Coords): LatLng {
  return { ...(c as CoordsInner).wgs }
}

/**
 * The value to hand an Amap SDK. Prefers the provider-native point when we have
 * one, so an Amap-sourced place is never round-tripped through a conversion.
 */
export function toGCJ02(c: Coords): LatLng {
  const inner = c as CoordsInner
  if (inner.native) return { ...inner.native }
  if (!inChina(inner.wgs)) return { ...inner.wgs }
  return wgs84ToGcj02(inner.wgs)
}

/** The value to hand a provider, chosen by that provider's datum. */
export function toDatum(c: Coords, datum: Datum): LatLng {
  return datum === 'gcj02' ? toGCJ02(c) : toWGS84(c)
}

/* -------------------------------------------------------------------------- */
/* Serialization — what actually lands in the CRDT                            */
/* -------------------------------------------------------------------------- */

export interface CoordsJSON {
  lat: number
  lng: number
  nLat?: number
  nLng?: number
  d: Datum
}

export function coordsToJSON(c: Coords): CoordsJSON {
  const inner = c as CoordsInner
  return {
    lat: round7(inner.wgs.lat),
    lng: round7(inner.wgs.lng),
    ...(inner.native ? { nLat: round7(inner.native.lat), nLng: round7(inner.native.lng) } : {}),
    d: inner.origin.datum,
  }
}

export function coordsFromJSON(j: CoordsJSON): Coords {
  const inner: CoordsInner = {
    [BRAND]: true,
    wgs: { lat: j.lat, lng: j.lng },
    ...(j.nLat !== undefined && j.nLng !== undefined
      ? { native: { lat: j.nLat, lng: j.nLng } }
      : {}),
    origin: { datum: j.d, converted: j.d === 'gcj02' },
  }
  return inner
}

/* -------------------------------------------------------------------------- */
/* Measurement                                                                */
/* -------------------------------------------------------------------------- */

const EARTH_RADIUS_M = 6_371_008.8

/** Great-circle distance in metres. Computed on WGS-84, always. */
export function distanceM(a: Coords, b: Coords): number {
  const p = toWGS84(a)
  const q = toWGS84(b)
  const φ1 = rad(p.lat)
  const φ2 = rad(q.lat)
  const dφ = rad(q.lat - p.lat)
  const dλ = rad(q.lng - p.lng)
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export interface Bounds {
  north: number
  south: number
  east: number
  west: number
}

/** WGS-84 bounding box over a set of points, with a little breathing room. */
export function boundsOf(points: readonly Coords[], padDeg = 0.01): Bounds | null {
  if (points.length === 0) return null
  let north = -90
  let south = 90
  let east = -180
  let west = 180
  for (const c of points) {
    const { lat, lng } = toWGS84(c)
    north = Math.max(north, lat)
    south = Math.min(south, lat)
    east = Math.max(east, lng)
    west = Math.min(west, lng)
  }
  return {
    north: Math.min(90, north + padDeg),
    south: Math.max(-90, south - padDeg),
    east: Math.min(180, east + padDeg),
    west: Math.max(-180, west - padDeg),
  }
}

export function centerOf(points: readonly Coords[]): Coords | null {
  const b = boundsOf(points, 0)
  if (!b) return null
  return coordsOf((b.north + b.south) / 2, (b.east + b.west) / 2, 'wgs84')
}

/* -------------------------------------------------------------------------- */
/* The shift envelope                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Whether GCJ-02 offsetting applies. The obfuscation covers mainland China but
 * not Hong Kong, Macau or Taiwan, so a bare bounding box is wrong at exactly
 * the borders a China-facing trip planner cares about. This is the standard
 * coarse test plus explicit carve-outs.
 */
export function inChina(p: LatLng): boolean {
  if (p.lng < 72.004 || p.lng > 137.8347) return false
  if (p.lat < 0.8293 || p.lat > 55.8271) return false
  if (inHongKongOrMacau(p) || inTaiwan(p)) return false
  return true
}

function inHongKongOrMacau(p: LatLng): boolean {
  return p.lat > 22.0 && p.lat < 22.6 && p.lng > 113.4 && p.lng < 114.5
}

function inTaiwan(p: LatLng): boolean {
  return p.lat > 21.7 && p.lat < 25.4 && p.lng > 119.3 && p.lng < 122.1
}

/* -------------------------------------------------------------------------- */
/* GCJ-02 <-> WGS-84                                                          */
/* -------------------------------------------------------------------------- */

const A = 6378245.0 // Krasovsky 1940 semi-major axis, which the algorithm assumes
// First eccentricity squared. Published as 0.00669342162296594323; trimmed to
// the digits a double can actually hold, which is far finer than the ~100 m
// offset this feeds into.
const EE = 0.006693421622965943

export function wgs84ToGcj02(p: LatLng): LatLng {
  if (!inChina(p)) return { ...p }
  const [dLat, dLng] = offset(p)
  return { lat: p.lat + dLat, lng: p.lng + dLng }
}

/**
 * The inverse has no closed form, so this iterates. Three passes converge to
 * well under a metre — far below the accuracy of the forward transform itself.
 */
export function gcj02ToWgs84(p: LatLng): LatLng {
  if (!inChina(p)) return { ...p }
  let guess: LatLng = { ...p }
  for (let i = 0; i < 3; i++) {
    const round = wgs84ToGcj02(guess)
    guess = { lat: guess.lat + (p.lat - round.lat), lng: guess.lng + (p.lng - round.lng) }
  }
  return guess
}

function offset(p: LatLng): [number, number] {
  const x = p.lng - 105.0
  const y = p.lat - 35.0
  const radLat = rad(p.lat)
  let magic = 1 - EE * Math.sin(radLat) ** 2
  const sqrtMagic = Math.sqrt(magic)
  magic = magic * sqrtMagic

  const dLat = (transformLat(x, y) * 180.0) / (((A * (1 - EE)) / magic) * Math.PI)
  const dLng = (transformLng(x, y) * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI)
  return [dLat, dLng]
}

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0
  return ret
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** ~1 cm. Keeps the CRDT from syncing float noise on every re-resolve. */
function round7(n: number): number {
  return Math.round(n * 1e7) / 1e7
}
