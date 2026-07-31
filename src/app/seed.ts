import { coordsOf } from '../core/geo'
import { between } from '../core/frac'
import {
  addChecklistItem,
  createChecklist,
  createDay,
  createPlace,
  patchPlace,
  reservationsOf,
  setMeta,
  setSummary,
  upsertRecord,
} from '../core/doc'
import type { TripEngine } from '../core/engine'
import { asId } from '../core/types'
import { SEED_PLACES } from '../maps/places.data'

/**
 * A worked example trip.
 *
 * A blank planner is hard to evaluate, and this one deliberately spans
 * mainland China and Hong Kong so the provider switch and the GCJ-02 carve-out
 * are both visible in normal use rather than only in tests.
 */

const PLAN: { day: number; place: string; startTime?: string; cost?: number; note?: string }[] = [
  { day: 0, place: 'sh-bund', startTime: '09:00', note: 'Go early — the light is better and the crowds are thinner before 10.' },
  { day: 0, place: 'sh-nanjing', startTime: '11:30' },
  { day: 0, place: 'sh-museum', startTime: '14:00', cost: 0 },
  { day: 0, place: 'sh-xintiandi', startTime: '18:30', cost: 220, note: 'Dinner. Book ahead on weekends.' },

  { day: 1, place: 'sh-yu', startTime: '09:30', cost: 40 },
  { day: 1, place: 'sh-tianzifang', startTime: '13:00' },
  { day: 1, place: 'sh-pearl', startTime: '16:30', cost: 180 },

  { day: 2, place: 'bj-tiananmen', startTime: '08:30', note: 'Bring a passport — security check at the entrance.' },
  { day: 2, place: 'bj-forbidden', startTime: '09:30', cost: 60 },
  { day: 2, place: 'bj-nanluogu', startTime: '15:00' },
  { day: 2, place: 'bj-quanjude', startTime: '19:00', cost: 320 },

  { day: 3, place: 'bj-wall', startTime: '08:00', cost: 140, note: 'Full day. Take the cable car up, toboggan down.' },

  { day: 4, place: 'hk-peak', startTime: '10:00', cost: 99 },
  { day: 4, place: 'hk-tst', startTime: '18:00', note: 'Symphony of Lights at 20:00.' },
]

const WISHLIST = ['sh-jingan', 'sh-disney', 'bj-heaven', 'bj-summer', 'bj-798', 'hk-tst']

export function seedDemoTrip(engine: TripEngine): void {
  const byId = new Map(SEED_PLACES.map((p) => [p.id, p]))

  engine.mutate((doc) => {
    setMeta(doc, {
      title: 'Shanghai · Beijing · Hong Kong',
      startDate: '2026-09-12',
      endDate: '2026-09-16',
      currency: 'CNY',
      travelMode: 'drive',
    })
    setSummary(
      doc,
      'Five days across three cities, built around two high-speed rail legs. ' +
        'Shanghai first for the waterfront, then Beijing for the imperial sites and the wall, ' +
        'finishing in Hong Kong.',
    )

    // Days
    const dayIds: string[] = []
    let dayFrac: string | null = null
    for (let i = 0; i < 5; i++) {
      const id = crypto.randomUUID()
      dayFrac = between(dayFrac, null)
      const date = new Date(Date.UTC(2026, 8, 12 + i)).toISOString().slice(0, 10)
      createDay(doc, asId<'day'>(id), dayFrac, date)
      dayIds.push(id)
    }

    // Scheduled stops
    const fracByDay = new Map<number, string | null>()
    for (const entry of PLAN) {
      const seed = byId.get(entry.place)
      if (!seed) continue
      const prev = fracByDay.get(entry.day) ?? null
      const frac = between(prev, null)
      fracByDay.set(entry.day, frac)

      const placeId = asId<'place'>(crypto.randomUUID())
      createPlace(
        doc,
        placeId,
        engine.identity.actor,
        {
          name: seed.name,
          address: `${seed.address}, ${seed.city}`,
          category: seed.category,
          coords: coordsOf(seed.lat, seed.lng, 'wgs84'),
          rating: seed.rating,
          ratingCount: seed.ratingCount,
          notes: entry.note,
          cost: entry.cost,
          ref: { provider: 'local', id: seed.id },
        },
        asId<'day'>(dayIds[entry.day]),
        frac,
      )
      if (entry.startTime) patchPlace(doc, placeId, { startTime: entry.startTime })
    }

    // Wishlist
    let wishFrac: string | null = null
    for (const id of WISHLIST) {
      const seed = byId.get(id)
      if (!seed) continue
      wishFrac = between(wishFrac, null)
      createPlace(
        doc,
        asId<'place'>(crypto.randomUUID()),
        engine.identity.actor,
        {
          name: seed.name,
          address: `${seed.address}, ${seed.city}`,
          category: seed.category,
          coords: coordsOf(seed.lat, seed.lng, 'wgs84'),
          rating: seed.rating,
          ratingCount: seed.ratingCount,
          ref: { provider: 'local', id: seed.id },
        },
        null,
        wishFrac,
      )
    }

    // Reservations
    let resFrac = between(null, null)
    upsertRecord(reservationsOf(doc), crypto.randomUUID(), {
      frac: resFrac,
      kind: 'rail',
      title: 'Shanghai Hongqiao → Beijing South (G2)',
      confirmation: 'E1234567890',
      start: '2026-09-14T07:00',
      end: '2026-09-14T11:29',
      from: 'Shanghai Hongqiao',
      to: 'Beijing South',
      cost: 553,
      notes: 'Second class, car 8.',
    })
    resFrac = between(resFrac, null)
    upsertRecord(reservationsOf(doc), crypto.randomUUID(), {
      frac: resFrac,
      kind: 'lodging',
      title: 'The Peninsula Shanghai',
      confirmation: 'PSH-88214',
      start: '2026-09-12',
      end: '2026-09-14',
      from: '',
      to: '',
      cost: 4200,
      notes: 'Bund-facing room requested.',
    })
    resFrac = between(resFrac, null)
    upsertRecord(reservationsOf(doc), crypto.randomUUID(), {
      frac: resFrac,
      kind: 'flight',
      title: 'CA 109 · Beijing → Hong Kong',
      confirmation: 'QK7T2M',
      start: '2026-09-16T08:15',
      end: '2026-09-16T11:40',
      from: 'PEK',
      to: 'HKG',
      cost: 1890,
      notes: '',
    })

    // Checklist
    const listId = asId<'item'>(crypto.randomUUID())
    createChecklist(doc, listId, between(null, null), 'Before we go')
    let itemFrac: string | null = null
    for (const text of [
      'China visa — check validity',
      'Download offline maps',
      'Set up a VPN before landing',
      'Alipay / WeChat Pay linked to a card',
      'Passport copies in the shared folder',
      'Octopus card for Hong Kong',
    ]) {
      itemFrac = between(itemFrac, null)
      addChecklistItem(doc, listId, asId<'item'>(crypto.randomUUID()), itemFrac, text)
    }
  })
}
