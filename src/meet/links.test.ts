import { describe, expect, it } from 'vitest'
import { coordsOf } from '../core/geo'
import { googleCalendarUrl, mapsEmbedUrl, mapsQuery, mapsSearchUrl, outlookCalendarUrl } from './links'

const draft = {
  title: 'Coffee at the Bund',
  start: '2026-09-12T06:00:00.000Z',
  end: '2026-09-12T07:00:00.000Z',
  location: 'Zhongshan East 1st Rd, Shanghai',
  details: 'Booked through travl',
}

describe('googleCalendarUrl', () => {
  it('builds a TEMPLATE link with a UTC date range', () => {
    const url = new URL(googleCalendarUrl(draft))
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('dates')).toBe('20260912T060000Z/20260912T070000Z')
    expect(url.searchParams.get('text')).toBe(draft.title)
    expect(url.searchParams.get('location')).toBe(draft.location)
  })

  it('escapes rather than drops a title with an ampersand', () => {
    const url = new URL(googleCalendarUrl({ ...draft, title: 'Tea & dumplings' }))
    expect(url.searchParams.get('text')).toBe('Tea & dumplings')
  })
})

describe('outlookCalendarUrl', () => {
  it('builds a compose deeplink with ISO times', () => {
    const url = new URL(outlookCalendarUrl(draft))
    expect(url.searchParams.get('rru')).toBe('addevent')
    expect(url.searchParams.get('startdt')).toBe('2026-09-12T06:00:00.000Z')
  })
})

describe('maps links', () => {
  const withCoords = {
    locationName: 'The Bund',
    address: 'Zhongshan East 1st Rd',
    coords: coordsOf(31.2397, 121.4903, 'wgs84'),
  }
  const withoutCoords = { locationName: 'The Bund', address: 'Shanghai', coords: null }

  it('prefers coordinates over a name search', () => {
    expect(mapsQuery(withCoords)).toBe('31.239700,121.490300')
  })

  it('falls back to name and address when there is no pin', () => {
    expect(mapsQuery(withoutCoords)).toBe('The Bund, Shanghai')
  })

  it('uses the cross-platform search URL, which opens the app on a phone', () => {
    const url = new URL(mapsSearchUrl(withCoords))
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/search/')
    expect(url.searchParams.get('api')).toBe('1')
    expect(url.searchParams.get('query')).toBe('31.239700,121.490300')
  })

  it('embeds through the official API when a key is configured', () => {
    const url = new URL(mapsEmbedUrl(withCoords, { key: 'abc123' }))
    expect(url.pathname).toBe('/maps/embed/v1/place')
    expect(url.searchParams.get('key')).toBe('abc123')
  })

  it('still embeds a map with no key at all', () => {
    const url = new URL(mapsEmbedUrl(withCoords))
    expect(url.searchParams.get('output')).toBe('embed')
    expect(url.searchParams.get('q')).toBe('31.239700,121.490300')
  })
})
