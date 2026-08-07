import type { Locale, SlotId } from '../core/types'
import type { Booking, BusyEvent, MeetPage, Slot, SlotState } from './types'

/**
 * Everything about a schedule that can be decided without a network, a
 * document, or a React tree.
 *
 * Two rules are worth stating up front because the rest follows from them:
 *
 * **A slot's state is derived, never stored.** `booked` is "a primary booking
 * points at it" and `blocked` is "the linked itinerary overlaps it". Storing
 * either would let a re-imported itinerary or a cancelled booking leave the
 * calendar showing something that is no longer true.
 *
 * **Times are instants; days are local.** Slots are stored as ISO instants and
 * grouped into days using the *viewer's* zone, so a guest in Hong Kong and an
 * owner in Berlin never disagree about when a slot is, only about which day
 * they each call it — which is the honest answer.
 */

/* -------------------------------------------------------------------------- */
/* Time                                                                       */
/* -------------------------------------------------------------------------- */

export function ms(iso: string): number {
  return new Date(iso).getTime()
}

/** Half-open overlap: an event ending at 14:00 does not block a slot at 14:00. */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return ms(aStart) < ms(bEnd) && ms(bStart) < ms(aEnd)
}

export function durationMin(start: string, end: string): number {
  return Math.max(0, Math.round((ms(end) - ms(start)) / 60_000))
}

/** Local calendar day, as `YYYY-MM-DD`. The grouping key for every day list. */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function shiftDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

/**
 * The date exactly as the brief asks for it: weekday first, then `DD/MM/YY`.
 *
 * The numeric part is assembled by hand rather than left to `Intl`, because a
 * US locale would render 12/08/26 as August 12th and a guest booking a flight
 * around this cannot afford the ambiguity. Day-month-year, everywhere.
 */
export function formatFullDate(iso: string, locale: Locale = 'en'): string {
  const d = new Date(iso)
  const weekday = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', {
    weekday: 'long',
  }).format(d)
  const numeric = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${pad(d.getFullYear() % 100)}`
  return locale === 'zh' ? `${weekday} ${numeric}` : `${weekday}, ${numeric}`
}

/** 24-hour, because a slot list is scanned vertically and am/pm breaks the column. */
export function formatTime(iso: string, locale: Locale = 'en'): string {
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

export function formatRange(start: string, end: string, locale: Locale = 'en'): string {
  return `${formatTime(start, locale)} – ${formatTime(end, locale)}`
}

export function formatDuration(minutes: number, locale: Locale = 'en'): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (locale === 'zh') {
    return h > 0 ? (m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`) : `${m} 分钟`
  }
  if (h === 0) return `${m} min`
  return m > 0 ? `${h} h ${m} min` : `${h} h`
}

/** The zone the browser is actually in, for the "times shown in…" line. */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */

export function bookingsFor(slotId: SlotId, bookings: readonly Booking[]): readonly Booking[] {
  return bookings.filter((b) => b.slotId === slotId)
}

export function primaryFor(slotId: SlotId, bookings: readonly Booking[]): Booking | null {
  return bookings.find((b) => b.slotId === slotId && b.kind === 'primary') ?? null
}

export function tentativesFor(slotId: SlotId, bookings: readonly Booking[]): readonly Booking[] {
  return bookings.filter((b) => b.slotId === slotId && b.kind === 'tentative')
}

/** The itinerary entry that makes a slot unavailable, if there is one. */
export function blockedBy(slot: Slot, busy: readonly BusyEvent[]): BusyEvent | null {
  return busy.find((e) => overlaps(slot.start, slot.end, e.start, e.end)) ?? null
}

/**
 * Booked beats blocked. If someone already holds an hour, the owner needs to
 * see *that* rather than a grey box, even when a later itinerary import has
 * since double-booked it — the person is the thing that has to be dealt with.
 */
export function slotState(
  slot: Slot,
  bookings: readonly Booking[],
  busy: readonly BusyEvent[],
): SlotState {
  if (primaryFor(slot.id, bookings)) return 'booked'
  if (blockedBy(slot, busy)) return 'blocked'
  return 'open'
}

export function isPast(iso: string, now = Date.now()): boolean {
  return ms(iso) < now
}

/** Slots a guest may still take: open, and not already gone by. */
export function bookableSlots(page: MeetPage, now = Date.now()): readonly Slot[] {
  return page.slots.filter(
    (s) => !isPast(s.end, now) && slotState(s, page.bookings, page.busy) === 'open',
  )
}

/* -------------------------------------------------------------------------- */
/* Grouping                                                                   */
/* -------------------------------------------------------------------------- */

export interface DayGroup {
  readonly key: string
  /** An instant inside the day, for formatting its heading. */
  readonly at: string
  readonly slots: readonly Slot[]
  readonly busy: readonly BusyEvent[]
}

/**
 * Days in order, each carrying its slots and the itinerary entries around
 * them. A day with only itinerary entries still appears: "you are busy all
 * Thursday" is information the guest needs, and its absence reads as an
 * oversight rather than a full day.
 */
export function groupDays(
  slots: readonly Slot[],
  busy: readonly BusyEvent[] = [],
): readonly DayGroup[] {
  const byKey = new Map<string, { slots: Slot[]; busy: BusyEvent[]; at: string }>()

  const bucket = (iso: string) => {
    const key = dayKey(iso)
    let entry = byKey.get(key)
    if (!entry) {
      entry = { slots: [], busy: [], at: iso }
      byKey.set(key, entry)
    }
    return entry
  }

  for (const s of slots) bucket(s.start).slots.push(s)
  for (const e of busy) bucket(e.start).busy.push(e)

  return [...byKey.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, v]) => ({
      key,
      at: v.at,
      slots: [...v.slots].sort(byStart),
      busy: [...v.busy].sort(byStart),
    }))
}

function byStart(a: { start: string }, b: { start: string }): number {
  return ms(a.start) - ms(b.start)
}

/* -------------------------------------------------------------------------- */
/* Booking rules                                                              */
/* -------------------------------------------------------------------------- */

export function sameGuest(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

export interface GuestHolds {
  readonly primary: Booking | null
  readonly tentative: Booking | null
}

export function holdsOf(email: string, bookings: readonly Booking[]): GuestHolds {
  const mine = bookings.filter((b) => sameGuest(b.email, email))
  return {
    primary: mine.find((b) => b.kind === 'primary') ?? null,
    tentative: mine.find((b) => b.kind === 'tentative') ?? null,
  }
}

/**
 * Why a booking cannot be made. These are codes rather than sentences so the
 * booking page can say it in either language without the rule engine knowing
 * that the app is bilingual.
 */
export type BookingProblem =
  | 'name'
  | 'email'
  | 'taken'
  | 'blocked'
  | 'past'
  | 'gone'
  | 'sameSlot'
  | 'hasPrimary'
  | 'hasTentative'

export type BookingCheck = { ok: true } | { ok: false; problem: BookingProblem }

const OK: BookingCheck = { ok: true }

/**
 * One primary, one tentative, no more.
 *
 * The cap is the whole point of the feature. A traveller with four free hours
 * in a city cannot have one guest optioning all of them, so a second choice is
 * allowed to be *expressed* but never to reserve: a tentative hold leaves the
 * slot open for anyone else to take outright.
 */
export function canBook(
  input: { name: string; email: string; slotId: SlotId; kind: Booking['kind'] },
  page: MeetPage,
  now = Date.now(),
): BookingCheck {
  if (input.name.trim().length === 0) return { ok: false, problem: 'name' }
  if (!looksLikeEmail(input.email)) return { ok: false, problem: 'email' }

  const slot = page.slots.find((s) => s.id === input.slotId)
  if (!slot) return { ok: false, problem: 'gone' }
  if (isPast(slot.end, now)) return { ok: false, problem: 'past' }

  const primary = primaryFor(slot.id, page.bookings)
  if (primary && !sameGuest(primary.email, input.email)) return { ok: false, problem: 'taken' }
  if (blockedBy(slot, page.busy)) return { ok: false, problem: 'blocked' }

  const holds = holdsOf(input.email, page.bookings)
  if (input.kind === 'primary') {
    if (holds.primary && holds.primary.slotId !== slot.id) return { ok: false, problem: 'hasPrimary' }
  } else {
    if (holds.primary?.slotId === slot.id) return { ok: false, problem: 'sameSlot' }
    if (holds.tentative && holds.tentative.slotId !== slot.id) {
      return { ok: false, problem: 'hasTentative' }
    }
  }
  return OK
}

export function looksLikeEmail(value: string): boolean {
  const v = value.trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)
}

/* -------------------------------------------------------------------------- */
/* Editing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Where a duplicate of a slot should land.
 *
 * The same hour on the following day, then pushed forward past anything it
 * would collide with. Duplicating is how a repeated offer gets made — "coffee
 * at four, any day this week" — and a copy that silently lands on top of an
 * existing slot would make that a trap rather than a shortcut.
 */
export function duplicateAt(
  slot: Slot,
  existing: readonly Slot[],
  busy: readonly BusyEvent[] = [],
): { start: string; end: string } {
  const length = ms(slot.end) - ms(slot.start)
  for (let day = 1; day <= 14; day++) {
    const start = shiftDays(slot.start, day)
    const end = new Date(ms(start) + length).toISOString()
    const clash =
      existing.some((s) => overlaps(start, end, s.start, s.end)) ||
      busy.some((e) => overlaps(start, end, e.start, e.end))
    if (!clash) return { start, end }
  }
  const start = shiftDays(slot.start, 1)
  return { start, end: new Date(ms(start) + length).toISOString() }
}

/** Round `date` up to the next whole hour — the default start for a new slot. */
export function nextHour(from = Date.now()): string {
  const d = new Date(from)
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d.toISOString()
}

/**
 * `datetime-local` inputs speak wall-clock strings with no zone, so a slot has
 * to be flattened into the browser's own zone on the way in and out. Doing it
 * through `toISOString` instead would silently shift every slot by the UTC
 * offset — the classic way to publish a 4pm coffee as midnight.
 */
export function toLocalInput(iso: string): string {
  const d = new Date(iso)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

export function fromLocalInput(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), 0, 0)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
