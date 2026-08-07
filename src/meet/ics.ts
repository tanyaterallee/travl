/**
 * iCalendar, both directions.
 *
 * Reading, because every itinerary tool worth linking — Wanderlog, Google
 * Calendar, Apple Calendar, TripIt — will hand you an `.ics` feed, and that is
 * the only interchange format all of them agree on. Writing, because the guest
 * confirmation needs an "add to calendar" that works on a phone whose owner
 * does not use Google Calendar.
 *
 * This is a deliberately small subset of RFC 5545: `VEVENT` blocks with times,
 * a title, a location and a description. Recurrence is skipped rather than
 * half-implemented — a wrong expansion of `RRULE` would silently invent busy
 * hours, and an itinerary that fabricates blocked afternoons is worse than one
 * that admits it only reads single events.
 */

export interface IcsEvent {
  uid: string
  summary: string
  location: string
  description: string
  /** ISO instant. */
  start: string
  end: string
  allDay: boolean
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

export function parseICS(text: string): IcsEvent[] {
  const out: IcsEvent[] = []
  let current: Partial<IcsEvent> | null = null
  let allDay = false

  for (const line of unfold(text)) {
    const upper = line.toUpperCase()
    if (upper.startsWith('BEGIN:VEVENT')) {
      current = { summary: '', location: '', description: '', uid: '' }
      allDay = false
      continue
    }
    if (upper.startsWith('END:VEVENT')) {
      if (current?.start) {
        const start = current.start
        // A VEVENT with no DTEND is an instant. Give it an hour so it occupies
        // something in the preview rather than a zero-width sliver nothing can
        // overlap.
        const end = current.end ?? new Date(new Date(start).getTime() + 3_600_000).toISOString()
        out.push({
          uid: current.uid || `${start}-${current.summary ?? ''}`,
          summary: current.summary ?? '',
          location: current.location ?? '',
          description: current.description ?? '',
          start,
          end,
          allDay,
        })
      }
      current = null
      continue
    }
    if (!current) continue

    const prop = parseLine(line)
    if (!prop) continue
    switch (prop.name) {
      case 'UID':
        current.uid = prop.value
        break
      case 'SUMMARY':
        current.summary = unescapeText(prop.value)
        break
      case 'LOCATION':
        current.location = unescapeText(prop.value)
        break
      case 'DESCRIPTION':
        current.description = unescapeText(prop.value)
        break
      case 'DTSTART': {
        const parsed = parseDate(prop.value, prop.params)
        if (parsed) {
          current.start = parsed.iso
          allDay = parsed.allDay
        }
        break
      }
      case 'DTEND': {
        const parsed = parseDate(prop.value, prop.params)
        if (parsed) current.end = parsed.iso
        break
      }
      default:
        break
    }
  }

  return out.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
}

/** RFC 5545 folds long lines; a continuation begins with a space or tab. */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').split('\n')
  const lines: string[] = []
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1)
    } else if (line.length > 0) {
      lines.push(line)
    }
  }
  return lines
}

interface Prop {
  name: string
  params: Record<string, string>
  value: string
}

function parseLine(line: string): Prop | null {
  // The value may contain colons (a URL, a time zone id), so the split is at
  // the first colon that is not inside a quoted parameter.
  let quoted = false
  let colon = -1
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') quoted = !quoted
    else if (ch === ':' && !quoted) {
      colon = i
      break
    }
  }
  if (colon < 0) return null

  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const [name, ...paramParts] = head.split(';')
  const params: Record<string, string> = {}
  for (const part of paramParts) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name: name.toUpperCase(), params, value }
}

function parseDate(value: string, params: Record<string, string>): { iso: string; allDay: boolean } | null {
  const v = value.trim()

  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(v)
  if (date) {
    const [, y, m, d] = date
    // An all-day entry belongs to the reader's own day, not to UTC midnight,
    // which is the previous evening for anyone west of Greenwich.
    return { iso: new Date(Number(y), Number(m) - 1, Number(d)).toISOString(), allDay: true }
  }

  const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v)
  if (!stamp) return null
  const [, y, mo, d, h, mi, s, z] = stamp
  const wall = { y: +y, mo: +mo, d: +d, h: +h, mi: +mi, s: +s }

  if (z === 'Z') {
    return { iso: new Date(Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s)).toISOString(), allDay: false }
  }
  const zone = params.TZID
  if (zone) {
    const iso = zonedToInstant(wall, zone)
    if (iso) return { iso, allDay: false }
  }
  // A floating time means "whatever the local clock says", which is exactly
  // what the reader's zone is.
  return { iso: new Date(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s).toISOString(), allDay: false }
}

interface Wall {
  y: number
  mo: number
  d: number
  h: number
  mi: number
  s: number
}

/**
 * Interpret a wall-clock time in a named zone, using the browser's own tz
 * database rather than shipping one.
 *
 * `Intl` will tell you what a given instant looks like in a zone, but not the
 * reverse, so this guesses the instant, measures how far off the guess lands,
 * and corrects. The second pass matters only near a DST boundary, where the
 * first correction can cross the transition it was measuring.
 */
export function zonedToInstant(wall: Wall, zone: string): string | null {
  const target = Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s)
  let guess = target
  try {
    for (let i = 0; i < 2; i++) {
      const offset = zoneOffsetMs(guess, zone)
      if (offset === null) return null
      const next = target - offset
      if (next === guess) break
      guess = next
    }
  } catch {
    return null
  }
  return new Date(guess).toISOString()
}

/** How far ahead of UTC `zone` is at `instant`, in milliseconds. */
function zoneOffsetMs(instant: number, zone: string): number | null {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant))

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const y = get('year')
  const mo = get('month')
  const d = get('day')
  // Intl renders midnight as hour 24 in some engines.
  const h = get('hour') % 24
  const mi = get('minute')
  const s = get('second')
  if ([y, mo, d, h, mi, s].some(Number.isNaN)) return null
  return Date.UTC(y, mo - 1, d, h, mi, s) - Math.floor(instant / 1000) * 1000
}

function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

export interface IcsDraft {
  uid: string
  title: string
  start: string
  end: string
  location?: string
  description?: string
  url?: string
  organizer?: { name: string; email: string }
}

/**
 * A one-event calendar, as bytes a browser will hand to whatever the phone
 * uses for calendars. Written in UTC so it needs no `VTIMEZONE` block, which
 * is the part of the format most likely to be rejected by a strict reader.
 */
export function toICS(event: IcsDraft): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//travl//meet//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(event.start)}`,
    `DTEND:${stamp(event.end)}`,
    `SUMMARY:${escapeText(event.title)}`,
  ]
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`)
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`)
  if (event.url) lines.push(`URL:${escapeText(event.url)}`)
  if (event.organizer?.email) {
    lines.push(`ORGANIZER;CN=${escapeText(event.organizer.name)}:mailto:${event.organizer.email}`)
  }
  lines.push('END:VEVENT', 'END:VCALENDAR')

  return lines.flatMap(fold).join('\r\n') + '\r\n'
}

export function stamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function escapeText(v: string): string {
  return v
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** Content lines are capped at 75 octets; continuations begin with a space. */
function fold(line: string): string[] {
  if (line.length <= 74) return [line]
  const out: string[] = []
  let rest = line
  out.push(rest.slice(0, 74))
  rest = rest.slice(74)
  while (rest.length > 0) {
    out.push(` ${rest.slice(0, 73)}`)
    rest = rest.slice(73)
  }
  return out
}
