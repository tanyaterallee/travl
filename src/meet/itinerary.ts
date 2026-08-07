import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { readTrip } from '../core/doc'
import { asId, type TripId } from '../core/types'
import { parseICS } from './ics'
import { eventInstant, listEvents, type GEvent } from './google'
import type { BusyEvent, ItinerarySource } from './types'

/**
 * Where "already busy" comes from.
 *
 * The owner has a plan somewhere else — in Wanderlog, in Google Calendar, or
 * in this app's own planner — and the point of linking it is that they should
 * never have to restate it here. Everything an import produces is a
 * `BusyEvent`, so the calendar preview does not care which of the four paths
 * filled it in.
 *
 * ## What can and cannot be fetched from a browser
 *
 * A public `.ics` feed can be read directly when its host sends CORS headers,
 * and many do not. There is no clever way around that from a static site: a
 * proxy would mean a server, and a server that fetches arbitrary URLs on a
 * user's behalf is a liability rather than a feature. So the fetch is
 * attempted, and when the network refuses, the owner is asked to paste the
 * file instead — which always works, needs no permissions, and takes about as
 * long as pressing a button.
 *
 * A Wanderlog *trip page* is not a calendar. Wanderlog's own export produces
 * an `.ics`, and that is what this accepts; guessing at an internal endpoint
 * would produce an integration that breaks the first time they change it.
 */

export type ImportProblem =
  | 'empty'
  | 'blocked'
  | 'notCalendar'
  | 'network'
  | 'needsIcs'
  | 'noTrip'
  | 'noCalendar'

export type ImportResult =
  | { ok: true; source: ItinerarySource; events: BusyEvent[] }
  | { ok: false; problem: ImportProblem }

export type LinkKind = 'ics' | 'wanderlog' | 'gcal' | 'unknown'

/** What the owner just pasted, judged by its shape rather than by asking. */
export function classifyLink(raw: string): LinkKind {
  const value = raw.trim().toLowerCase()
  if (!value) return 'unknown'
  if (value.startsWith('webcal://') || value.endsWith('.ics') || value.includes('.ics?')) return 'ics'
  if (value.includes('/ical/') || value.includes('format=ical')) return 'ics'
  if (value.includes('wanderlog.com')) return 'wanderlog'
  if (value.includes('calendar.google.com')) return 'gcal'
  return 'unknown'
}

/** `webcal:` is `https:` wearing a hat that tells the OS to subscribe. */
function normalizeUrl(raw: string): string {
  const value = raw.trim()
  return value.startsWith('webcal://') ? `https://${value.slice('webcal://'.length)}` : value
}

/* -------------------------------------------------------------------------- */
/* From a link                                                                */
/* -------------------------------------------------------------------------- */

export async function importFromUrl(rawUrl: string): Promise<ImportResult> {
  const kind = classifyLink(rawUrl)
  if (kind === 'wanderlog' || kind === 'gcal') {
    // Both hand out an .ics of their own; the page URL is not one.
    return { ok: false, problem: 'needsIcs' }
  }

  const url = normalizeUrl(rawUrl)
  let text: string
  try {
    const res = await fetch(url, { headers: { Accept: 'text/calendar,text/plain' } })
    if (!res.ok) return { ok: false, problem: res.status === 404 ? 'notCalendar' : 'network' }
    text = await res.text()
  } catch {
    // A cross-origin refusal and an offline browser are indistinguishable from
    // here, so the message offers the paste route, which fixes both.
    return { ok: false, problem: 'blocked' }
  }

  return fromIcsText(text, { url, label: labelFromUrl(url) })
}

export function fromIcsText(
  text: string,
  meta: { url?: string; label?: string } = {},
): ImportResult {
  if (!text.toUpperCase().includes('BEGIN:VCALENDAR')) return { ok: false, problem: 'notCalendar' }

  const label = meta.label || calendarName(text) || 'Linked itinerary'
  const parsed = parseICS(text)
  if (parsed.length === 0) return { ok: false, problem: 'empty' }

  return {
    ok: true,
    source: {
      kind: 'ics',
      label,
      url: meta.url ?? '',
      calendarId: '',
      importedAt: Date.now(),
    },
    events: parsed.map((e) => ({
      id: `ics:${e.uid}`,
      title: e.summary || 'Busy',
      start: e.start,
      end: e.end,
      location: e.location,
      description: e.description,
      source: label,
    })),
  }
}

function calendarName(text: string): string {
  const named = /X-WR-CALNAME:(.+)/i.exec(text)
  return named ? named[1].trim() : ''
}

function labelFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/* -------------------------------------------------------------------------- */
/* From Google Calendar                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A window around the trip rather than the whole calendar. A year of the
 * owner's meetings would bury the fortnight anyone is actually booking, and
 * it is a great deal of somebody's private schedule to copy into a document a
 * guest can read.
 */
export async function importFromGoogle(
  token: string,
  calendar: { id: string; summary: string },
  range: { from: string; to: string },
): Promise<ImportResult> {
  let items: GEvent[]
  try {
    items = await listEvents(token, calendar.id, range)
  } catch {
    return { ok: false, problem: 'network' }
  }

  const events: BusyEvent[] = []
  for (const item of items) {
    const start = eventInstant(item.start)
    const end = eventInstant(item.end)
    if (!start || !end) continue
    events.push({
      id: `gcal:${item.id}`,
      title: item.summary || 'Busy',
      start,
      end,
      location: item.location ?? '',
      description: item.description ?? '',
      source: calendar.summary,
    })
  }

  if (events.length === 0) return { ok: false, problem: 'empty' }
  return {
    ok: true,
    source: {
      kind: 'gcal',
      label: calendar.summary,
      url: '',
      calendarId: calendar.id,
      importedAt: Date.now(),
    },
    events,
  }
}

/* -------------------------------------------------------------------------- */
/* From a travl trip                                                          */
/* -------------------------------------------------------------------------- */

/** How long a stop with no stated duration occupies. */
const DEFAULT_STOP_MIN = 90

/**
 * The trip planned in this very app, read straight out of its document.
 *
 * This is the path with no network, no keys and no CORS, and it is the one
 * that knows the most: a stop carries its own address and coordinates, so a
 * blocked afternoon can say *where* rather than only *when*.
 *
 * Only stops with a time are imported. A wishlist place, or a stop on a day
 * with no date, is a plan without an hour attached — inventing one would block
 * an afternoon the owner never claimed.
 */
export async function importFromTrip(tripId: string): Promise<ImportResult> {
  const doc = new Y.Doc({ guid: tripId })
  const persistence = new IndexeddbPersistence(`travl:${tripId}`, doc)
  try {
    await persistence.whenSynced
    const trip = readTrip(doc, asId<'trip'>(tripId) as TripId)

    const events: BusyEvent[] = []
    for (const day of trip.days) {
      if (!day.date) continue
      for (const stop of day.stops) {
        if (!stop.startTime) continue
        const start = atLocal(day.date, stop.startTime)
        if (!start) continue
        const minutes = stop.durationMin ?? DEFAULT_STOP_MIN
        events.push({
          id: `trip:${stop.id}`,
          title: stop.name,
          start,
          end: new Date(new Date(start).getTime() + minutes * 60_000).toISOString(),
          location: stop.address,
          description: stop.notes,
          source: trip.title,
        })
      }
    }

    if (events.length === 0) return { ok: false, problem: 'noTrip' }
    return {
      ok: true,
      source: {
        kind: 'trip',
        label: trip.title || 'My trip',
        url: `#/`,
        calendarId: tripId,
        importedAt: Date.now(),
      },
      events,
    }
  } finally {
    // The document was opened only to read it; leaving it attached would keep
    // a second IndexedDB connection open for the life of the tab.
    persistence.destroy()
    doc.destroy()
  }
}

/** `2026-09-12` + `14:30` in the owner's own zone. */
function atLocal(date: string, time: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!d || !t) return null
  const at = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]))
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}
