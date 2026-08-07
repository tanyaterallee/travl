import { describe, expect, it } from 'vitest'
import { classifyLink, fromIcsText } from './itinerary'

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'X-WR-CALNAME:Shanghai · Beijing · Hong Kong',
  'BEGIN:VEVENT',
  'UID:wl-1',
  'DTSTART:20260912T013000Z',
  'DTEND:20260912T033000Z',
  'SUMMARY:The Bund walk',
  'LOCATION:Huangpu',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

describe('classifyLink', () => {
  it('recognises a calendar feed by its shape', () => {
    expect(classifyLink('https://example.com/trip.ics')).toBe('ics')
    expect(classifyLink('webcal://example.com/feed')).toBe('ics')
    expect(classifyLink('https://calendar.google.com/calendar/ical/x/basic.ics')).toBe('ics')
  })

  it('tells a Wanderlog trip page apart from a calendar', () => {
    expect(classifyLink('https://wanderlog.com/view/abc/shanghai-week')).toBe('wanderlog')
  })

  it('treats a Google Calendar web page as not-a-feed', () => {
    expect(classifyLink('https://calendar.google.com/calendar/u/0/r')).toBe('gcal')
  })

  it('has no opinion about anything else', () => {
    expect(classifyLink('https://example.com/trip')).toBe('unknown')
    expect(classifyLink('   ')).toBe('unknown')
  })
})

describe('fromIcsText', () => {
  it('names the source from the calendar itself when the URL cannot', () => {
    const result = fromIcsText(ICS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source.label).toBe('Shanghai · Beijing · Hong Kong')
    expect(result.events[0].source).toBe('Shanghai · Beijing · Hong Kong')
  })

  it('carries the location through, so a blocked hour can say where', () => {
    const result = fromIcsText(ICS)
    expect(result.ok && result.events[0].location).toBe('Huangpu')
  })

  it('namespaces ids, so two sources cannot collide', () => {
    const result = fromIcsText(ICS)
    expect(result.ok && result.events[0].id).toBe('ics:wl-1')
  })

  it('rejects a login page rather than importing zero events from it', () => {
    expect(fromIcsText('<html><body>Sign in</body></html>')).toEqual({
      ok: false,
      problem: 'notCalendar',
    })
  })

  it('reports an empty calendar as empty', () => {
    expect(fromIcsText('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR')).toEqual({
      ok: false,
      problem: 'empty',
    })
  })
})
