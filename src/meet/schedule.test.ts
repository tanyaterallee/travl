import { describe, expect, it } from 'vitest'
import { asId } from '../core/types'
import {
  blockedBy,
  bookableSlots,
  canBook,
  duplicateAt,
  formatFullDate,
  formatRange,
  fromLocalInput,
  groupDays,
  holdsOf,
  overlaps,
  slotState,
  toLocalInput,
} from './schedule'
import type { Booking, BusyEvent, MeetPage, Slot } from './types'
import { NO_SOURCE } from './types'

/* Local wall-clock times, so the tests read the same in any zone the suite
   happens to run in. */
const at = (day: number, hour: number, minute = 0): string =>
  new Date(2026, 8, day, hour, minute, 0, 0).toISOString()

function slot(id: string, day: number, hour: number, hours = 1): Slot {
  return {
    id: asId<'slot'>(id),
    start: at(day, hour),
    end: at(day, hour + hours),
    title: `Slot ${id}`,
    locationName: 'The Bund',
    address: 'Zhongshan East 1st Rd',
    coords: null,
    blurb: '',
    gcalEventId: null,
    createdAt: 0,
  }
}

function booking(id: string, slotId: string, email: string, kind: Booking['kind']): Booking {
  return {
    id: asId<'booking'>(id),
    slotId: asId<'slot'>(slotId),
    name: 'Mei',
    email,
    kind,
    note: '',
    createdAt: 0,
    gcalEventId: null,
  }
}

function busy(id: string, day: number, hour: number, hours = 1): BusyEvent {
  return {
    id,
    title: 'Great Wall day trip',
    start: at(day, hour),
    end: at(day, hour + hours),
    location: 'Mutianyu',
    description: '',
    source: 'Wanderlog',
  }
}

function page(slots: Slot[], bookings: Booking[] = [], events: BusyEvent[] = []): MeetPage {
  return {
    title: 'Shanghai week',
    headline: '',
    ownerName: 'Tanya',
    ownerEmail: 'owner@example.com',
    ownerAvatar: '',
    timezone: 'Asia/Shanghai',
    syncCalendarId: '',
    syncCalendarName: '',
    slots,
    bookings,
    busy: events,
    source: NO_SOURCE,
  }
}

describe('overlaps', () => {
  it('treats ranges as half-open', () => {
    // Back-to-back events do not collide, or every itinerary would block the
    // slot that starts the moment it ends.
    expect(overlaps(at(12, 14), at(12, 15), at(12, 15), at(12, 16))).toBe(false)
    expect(overlaps(at(12, 14), at(12, 15), at(12, 14, 59), at(12, 16))).toBe(true)
  })

  it('catches containment in both directions', () => {
    expect(overlaps(at(12, 9), at(12, 18), at(12, 13), at(12, 14))).toBe(true)
    expect(overlaps(at(12, 13), at(12, 14), at(12, 9), at(12, 18))).toBe(true)
  })
})

describe('slotState', () => {
  it('is open with no booking and nothing in the way', () => {
    const s = slot('a', 12, 14)
    expect(slotState(s, [], [])).toBe('open')
  })

  it('is blocked by an overlapping itinerary entry', () => {
    const s = slot('a', 12, 14)
    expect(slotState(s, [], [busy('e1', 12, 13, 3)])).toBe('blocked')
    expect(blockedBy(s, [busy('e1', 12, 13, 3)])?.title).toBe('Great Wall day trip')
  })

  it('is booked once someone holds it as their first choice', () => {
    const s = slot('a', 12, 14)
    expect(slotState(s, [booking('b1', 'a', 'mei@example.com', 'primary')], [])).toBe('booked')
  })

  it('reports booked ahead of blocked, because a person needs dealing with', () => {
    const s = slot('a', 12, 14)
    const state = slotState(s, [booking('b1', 'a', 'mei@example.com', 'primary')], [busy('e1', 12, 14)])
    expect(state).toBe('booked')
  })

  it('leaves a slot open when the only hold is tentative', () => {
    const s = slot('a', 12, 14)
    expect(slotState(s, [booking('b1', 'a', 'mei@example.com', 'tentative')], [])).toBe('open')
  })
})

describe('bookableSlots', () => {
  it('drops booked, blocked and finished slots', () => {
    const open = slot('open', 20, 14)
    const taken = slot('taken', 20, 16)
    const clash = slot('clash', 21, 10)
    const over = slot('over', 1, 9)
    const p = page(
      [open, taken, clash, over],
      [booking('b1', 'taken', 'mei@example.com', 'primary')],
      [busy('e1', 21, 9, 3)],
    )
    const ids = bookableSlots(p, new Date(at(10, 12)).getTime()).map((s) => s.id)
    expect(ids).toEqual([asId<'slot'>('open')])
  })
})

describe('canBook', () => {
  const free = slot('free', 20, 14)
  const other = slot('other', 21, 14)
  const now = new Date(at(1, 9)).getTime()

  it('rejects an empty name and a malformed email', () => {
    const p = page([free])
    expect(canBook({ name: '  ', email: 'mei@example.com', slotId: free.id, kind: 'primary' }, p, now)).toEqual({ ok: false, problem: 'name' })
    expect(canBook({ name: 'Mei', email: 'mei@', slotId: free.id, kind: 'primary' }, p, now)).toEqual({ ok: false, problem: 'email' })
  })

  it('accepts a first booking', () => {
    expect(canBook({ name: 'Mei', email: 'mei@example.com', slotId: free.id, kind: 'primary' }, page([free]), now)).toEqual({ ok: true })
  })

  it('refuses a slot somebody else already took', () => {
    const p = page([free], [booking('b1', 'free', 'other@example.com', 'primary')])
    expect(canBook({ name: 'Mei', email: 'mei@example.com', slotId: free.id, kind: 'primary' }, p, now)).toEqual({ ok: false, problem: 'taken' })
  })

  it('allows only one primary per guest', () => {
    const p = page([free, other], [booking('b1', 'free', 'mei@example.com', 'primary')])
    expect(canBook({ name: 'Mei', email: 'MEI@example.com', slotId: other.id, kind: 'primary' }, p, now)).toEqual({ ok: false, problem: 'hasPrimary' })
  })

  it('allows a tentative second choice alongside a primary', () => {
    const p = page([free, other], [booking('b1', 'free', 'mei@example.com', 'primary')])
    expect(canBook({ name: 'Mei', email: 'mei@example.com', slotId: other.id, kind: 'tentative' }, p, now)).toEqual({ ok: true })
  })

  it('refuses a tentative hold on the slot already booked outright', () => {
    const p = page([free], [booking('b1', 'free', 'mei@example.com', 'primary')])
    expect(canBook({ name: 'Mei', email: 'mei@example.com', slotId: free.id, kind: 'tentative' }, p, now)).toEqual({ ok: false, problem: 'sameSlot' })
  })

  it('allows only one tentative per guest', () => {
    const third = slot('third', 22, 14)
    const p = page([free, other, third], [booking('b2', 'other', 'mei@example.com', 'tentative')])
    expect(canBook({ name: 'Mei', email: 'mei@example.com', slotId: third.id, kind: 'tentative' }, p, now)).toEqual({ ok: false, problem: 'hasTentative' })
  })

  it("does not let another guest's tentative hold stop a real booking", () => {
    const p = page([free], [booking('b1', 'free', 'someone@example.com', 'tentative')])
    expect(canBook({ name: 'Mei', email: 'mei@example.com', slotId: free.id, kind: 'primary' }, p, now)).toEqual({ ok: true })
  })

  it('refuses a slot the itinerary has taken', () => {
    const p = page([free], [], [busy('e1', 20, 13, 3)])
    expect(canBook({ name: 'Mei', email: 'mei@example.com', slotId: free.id, kind: 'primary' }, p, now)).toEqual({ ok: false, problem: 'blocked' })
  })

  it('refuses a slot that has already happened', () => {
    const past = slot('past', 20, 14)
    const later = new Date(at(25, 9)).getTime()
    expect(canBook({ name: 'Mei', email: 'mei@example.com', slotId: past.id, kind: 'primary' }, page([past]), later)).toEqual({ ok: false, problem: 'past' })
  })
})

describe('holdsOf', () => {
  it('matches a guest by email regardless of case or padding', () => {
    const bookings = [
      booking('b1', 'a', 'Mei@Example.com ', 'primary'),
      booking('b2', 'b', 'mei@example.com', 'tentative'),
    ]
    const holds = holdsOf('mei@example.com', bookings)
    expect(holds.primary?.id).toBe(asId<'booking'>('b1'))
    expect(holds.tentative?.id).toBe(asId<'booking'>('b2'))
  })
})

describe('groupDays', () => {
  it('orders days and sorts within them', () => {
    const groups = groupDays(
      [slot('late', 13, 16), slot('early', 12, 9), slot('mid', 12, 14)],
      [busy('e1', 12, 11)],
    )
    expect(groups).toHaveLength(2)
    expect(groups[0].slots.map((s) => s.id)).toEqual([asId<'slot'>('early'), asId<'slot'>('mid')])
    expect(groups[0].busy.map((e) => e.id)).toEqual(['e1'])
    expect(groups[1].slots.map((s) => s.id)).toEqual([asId<'slot'>('late')])
  })

  it('keeps a day that has itinerary entries and no slots', () => {
    const groups = groupDays([slot('a', 12, 9)], [busy('e1', 13, 9)])
    expect(groups.map((g) => g.slots.length)).toEqual([1, 0])
  })
})

describe('duplicateAt', () => {
  it('lands on the next day at the same hour', () => {
    const s = slot('a', 12, 14)
    const copy = duplicateAt(s, [s])
    expect(new Date(copy.start).getDate()).toBe(13)
    expect(new Date(copy.start).getHours()).toBe(14)
  })

  it('skips forward past a slot or an itinerary entry it would land on', () => {
    const s = slot('a', 12, 14)
    const taken = slot('b', 13, 14)
    const copy = duplicateAt(s, [s, taken], [busy('e1', 14, 13, 3)])
    expect(new Date(copy.start).getDate()).toBe(15)
  })

  it('keeps the original length', () => {
    const s = slot('a', 12, 14, 3)
    const copy = duplicateAt(s, [s])
    expect(new Date(copy.end).getTime() - new Date(copy.start).getTime()).toBe(3 * 3_600_000)
  })
})

describe('formatting', () => {
  it('writes the date as weekday then DD/MM/YY', () => {
    // 12 September 2026 is a Saturday.
    expect(formatFullDate(at(12, 10), 'en')).toBe('Saturday, 12/09/26')
  })

  it('never renders the date in month-first order', () => {
    // 8 September, not 9 August — the whole reason this is not left to Intl.
    expect(formatFullDate(at(8, 10), 'en')).toContain('08/09/26')
  })

  it('renders a time range in 24-hour form', () => {
    expect(formatRange(at(12, 14), at(12, 15, 30), 'en')).toBe('14:00 – 15:30')
  })
})

describe('datetime-local round trip', () => {
  it('survives a trip through the input and back', () => {
    const iso = at(12, 14, 30)
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso)
  })

  it('rejects a value the input never produced', () => {
    expect(fromLocalInput('tomorrow afternoon')).toBeNull()
  })
})
