import { describe, expect, it } from 'vitest'
import { parseICS, toICS, zonedToInstant } from './ics'

const SAMPLE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Wanderlog//trip//EN',
  'BEGIN:VEVENT',
  'UID:wl-1',
  'DTSTART:20260912T013000Z',
  'DTEND:20260912T033000Z',
  'SUMMARY:The Bund walk',
  'LOCATION:Zhongshan East 1st Rd\\, Huangpu\\, Shanghai',
  'DESCRIPTION:Go early — the light is better',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:wl-2',
  'DTSTART;VALUE=DATE:20260913',
  'DTEND;VALUE=DATE:20260914',
  'SUMMARY:Free day',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

describe('parseICS', () => {
  it('reads a timed event, unescaping the text fields', () => {
    const [first] = parseICS(SAMPLE)
    expect(first.uid).toBe('wl-1')
    expect(first.summary).toBe('The Bund walk')
    expect(first.location).toBe('Zhongshan East 1st Rd, Huangpu, Shanghai')
    expect(first.start).toBe('2026-09-12T01:30:00.000Z')
    expect(first.end).toBe('2026-09-12T03:30:00.000Z')
    expect(first.allDay).toBe(false)
  })

  it('reads an all-day event into the local day, not UTC midnight', () => {
    const [, second] = parseICS(SAMPLE)
    expect(second.allDay).toBe(true)
    // Anywhere west of Greenwich, a UTC-midnight reading would land this on
    // the 12th and block the wrong afternoon.
    expect(new Date(second.start).getDate()).toBe(13)
  })

  it('unfolds continuation lines', () => {
    const folded = [
      'BEGIN:VEVENT',
      'UID:x',
      'DTSTART:20260912T060000Z',
      'DTEND:20260912T070000Z',
      'SUMMARY:A title long enough that a calendar server would wrap it in the',
      '  middle',
      'END:VEVENT',
    ].join('\r\n')
    expect(parseICS(folded)[0].summary).toBe(
      'A title long enough that a calendar server would wrap it in the middle',
    )
  })

  it('gives an event with no DTEND an hour of its own', () => {
    const open = ['BEGIN:VEVENT', 'UID:x', 'DTSTART:20260912T060000Z', 'SUMMARY:Ping', 'END:VEVENT'].join('\r\n')
    const [e] = parseICS(open)
    expect(new Date(e.end).getTime() - new Date(e.start).getTime()).toBe(3_600_000)
  })

  it('honours TZID rather than reading the time as local', () => {
    const zoned = [
      'BEGIN:VEVENT',
      'UID:z',
      'DTSTART;TZID=Asia/Shanghai:20260912T140000',
      'DTEND;TZID=Asia/Shanghai:20260912T150000',
      'SUMMARY:Tea',
      'END:VEVENT',
    ].join('\r\n')
    // 14:00 in UTC+8 is 06:00Z, whatever zone the test runner is in.
    expect(parseICS(zoned)[0].start).toBe('2026-09-12T06:00:00.000Z')
  })

  it('sorts what it returns by start time', () => {
    const out = parseICS(SAMPLE)
    expect(new Date(out[0].start).getTime()).toBeLessThan(new Date(out[1].start).getTime())
  })

  it('returns nothing for something that is not a calendar', () => {
    expect(parseICS('<!doctype html><html><body>Not found</body></html>')).toEqual([])
  })
})

describe('zonedToInstant', () => {
  it('resolves a summer time wall clock', () => {
    // 01:00 UTC on 1 July 2026; Europe/Berlin is UTC+2 in July.
    expect(zonedToInstant({ y: 2026, mo: 7, d: 1, h: 3, mi: 0, s: 0 }, 'Europe/Berlin')).toBe(
      '2026-07-01T01:00:00.000Z',
    )
  })

  it('resolves a winter time wall clock in the same zone', () => {
    expect(zonedToInstant({ y: 2026, mo: 1, d: 15, h: 3, mi: 0, s: 0 }, 'Europe/Berlin')).toBe(
      '2026-01-15T02:00:00.000Z',
    )
  })
})

describe('toICS', () => {
  const draft = {
    uid: 'travl-1',
    title: 'Coffee, then a walk',
    start: '2026-09-12T06:00:00.000Z',
    end: '2026-09-12T07:00:00.000Z',
    location: 'The Bund; Shanghai',
    description: 'Line one\nLine two',
  }

  it('escapes the characters that would otherwise end the property', () => {
    const out = toICS(draft)
    expect(out).toContain('SUMMARY:Coffee\\, then a walk')
    expect(out).toContain('LOCATION:The Bund\\; Shanghai')
    expect(out).toContain('DESCRIPTION:Line one\\nLine two')
  })

  it('writes UTC stamps so no VTIMEZONE block is needed', () => {
    expect(toICS(draft)).toContain('DTSTART:20260912T060000Z')
  })

  it('round-trips through the parser', () => {
    const [back] = parseICS(toICS(draft))
    expect(back.summary).toBe(draft.title)
    expect(back.location).toBe(draft.location)
    expect(back.description).toBe(draft.description)
    expect(back.start).toBe(draft.start)
    expect(back.end).toBe(draft.end)
  })

  it('folds long lines and unfolds back to the original text', () => {
    const long = { ...draft, description: 'x'.repeat(300) }
    const out = toICS(long)
    for (const line of out.split('\r\n')) expect(line.length).toBeLessThanOrEqual(74)
    expect(parseICS(out)[0].description).toBe(long.description)
  })

  it('ends every line with CRLF, which strict readers require', () => {
    expect(toICS(draft).endsWith('\r\n')).toBe(true)
    expect(toICS(draft).includes('\n\n')).toBe(false)
  })
})
