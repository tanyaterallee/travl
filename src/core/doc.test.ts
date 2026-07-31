import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  cacheLeg,
  createDay,
  createPlace,
  expensesOf,
  fracForIndex,
  movePlace,
  readTrip,
  removeDay,
  removePlace,
  setPlaceNotes,
  upsertRecord,
} from './doc'
import { between } from './frac'
import { coordsOf } from './geo'
import { asId, type ActorId, type DayId, type PlaceId, type TripId } from './types'

const TRIP = asId<'trip'>('t')
const ACTOR = asId<'actor'>('actor-1')

function makeDoc() {
  const doc = new Y.Doc()
  const day1 = asId<'day'>('day-1')
  const day2 = asId<'day'>('day-2')
  doc.transact(() => {
    createDay(doc, day1, between(null, null), '2026-09-12')
    createDay(doc, day2, between('1', null), '2026-09-13')
  })
  return { doc, day1, day2 }
}

function addPlace(
  doc: Y.Doc,
  id: string,
  dayId: DayId | null,
  frac: string,
  extra: { name?: string; cost?: number; category?: 'food' | 'sight' } = {},
) {
  doc.transact(() => {
    createPlace(
      doc,
      asId<'place'>(id),
      ACTOR as ActorId,
      {
        name: extra.name ?? id,
        coords: coordsOf(31.2397, 121.4905, 'wgs84'),
        cost: extra.cost,
        category: extra.category ?? 'sight',
      },
      dayId,
      frac,
    )
  })
  return asId<'place'>(id)
}

describe('the wishlist is just dayId === null', () => {
  it('moves a place into a day without duplicating or losing it', () => {
    const { doc, day1 } = makeDoc()
    const p = addPlace(doc, 'p1', null, '1')

    expect(readTrip(doc, TRIP as TripId).wishlist.map((x) => x.id)).toEqual([p])
    expect(readTrip(doc, TRIP as TripId).days[0].stops).toHaveLength(0)

    doc.transact(() => movePlace(doc, p, day1, '1'))

    const after = readTrip(doc, TRIP as TripId)
    expect(after.wishlist).toHaveLength(0)
    expect(after.days[0].stops.map((x) => x.id)).toEqual([p])
    // The place exists exactly once across the whole trip.
    expect(after.places.filter((x) => x.id === p)).toHaveLength(1)
  })

  it('returns a day\'s stops to the wishlist when the day is removed', () => {
    // Deleting a day must not silently delete the places planned in it.
    const { doc, day1 } = makeDoc()
    addPlace(doc, 'p1', day1, '1')
    addPlace(doc, 'p2', day1, '2')

    doc.transact(() => removeDay(doc, day1))

    const after = readTrip(doc, TRIP as TripId)
    expect(after.days).toHaveLength(1)
    expect(after.wishlist.map((x) => x.id).sort()).toEqual(['p1', 'p2'])
  })
})

describe('ordering', () => {
  it('keeps stops in fractional order, not insertion order', () => {
    const { doc, day1 } = makeDoc()
    addPlace(doc, 'c', day1, '3')
    addPlace(doc, 'a', day1, '1')
    addPlace(doc, 'b', day1, '2')

    expect(readTrip(doc, TRIP as TripId).days[0].stops.map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('drops a card into the slot the user aimed at when moving within a list', () => {
    // Excluding the moving card matters: without it, dragging a card down
    // lands it one position short of the drop indicator.
    const { doc, day1 } = makeDoc()
    addPlace(doc, 'a', day1, '1')
    addPlace(doc, 'b', day1, '2')
    addPlace(doc, 'c', day1, '3')

    const stops = readTrip(doc, TRIP as TripId).days[0].stops
    const frac = fracForIndex(stops, 2, 'a')
    doc.transact(() => movePlace(doc, asId<'place'>('a'), day1, frac))

    expect(readTrip(doc, TRIP as TripId).days[0].stops.map((p) => p.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('legs', () => {
  it('is pending until a route is cached, then reports it', () => {
    const { doc, day1 } = makeDoc()
    const a = addPlace(doc, 'a', day1, '1')
    const b = addPlace(doc, 'b', day1, '2')

    expect(readTrip(doc, TRIP as TripId).days[0].legs[0].pending).toBe(true)

    doc.transact(() =>
      cacheLeg(doc, a, b, 'drive', {
        durationSec: 900,
        distanceM: 4200,
        provider: 'test',
        at: Date.now(),
      }),
    )

    const leg = readTrip(doc, TRIP as TripId).days[0].legs[0]
    expect(leg.pending).toBe(false)
    expect(leg.durationSec).toBe(900)
  })

  it('discards cached legs that referenced a removed place', () => {
    // A stale leg would otherwise be inherited by a later place reusing the id.
    const { doc, day1 } = makeDoc()
    const a = addPlace(doc, 'a', day1, '1')
    const b = addPlace(doc, 'b', day1, '2')
    doc.transact(() =>
      cacheLeg(doc, a, b, 'drive', { durationSec: 900, distanceM: 4200, provider: 't', at: 1 }),
    )
    expect(doc.getMap('legs').size).toBe(1)

    doc.transact(() => removePlace(doc, b))
    expect(doc.getMap('legs').size).toBe(0)
  })
})

describe('budget', () => {
  it('counts a place cost and a standalone expense exactly once each', () => {
    const { doc, day1 } = makeDoc()
    addPlace(doc, 'p1', day1, '1', { cost: 100, category: 'food' })
    doc.transact(() =>
      upsertRecord(expensesOf(doc), 'e1', {
        frac: '1',
        title: 'Taxi',
        amount: 50,
        category: 'transit',
        paidBy: 'me',
        dayId: null,
        placeId: null,
      }),
    )

    const trip = readTrip(doc, TRIP as TripId)
    expect(trip.budget.total).toBe(150)
    expect(trip.budget.byCategory.food).toBe(100)
    expect(trip.budget.byCategory.transit).toBe(50)
  })

  it('does not double-count an expense already attached to a place', () => {
    const { doc, day1 } = makeDoc()
    const p = addPlace(doc, 'p1', day1, '1', { cost: 100, category: 'food' })
    doc.transact(() =>
      upsertRecord(expensesOf(doc), 'e1', {
        frac: '1',
        title: 'Dinner',
        amount: 100,
        category: 'food',
        paidBy: 'me',
        dayId: null,
        placeId: p,
      }),
    )

    expect(readTrip(doc, TRIP as TripId).budget.total).toBe(100)
  })
})

describe('notes merge as text, not as a whole value', () => {
  it('preserves a concurrent edit made elsewhere in the same note', () => {
    // Two people typing in one note is normal on a shared plan. Replacing the
    // whole string would drop whichever edit arrived first.
    const local = new Y.Doc()
    const remote = new Y.Doc()
    const day = asId<'day'>('day-1')
    for (const doc of [local, remote]) {
      doc.transact(() => createDay(doc, day, '1', null))
    }
    addPlace(local, 'p1', day, '1')
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local))

    const p = asId<'place'>('p1')
    local.transact(() => setPlaceNotes(local, p, 'Book ahead'))
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local))

    // Each side edits a different end of the same note while disconnected.
    local.transact(() => setPlaceNotes(local, p, 'Please book ahead'))
    remote.transact(() => setPlaceNotes(remote, p, 'Book ahead on weekends'))

    Y.applyUpdate(local, Y.encodeStateAsUpdate(remote))
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local))

    const merged = readTrip(local, TRIP as TripId).places[0].notes
    expect(readTrip(remote, TRIP as TripId).places[0].notes).toBe(merged)
    // Both contributions survived rather than one overwriting the other.
    expect(merged).toContain('Please')
    expect(merged).toContain('weekends')
  })
})

describe('concurrent edits converge', () => {
  it('lands two peers on the same order after dropping into the same gap', () => {
    const peerA = new Y.Doc()
    const peerB = new Y.Doc()
    const day = asId<'day'>('day-1')
    for (const doc of [peerA, peerB]) doc.transact(() => createDay(doc, day, '1', null))

    addPlace(peerA, 'a', day, '1')
    addPlace(peerA, 'z', day, '9')
    Y.applyUpdate(peerB, Y.encodeStateAsUpdate(peerA))

    // Both insert between 'a' and 'z' without seeing each other.
    addPlace(peerA, 'fromA', day, between('1', '9'))
    addPlace(peerB, 'fromB', day, between('1', '9'))

    Y.applyUpdate(peerA, Y.encodeStateAsUpdate(peerB))
    Y.applyUpdate(peerB, Y.encodeStateAsUpdate(peerA))

    const orderA = readTrip(peerA, TRIP as TripId).days[0].stops.map((p) => p.id)
    const orderB = readTrip(peerB, TRIP as TripId).days[0].stops.map((p) => p.id)

    expect(orderA).toEqual(orderB)
    expect(orderA).toHaveLength(4)
    expect(orderA[0]).toBe('a')
    expect(orderA[3]).toBe('z')
  })
})

export type { PlaceId }
