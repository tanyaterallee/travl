/**
 * Fractional indexing.
 *
 * Drag-and-drop across a CRDT cannot renumber a list — two people reordering
 * the same day offline would each rewrite every index and destroy each other's
 * work on merge. Instead every card carries an order *key*, and inserting
 * between two cards mints a key that sorts between theirs. Only the moved card
 * is written, so concurrent drags elsewhere in the list never touch the same
 * field.
 *
 * A key is a base-62 fraction with an implied leading "0." — "V" is 31/62,
 * "V1" is 31/62 + 1/3844 — compared as a plain string. `between` is exact
 * midpoint arithmetic rather than digit-walking, because the walking version
 * has a genuinely nasty edge case when one key is a prefix of the other.
 *
 * Invariant: **no key ends in the lowest digit '0'.** Nothing sorts between
 * "A" and "A0", so a key ending in '0' would eventually make `between`
 * impossible to satisfy. Every generator here preserves it.
 *
 * Ties — two peers minting the same key during a partition — are broken by
 * actor id, so the resulting order is arbitrary but identical everywhere.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length
const HALF = BASE >> 1

/**
 * The first key in an empty list. Deliberately near the bottom of the range
 * rather than the middle: appending is the overwhelmingly common operation in
 * a trip planner, so almost all of the digit space is left above it. That
 * keeps keys one character long for the first 61 cards in a list.
 */
const SEED = DIGITS[1]

export type Frac = string

/**
 * A key ordering strictly between `a` and `b`. Pass `null` for an open end:
 * `between(null, first)` prepends, `between(last, null)` appends,
 * `between(null, null)` seeds an empty list.
 */
export function between(a: Frac | null, b: Frac | null): Frac {
  if (a !== null && b !== null && a >= b) {
    throw new Error(`fractional index out of order: ${JSON.stringify(a)} >= ${JSON.stringify(b)}`)
  }

  // Open ends are handled by stepping, not by averaging against 0 or 1.
  // Averaging would add a digit of precision on every append, so a list built
  // by dragging cards onto the end would grow keys without bound.
  if (a === null && b === null) return SEED
  if (b === null) return step(decode(a!))
  if (a === null) return unstep(decode(b))

  const lo = decode(a)
  const hi = decode(b)

  // Exact midpoint: sum the two fractions, then halve.
  const width = Math.max(lo.length, hi.length)
  const sum = new Array<number>(width).fill(0)
  for (let i = 0; i < width; i++) sum[i] = (lo[i] ?? 0) + (hi[i] ?? 0)
  let whole = 0
  for (let i = width - 1; i >= 0; i--) {
    if (sum[i] >= BASE) {
      sum[i] -= BASE
      if (i === 0) whole += 1
      else sum[i - 1] += 1
    }
  }

  // Halve it, pushing any remainder into one more digit of precision.
  const out: number[] = []
  let rem = whole
  for (let i = 0; i < width; i++) {
    const cur = rem * BASE + sum[i]
    out.push(cur >> 1)
    rem = cur & 1
  }
  if (rem) out.push(HALF)

  // Shorten while the key still sorts above `a`, then restore the invariant.
  while (out.length > 0 && out[out.length - 1] === 0 && cmp(out.slice(0, -1), lo) > 0) {
    out.pop()
  }
  if (out.length === 0 || out[out.length - 1] === 0) out.push(HALF)

  const key = encode(out)
  if (import.meta.env?.DEV) assertBetween(key, a, b)
  return key
}

/** Keys for `count` items appended after `a`, in order. */
export function sequence(a: Frac | null, count: number): Frac[] {
  const out: Frac[] = []
  let prev = a
  for (let i = 0; i < count; i++) {
    prev = between(prev, null)
    out.push(prev)
  }
  return out
}

/**
 * Sort by key, breaking ties on actor id so every peer agrees. A tie means two
 * actors minted the same key concurrently, which `between` cannot rule out
 * across a network partition.
 */
export function sortByFrac<T>(items: readonly T[], key: (t: T) => readonly [Frac, string]): T[] {
  return [...items].sort((x, y) => {
    const [fx, ax] = key(x)
    const [fy, ay] = key(y)
    if (fx !== fy) return fx < fy ? -1 : 1
    return ax < ay ? -1 : ax > ay ? 1 : 0
  })
}

/* -------------------------------------------------------------------------- */

/**
 * The next key above `lo`, with no upper bound. Increments the last digit when
 * there is room, which keeps the key the same length; only on overflow does it
 * add a digit. The result never ends in '0', since it either incremented a
 * digit to at least 1 or appended a 1.
 */
function step(lo: readonly number[]): Frac {
  const last = lo[lo.length - 1]
  if (lo.length > 0 && last < BASE - 1) {
    return encode([...lo.slice(0, -1), last + 1])
  }
  return encode([...lo, 1])
}

/**
 * The next key below `hi`, with no lower bound. Mirrors `step`: decrement the
 * first digit with room to spare. Where decrementing would leave a trailing
 * '0' — which nothing can sort beneath — it descends a digit instead.
 */
function unstep(hi: readonly number[]): Frac {
  for (let i = 0; i < hi.length; i++) {
    if (hi[i] === 0) continue
    if (hi[i] >= 2) return encode([...hi.slice(0, i), hi[i] - 1])
    // hi[i] === 1: prefix + '0' + HALF sorts below prefix + '1'.
    return encode([...hi.slice(0, i), 0, HALF])
  }
  // All zeroes, which violates the no-trailing-'0' invariant.
  throw new Error(`not a valid fractional index: ${JSON.stringify(encode(hi))}`)
}

function decode(s: Frac): number[] {
  const out = new Array<number>(s.length)
  for (let i = 0; i < s.length; i++) {
    const d = DIGITS.indexOf(s[i])
    if (d < 0) throw new Error(`not a fractional index: ${JSON.stringify(s)}`)
    out[i] = d
  }
  return out
}

function encode(d: readonly number[]): Frac {
  let s = ''
  for (const n of d) s += DIGITS[n]
  return s
}

/** Lexicographic compare on digit arrays; a missing digit is below '0'. */
function cmp(x: readonly number[], y: readonly number[]): number {
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) {
    const a = i < x.length ? x[i] : -1
    const b = i < y.length ? y[i] : -1
    if (a !== b) return a < b ? -1 : 1
  }
  return 0
}

function assertBetween(key: Frac, a: Frac | null, b: Frac | null): void {
  if ((a !== null && key <= a) || (b !== null && key >= b)) {
    throw new Error(
      `fractional index ${JSON.stringify(key)} does not fall between ` +
        `${JSON.stringify(a)} and ${JSON.stringify(b)}`,
    )
  }
}
