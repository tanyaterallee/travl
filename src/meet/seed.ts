import { coordsOf } from '../core/geo'
import { asId } from '../core/types'
import { SEED_PLACES } from '../maps/places.data'
import { createBooking, createSlot, setItinerary, setPage } from './doc'
import type { MeetEngine } from './engine'
import { localZone } from './schedule'
import type { BusyEvent } from './types'

/**
 * A worked example page.
 *
 * An empty scheduling page is impossible to judge: the whole design question
 * is whether three states are distinguishable at a glance, and a blank
 * calendar shows none of them. So the example deliberately contains one of
 * each — an open afternoon, an hour somebody has already taken, and a slot the
 * linked itinerary has swallowed — plus a second-choice hold, which is the one
 * concept in this app that nothing else on the market has.
 *
 * Dates are relative to today so the example is never a page of expired slots.
 */

interface SlotSpec {
  dayOffset: number
  from: [number, number]
  to: [number, number]
  title: string
  place: string
  blurb: string
}

const SLOTS: SlotSpec[] = [
  {
    dayOffset: 1,
    from: [10, 0],
    to: [11, 0],
    title: 'Coffee on the waterfront',
    place: 'sh-bund',
    blurb: 'An hour by the water before the crowds arrive. Coffee is on me.',
  },
  {
    dayOffset: 1,
    from: [16, 0],
    to: [17, 30],
    title: 'Dumplings at Yu Garden',
    place: 'sh-yu',
    blurb: 'The queue moves faster than it looks. Come hungry.',
  },
  {
    dayOffset: 2,
    from: [14, 0],
    to: [15, 30],
    title: 'Wander through Tianzifang',
    place: 'sh-tianzifang',
    blurb: 'Lanes, tea, and far too many small shops. Easy walking.',
  },
  {
    dayOffset: 3,
    from: [19, 0],
    to: [21, 0],
    title: 'Dinner at Xintiandi',
    place: 'sh-xintiandi',
    blurb: 'A long dinner. Bring anyone you like.',
  },
  {
    dayOffset: 4,
    from: [9, 30],
    to: [11, 0],
    title: 'Museum morning',
    place: 'sh-museum',
    blurb: 'Two floors, then out. Free entry, no ticket needed.',
  },
]

const BUSY: { dayOffset: number; from: [number, number]; to: [number, number]; title: string; location: string }[] = [
  { dayOffset: 2, from: [8, 0], to: [12, 30], title: 'Pearl Tower with the group', location: 'Lujiazui, Pudong' },
  { dayOffset: 3, from: [18, 0], to: [22, 0], title: 'Rooftop dinner — already booked', location: 'The Bund' },
]

export function seedMeetPage(engine: MeetEngine): void {
  const byId = new Map(SEED_PLACES.map((p) => [p.id, p]))
  const slotIds: string[] = []

  engine.mutate((doc) => {
    setPage(doc, {
      title: 'Shanghai, this week',
      headline: 'I am here until Sunday. Take an hour — these are the ones I have free.',
      ownerName: 'Tanya',
      timezone: localZone(),
    })

    for (const spec of SLOTS) {
      const place = byId.get(spec.place)
      const id = asId<'slot'>(crypto.randomUUID())
      slotIds.push(id)
      createSlot(doc, id, {
        start: at(spec.dayOffset, spec.from),
        end: at(spec.dayOffset, spec.to),
        title: spec.title,
        locationName: place?.name ?? '',
        address: place ? `${place.address}, ${place.city}` : '',
        coords: place ? coordsOf(place.lat, place.lng, 'wgs84') : null,
        blurb: spec.blurb,
      })
    }

    const busy: BusyEvent[] = BUSY.map((b, i) => ({
      id: `example:${i}`,
      title: b.title,
      start: at(b.dayOffset, b.from),
      end: at(b.dayOffset, b.to),
      location: b.location,
      description: '',
      source: 'Shanghai · Beijing · Hong Kong',
    }))
    setItinerary(
      doc,
      {
        kind: 'trip',
        label: 'Shanghai · Beijing · Hong Kong',
        url: '#/',
        calendarId: 'my-trip',
        importedAt: Date.now(),
      },
      busy,
    )

    // One guest, booked in and hedging — the two halves of the booking rule.
    createBooking(doc, asId<'booking'>(crypto.randomUUID()), {
      slotId: asId<'slot'>(slotIds[1]),
      name: 'Mei Chen',
      email: 'mei@example.com',
      kind: 'primary',
      note: 'Bringing my sister if that is all right.',
    })
    createBooking(doc, asId<'booking'>(crypto.randomUUID()), {
      slotId: asId<'slot'>(slotIds[2]),
      name: 'Mei Chen',
      email: 'mei@example.com',
      kind: 'tentative',
    })
  })
}

/** Local wall-clock time, `days` from today. */
function at(days: number, [hour, minute]: [number, number]): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}
