import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createDay, createPlace, expensesOf, readTrip, upsertRecord } from './doc'
import { coordsOf } from './geo'
import { decodeSnapshot, docFromSnapshot, encodeSnapshot, isShareable, seal } from './share'
import { asId, type TripId } from './types'

const TRIP = asId<'trip'>('t')
const ACTOR = asId<'actor'>('a')

function buildTrip() {
  const doc = new Y.Doc()
  const day = asId<'day'>('day-1')
  doc.transact(() => {
    createDay(doc, day, '1', '2026-09-12')
    createPlace(
      doc,
      asId<'place'>('p1'),
      ACTOR,
      { name: 'The Bund', coords: coordsOf(31.2397, 121.4905, 'wgs84'), category: 'sight' },
      day,
      '1',
    )
    upsertRecord(expensesOf(doc), 'e1', {
      frac: '1',
      title: 'Dinner',
      amount: 480,
      category: 'food',
      paidBy: 'me',
      dayId: null,
      placeId: null,
    })
  })
  return doc
}

describe('seal', () => {
  it('round-trips the whole trip', () => {
    const doc = buildTrip()
    const restored = docFromSnapshot(encodeSnapshot(seal(doc)))

    const before = readTrip(doc, TRIP as TripId)
    const after = readTrip(restored, TRIP as TripId)

    expect(after.days).toHaveLength(before.days.length)
    expect(after.days[0].stops[0].name).toBe('The Bund')
    expect(after.budget.total).toBe(480)
  })

  it('strips an excluded section from the bytes, not just the view', () => {
    // Anyone can read a URL fragment, so hiding the budget in the UI would
    // still publish it. It has to be absent from the payload.
    const doc = buildTrip()
    const token = encodeSnapshot(seal(doc, { exclude: ['expenses'] }))
    const restored = docFromSnapshot(token)

    expect(readTrip(restored, TRIP as TripId).expenses).toHaveLength(0)
    expect(readTrip(restored, TRIP as TripId).budget.total).toBe(0)

    // And the amount is genuinely gone from the decompressed bytes.
    const raw = new TextDecoder('latin1').decode(decodeSnapshot(token))
    expect(raw).not.toContain('Dinner')

    // The rest of the trip survived the strip.
    expect(readTrip(restored, TRIP as TripId).days[0].stops[0].name).toBe('The Bund')
  })

  it('leaves the live trip untouched when a section is excluded', () => {
    // Sealing works on a copy. If it stripped in place, publishing a link
    // without the budget would delete the author's own expenses.
    const doc = buildTrip()
    seal(doc, { exclude: ['expenses'] })
    expect(readTrip(doc, TRIP as TripId).budget.total).toBe(480)
  })

  it('does not grow the payload when a trip has been edited heavily', () => {
    const doc = buildTrip()
    const summary = new Y.Text()
    doc.transact(() => doc.getMap('meta').set('summary', summary))
    for (let i = 0; i < 400; i++) doc.transact(() => summary.insert(summary.length, 'x'))
    doc.transact(() => summary.delete(0, summary.length - 10))

    // Yjs emits current state rather than an operation log, so the sealed
    // bytes track the surviving content, not the number of edits.
    expect(seal(doc).byteLength).toBeLessThanOrEqual(Y.encodeStateAsUpdate(doc).byteLength)
    expect(readTrip(docFromSnapshot(encodeSnapshot(seal(doc))), TRIP as TripId).summary).toHaveLength(
      10,
    )
  })

  it('produces a link small enough to send', () => {
    const doc = buildTrip()
    const token = encodeSnapshot(seal(doc))
    expect(isShareable(`https://example.com/#/s/${token}`)).toBe(true)
  })

  it('survives base64url characters that are unsafe in a URL', () => {
    // '+' and '/' from plain base64 would be mangled in a fragment.
    const doc = buildTrip()
    const token = encodeSnapshot(seal(doc))
    expect(token).not.toMatch(/[+/=]/)
    expect(() => docFromSnapshot(token)).not.toThrow()
  })
})
