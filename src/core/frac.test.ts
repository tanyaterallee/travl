import { describe, expect, it } from 'vitest'
import { between, sequence, sortByFrac, type Frac } from './frac'

describe('between', () => {
  it('seeds an empty list', () => {
    expect(between(null, null)).toBeTruthy()
  })

  it('appends above the previous key', () => {
    let prev = between(null, null)
    for (let i = 0; i < 200; i++) {
      const next = between(prev, null)
      expect(next > prev).toBe(true)
      prev = next
    }
  })

  it('prepends below the first key', () => {
    let first = between(null, null)
    for (let i = 0; i < 200; i++) {
      const next = between(null, first)
      expect(next < first).toBe(true)
      first = next
    }
  })

  it('never produces a key ending in the lowest digit', () => {
    // A key ending in '0' would eventually make `between` unsatisfiable,
    // because nothing sorts between "A" and "A0".
    const seeded: Frac[] = sequence(null, 50)
    const all: Frac[] = [...seeded]
    for (let i = 0; i < seeded.length - 1; i++) all.push(between(seeded[i], seeded[i + 1]))
    for (let i = 0; i < 50; i++) all.push(between(null, all[0]!))
    for (const k of all) expect(k.endsWith('0')).toBe(false)
  })

  it('survives repeated insertion into the same gap', () => {
    // The pathological drag: always dropping between the same two cards.
    let lo = between(null, null)
    const hi = between(lo, null)
    for (let i = 0; i < 500; i++) {
      const mid = between(lo, hi)
      expect(mid > lo).toBe(true)
      expect(mid < hi).toBe(true)
      lo = mid
    }
  })

  it('survives repeated insertion just below an upper bound', () => {
    const lo = between(null, null)
    let hi = between(lo, null)
    for (let i = 0; i < 500; i++) {
      const mid = between(lo, hi)
      expect(mid > lo).toBe(true)
      expect(mid < hi).toBe(true)
      hi = mid
    }
  })

  it('handles a key that is a prefix of the other', () => {
    // The case that breaks naive digit-walking implementations.
    const a = 'V'
    const b = 'V1'
    const mid = between(a, b)
    expect(mid > a).toBe(true)
    expect(mid < b).toBe(true)
  })

  it('rejects an inverted range', () => {
    expect(() => between('W', 'V')).toThrow()
    expect(() => between('V', 'V')).toThrow()
  })

  it('keeps keys short at trip-planner scale', () => {
    // Appending gains a character every 61 items, so a 200-place wishlist —
    // far larger than any real day's stop list — stays at 4 characters.
    const keys = sequence(null, 200)
    expect(Math.max(...keys.map((k) => k.length))).toBeLessThanOrEqual(4)
  })
})

describe('sortByFrac', () => {
  it('orders by key and breaks ties on actor id', () => {
    const items = [
      { id: 'c', frac: 'W', actor: 'a1' },
      { id: 'a', frac: 'V', actor: 'a2' },
      // Same key from two actors during a partition — order must be stable
      // and identical on every peer, not merely arbitrary.
      { id: 'b', frac: 'V', actor: 'a1' },
    ]
    const sorted = sortByFrac(items, (i) => [i.frac, i.actor] as const)
    expect(sorted.map((i) => i.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('convergence', () => {
  it('two peers inserting into the same gap converge on the same order', () => {
    const lo = between(null, null)
    const hi = between(lo, null)

    // Both peers mint a key for the same gap without seeing each other.
    const peerA = { frac: between(lo, hi), actor: 'peer-a' }
    const peerB = { frac: between(lo, hi), actor: 'peer-b' }

    const merged = [
      { frac: lo, actor: 'seed' },
      { frac: hi, actor: 'seed' },
      peerA,
      peerB,
    ]
    const fromA = sortByFrac(merged, (i) => [i.frac, i.actor] as const)
    const fromB = sortByFrac([...merged].reverse(), (i) => [i.frac, i.actor] as const)
    expect(fromA).toEqual(fromB)
    // Neither insertion was lost, and both landed inside the gap.
    expect(fromA[0].frac).toBe(lo)
    expect(fromA[3].frac).toBe(hi)
  })
})
