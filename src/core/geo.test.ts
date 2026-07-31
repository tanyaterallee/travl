import { describe, expect, it } from 'vitest'
import {
  boundsOf,
  coordsFromJSON,
  coordsOf,
  coordsToJSON,
  distanceM,
  gcj02ToWgs84,
  inChina,
  toGCJ02,
  toWGS84,
  wgs84ToGcj02,
  type LatLng,
} from './geo'

/** Metres between two WGS-84 points, for asserting on conversion magnitude. */
function metres(a: LatLng, b: LatLng): number {
  return distanceM(coordsOf(a.lat, a.lng, 'wgs84'), coordsOf(b.lat, b.lng, 'wgs84'))
}

const TIANANMEN: LatLng = { lat: 39.90869, lng: 116.39745 }
const THE_BUND: LatLng = { lat: 31.23359, lng: 121.4905 }
const SHIBUYA: LatLng = { lat: 35.6595, lng: 139.7005 }
const TIMES_SQUARE: LatLng = { lat: 40.758, lng: -73.9855 }
const VICTORIA_HARBOUR: LatLng = { lat: 22.2941, lng: 114.1699 }
const TAIPEI_101: LatLng = { lat: 25.0339, lng: 121.5645 }

describe('inChina', () => {
  it('covers the mainland', () => {
    expect(inChina(TIANANMEN)).toBe(true)
    expect(inChina(THE_BUND)).toBe(true)
  })

  it('excludes everywhere the GCJ-02 shift does not apply', () => {
    // These are the borders a China-facing planner actually trips over: a
    // bare bounding box would wrongly offset all three.
    expect(inChina(VICTORIA_HARBOUR)).toBe(false)
    expect(inChina(TAIPEI_101)).toBe(false)
    expect(inChina(SHIBUYA)).toBe(false)
    expect(inChina(TIMES_SQUARE)).toBe(false)
  })
})

describe('GCJ-02 conversion', () => {
  it('shifts mainland points by a few hundred metres', () => {
    // The obfuscation is on the order of 100-800 m. A conversion that moved
    // points by ~0 m or by kilometres would mean the algorithm is broken.
    for (const p of [TIANANMEN, THE_BUND]) {
      const shifted = wgs84ToGcj02(p)
      const d = metres(p, shifted)
      expect(d).toBeGreaterThan(100)
      expect(d).toBeLessThan(1000)
    }
  })

  it('leaves points outside the shift envelope untouched', () => {
    for (const p of [SHIBUYA, TIMES_SQUARE, VICTORIA_HARBOUR, TAIPEI_101]) {
      expect(wgs84ToGcj02(p)).toEqual(p)
      expect(gcj02ToWgs84(p)).toEqual(p)
    }
  })

  it('round-trips to well under a metre', () => {
    for (const p of [TIANANMEN, THE_BUND]) {
      const back = gcj02ToWgs84(wgs84ToGcj02(p))
      expect(metres(p, back)).toBeLessThan(1)
    }
  })
})

describe('Coords', () => {
  it('stores WGS-84 as truth regardless of the provider datum', () => {
    const fromAmap = coordsOf(39.91009, 116.40364, 'gcj02')
    // The stored value is the de-shifted one, near the true position.
    expect(metres(toWGS84(fromAmap), TIANANMEN)).toBeLessThan(100)
  })

  it('hands a GCJ-02 provider its own value back without a round trip', () => {
    // An Amap-sourced point converted to WGS-84 and back would land 1-3 m off
    // its own building. Keeping the native value avoids that entirely.
    const native = { lat: 39.91009, lng: 116.40364 }
    const c = coordsOf(native.lat, native.lng, 'gcj02')
    expect(toGCJ02(c)).toEqual(native)
  })

  it('converts for Amap when the point came from a WGS-84 provider', () => {
    const fromGoogle = coordsOf(TIANANMEN.lat, TIANANMEN.lng, 'wgs84')
    const forAmap = toGCJ02(fromGoogle)
    expect(metres(TIANANMEN, forAmap)).toBeGreaterThan(100)
  })

  it('does not shift a non-mainland point when handing it to Amap', () => {
    const hk = coordsOf(VICTORIA_HARBOUR.lat, VICTORIA_HARBOUR.lng, 'wgs84')
    expect(toGCJ02(hk)).toEqual(VICTORIA_HARBOUR)
  })

  it('survives a document round trip with its provenance intact', () => {
    const c = coordsOf(39.91009, 116.40364, 'gcj02')
    const back = coordsFromJSON(coordsToJSON(c))
    // The provider-native value survives byte for byte; the derived WGS-84 is
    // stored at 7 decimal places, which is about a centimetre.
    expect(toGCJ02(back)).toEqual(toGCJ02(c))
    expect(metres(toWGS84(back), toWGS84(c))).toBeLessThan(0.05)
  })

  it('does not accumulate drift across repeated document round trips', () => {
    // This is the failure the native value exists to prevent: every save/load
    // cycle re-converting would walk the pin away from its building.
    let c = coordsOf(39.91009, 116.40364, 'gcj02')
    const first = toWGS84(c)
    for (let i = 0; i < 20; i++) c = coordsFromJSON(coordsToJSON(c))
    expect(metres(first, toWGS84(c))).toBeLessThan(0.05)
  })
})

describe('distanceM', () => {
  it('measures a known separation', () => {
    // Tiananmen to the Bund is about 1067 km.
    const d = metres(TIANANMEN, THE_BUND)
    expect(d).toBeGreaterThan(1_050_000)
    expect(d).toBeLessThan(1_085_000)
  })

  it('is zero for a point against itself', () => {
    expect(metres(TIANANMEN, TIANANMEN)).toBe(0)
  })
})

describe('boundsOf', () => {
  it('is null for an empty set', () => {
    expect(boundsOf([])).toBeNull()
  })

  it('encloses every point', () => {
    const pts = [TIANANMEN, THE_BUND].map((p) => coordsOf(p.lat, p.lng, 'wgs84'))
    const b = boundsOf(pts, 0)!
    expect(b.north).toBeCloseTo(TIANANMEN.lat, 4)
    expect(b.south).toBeCloseTo(THE_BUND.lat, 4)
    expect(b.east).toBeCloseTo(THE_BUND.lng, 4)
    expect(b.west).toBeCloseTo(TIANANMEN.lng, 4)
  })
})
