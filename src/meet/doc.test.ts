import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { coordsOf, toWGS84 } from '../core/geo'
import { asId } from '../core/types'
import {
  createBooking,
  createSlot,
  clearItinerary,
  patchSlot,
  readPage,
  removeSlot,
  setItinerary,
  setPage,
} from './doc'
import type { BusyEvent, ItinerarySource } from './types'

const SOURCE: ItinerarySource = {
  kind: 'ics',
  label: 'Shanghai week',
  url: 'https://wanderlog.com/trip/x.ics',
  calendarId: '',
  importedAt: 1,
}

const event = (id: string, start: string, end: string): BusyEvent => ({
  id,
  title: 'Great Wall',
  start,
  end,
  location: 'Mutianyu',
  description: '',
  source: 'Wanderlog',
})

function docWithSlot() {
  const doc = new Y.Doc()
  const id = asId<'slot'>('s1')
  createSlot(doc, id, {
    start: '2026-09-12T06:00:00.000Z',
    end: '2026-09-12T07:00:00.000Z',
    title: 'Coffee',
    locationName: 'The Bund',
    address: 'Zhongshan East 1st Rd',
    coords: coordsOf(31.2397, 121.4903, 'wgs84'),
    blurb: 'Twenty minutes of skyline',
  })
  return { doc, id }
}

describe('readPage', () => {
  it('reads an empty document without inventing anything', () => {
    const page = readPage(new Y.Doc())
    expect(page.slots).toEqual([])
    expect(page.bookings).toEqual([])
    expect(page.busy).toEqual([])
    expect(page.source.kind).toBe('none')
  })

  it('round-trips a slot, coordinates included', () => {
    const { doc } = docWithSlot()
    const [slot] = readPage(doc).slots
    expect(slot.title).toBe('Coffee')
    expect(slot.locationName).toBe('The Bund')
    expect(toWGS84(slot.coords!).lat).toBeCloseTo(31.2397, 5)
  })

  it('returns slots in time order regardless of insertion order', () => {
    const doc = new Y.Doc()
    createSlot(doc, asId<'slot'>('late'), { start: '2026-09-14T06:00:00.000Z', end: '2026-09-14T07:00:00.000Z', title: 'b' })
    createSlot(doc, asId<'slot'>('early'), { start: '2026-09-12T06:00:00.000Z', end: '2026-09-12T07:00:00.000Z', title: 'a' })
    expect(readPage(doc).slots.map((s) => s.id)).toEqual([asId<'slot'>('early'), asId<'slot'>('late')])
  })

  it('ignores a half-written slot rather than rendering a broken card', () => {
    const doc = new Y.Doc()
    doc.getMap('meet:slots').set('junk', new Y.Map())
    expect(readPage(doc).slots).toEqual([])
  })
})

describe('removeSlot', () => {
  it('takes the bookings that pointed at it with it', () => {
    const { doc, id } = docWithSlot()
    createBooking(doc, asId<'booking'>('b1'), { slotId: id, name: 'Mei', email: 'mei@example.com', kind: 'primary' })
    createBooking(doc, asId<'booking'>('b2'), { slotId: asId<'slot'>('other'), name: 'Sam', email: 'sam@example.com', kind: 'primary' })

    removeSlot(doc, id)

    const page = readPage(doc)
    expect(page.slots).toEqual([])
    expect(page.bookings.map((b) => b.id)).toEqual([asId<'booking'>('b2')])
  })
})

describe('the itinerary cache', () => {
  it('replaces rather than merges, so a deleted stop stops blocking', () => {
    const doc = new Y.Doc()
    setItinerary(doc, SOURCE, [
      event('a', '2026-09-12T01:00:00.000Z', '2026-09-12T04:00:00.000Z'),
      event('b', '2026-09-13T01:00:00.000Z', '2026-09-13T04:00:00.000Z'),
    ])
    setItinerary(doc, SOURCE, [event('a', '2026-09-12T01:00:00.000Z', '2026-09-12T04:00:00.000Z')])

    expect(readPage(doc).busy.map((e) => e.id)).toEqual(['a'])
  })

  it('unlinks completely', () => {
    const doc = new Y.Doc()
    setItinerary(doc, SOURCE, [event('a', '2026-09-12T01:00:00.000Z', '2026-09-12T04:00:00.000Z')])
    clearItinerary(doc)
    const page = readPage(doc)
    expect(page.busy).toEqual([])
    expect(page.source.kind).toBe('none')
  })
})

describe('concurrent editing', () => {
  it('keeps both bookings when two guests book at the same moment', () => {
    const owner = new Y.Doc()
    createSlot(owner, asId<'slot'>('s1'), { start: '2026-09-12T06:00:00.000Z', end: '2026-09-12T07:00:00.000Z', title: 'Coffee' })
    createSlot(owner, asId<'slot'>('s2'), { start: '2026-09-12T09:00:00.000Z', end: '2026-09-12T10:00:00.000Z', title: 'Walk' })

    // Two guests, each with a copy, neither having seen the other's write.
    const mei = new Y.Doc()
    const sam = new Y.Doc()
    Y.applyUpdate(mei, Y.encodeStateAsUpdate(owner))
    Y.applyUpdate(sam, Y.encodeStateAsUpdate(owner))

    createBooking(mei, asId<'booking'>('b-mei'), { slotId: asId<'slot'>('s1'), name: 'Mei', email: 'mei@example.com', kind: 'primary' })
    createBooking(sam, asId<'booking'>('b-sam'), { slotId: asId<'slot'>('s2'), name: 'Sam', email: 'sam@example.com', kind: 'primary' })

    Y.applyUpdate(owner, Y.encodeStateAsUpdate(mei))
    Y.applyUpdate(owner, Y.encodeStateAsUpdate(sam))
    Y.applyUpdate(mei, Y.encodeStateAsUpdate(owner))
    Y.applyUpdate(sam, Y.encodeStateAsUpdate(owner))

    for (const doc of [owner, mei, sam]) {
      expect(readPage(doc).bookings.map((b) => b.id).sort()).toEqual([
        asId<'booking'>('b-mei'),
        asId<'booking'>('b-sam'),
      ])
    }
  })

  it('converges when the owner edits a slot while a guest books it', () => {
    const owner = new Y.Doc()
    const id = asId<'slot'>('s1')
    createSlot(owner, id, { start: '2026-09-12T06:00:00.000Z', end: '2026-09-12T07:00:00.000Z', title: 'Coffee' })

    const guest = new Y.Doc()
    Y.applyUpdate(guest, Y.encodeStateAsUpdate(owner))

    patchSlot(owner, id, { title: 'Coffee and a walk' })
    createBooking(guest, asId<'booking'>('b1'), { slotId: id, name: 'Mei', email: 'mei@example.com', kind: 'primary' })

    Y.applyUpdate(owner, Y.encodeStateAsUpdate(guest))
    Y.applyUpdate(guest, Y.encodeStateAsUpdate(owner))

    const a = readPage(owner)
    const b = readPage(guest)
    expect(a.slots[0].title).toBe('Coffee and a walk')
    expect(b.slots[0].title).toBe('Coffee and a walk')
    expect(a.bookings).toHaveLength(1)
    expect(b.bookings).toHaveLength(1)
  })
})

describe('setPage', () => {
  it('leaves untouched fields alone', () => {
    const doc = new Y.Doc()
    setPage(doc, { title: 'Shanghai week', ownerName: 'Tanya' })
    setPage(doc, { headline: 'Free afternoons' })
    const page = readPage(doc)
    expect(page.title).toBe('Shanghai week')
    expect(page.ownerName).toBe('Tanya')
    expect(page.headline).toBe('Free afternoons')
  })
})
