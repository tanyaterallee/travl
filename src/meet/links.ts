import { toWGS84, type Coords } from '../core/geo'
import { stamp } from './ics'

/**
 * The outbound links.
 *
 * Everything here is built from a documented, key-free URL scheme rather than
 * an SDK, because these have to survive being tapped on a stranger's phone.
 * Google's `?api=1` maps URLs and the calendar `render` endpoint both hand off
 * to the native app when one is installed and fall back to the web when it is
 * not — which is what "works on mobile and desktop" actually requires.
 */

export interface CalendarDraft {
  title: string
  start: string
  end: string
  details?: string
  location?: string
}

/**
 * "Add to Google Calendar" — a pre-filled compose screen, not an API write.
 *
 * The guest is not signed in to anything here, so there is nothing to write
 * *to*: the link opens their own calendar with the event filled in and lets
 * them press save. Times go in as UTC (`…Z`) so the event lands at the right
 * instant regardless of the zone their account is set to.
 */
export function googleCalendarUrl(draft: CalendarDraft): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: draft.title,
    dates: `${stamp(draft.start)}/${stamp(draft.end)}`,
  })
  if (draft.details) params.set('details', draft.details)
  if (draft.location) params.set('location', draft.location)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/** Outlook Web, for the guests who are not on Google. Same idea, other host. */
export function outlookCalendarUrl(draft: CalendarDraft): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: draft.title,
    startdt: new Date(draft.start).toISOString(),
    enddt: new Date(draft.end).toISOString(),
  })
  if (draft.details) params.set('body', draft.details)
  if (draft.location) params.set('location', draft.location)
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`
}

/* -------------------------------------------------------------------------- */
/* Maps                                                                       */
/* -------------------------------------------------------------------------- */

export interface PlaceLike {
  locationName: string
  address: string
  coords: Coords | null
}

/**
 * What to hand Google Maps for a place.
 *
 * Coordinates win when we have them: a name plus an address is a search, and
 * a search for "Coffee" in a city the guest has never been to can land
 * anywhere. The name still rides along as a label so the pin is not a bare
 * number.
 */
export function mapsQuery(place: PlaceLike): string {
  if (place.coords) {
    const { lat, lng } = toWGS84(place.coords)
    return `${lat.toFixed(6)},${lng.toFixed(6)}`
  }
  return [place.locationName, place.address].filter(Boolean).join(', ')
}

/** The universal cross-platform maps link: app on a phone, web on a desktop. */
export function mapsSearchUrl(place: PlaceLike): string {
  const params = new URLSearchParams({ api: '1', query: mapsQuery(place) })
  return `https://www.google.com/maps/search/?${params.toString()}`
}

export function mapsDirectionsUrl(place: PlaceLike): string {
  const params = new URLSearchParams({ api: '1', destination: mapsQuery(place) })
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

/**
 * The embedded map on the slot detail.
 *
 * With a Maps key this is the official Embed API. Without one it falls back to
 * the long-standing `output=embed` view, so the guest still sees where they
 * are going on a keyless deployment — the same principle as the rest of the
 * app, where a missing key costs quality and never function.
 */
export function mapsEmbedUrl(place: PlaceLike, opts: { key?: string; locale?: string } = {}): string {
  const q = mapsQuery(place)
  const hl = opts.locale === 'zh' ? 'zh-CN' : 'en'
  if (opts.key) {
    const params = new URLSearchParams({ key: opts.key, q, zoom: '15', language: hl })
    return `https://www.google.com/maps/embed/v1/place?${params.toString()}`
  }
  const params = new URLSearchParams({ q, z: '15', hl, output: 'embed' })
  return `https://maps.google.com/maps?${params.toString()}`
}

/* -------------------------------------------------------------------------- */
/* The booking link                                                           */
/* -------------------------------------------------------------------------- */

/** The link the owner hands out. Same origin, guest route, page id in the hash. */
export function bookingUrl(pageId: string, origin = window.location.href): string {
  return `${origin.split('#')[0]}#/book/${encodeURIComponent(pageId)}`
}

/** A `mailto:` that already contains the plan, for sending the link by hand. */
export function inviteMailto(opts: {
  to?: string
  ownerName: string
  pageTitle: string
  url: string
}): string {
  const subject = `${opts.pageTitle} — pick a time`
  const body =
    `Hi,\n\n${opts.ownerName} has a few free hours on this trip. ` +
    `Take whichever suits you:\n\n${opts.url}\n`
  const params = new URLSearchParams({ subject, body })
  return `mailto:${opts.to ?? ''}?${params.toString()}`
}
