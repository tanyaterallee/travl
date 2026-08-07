import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Sign in with Google, and the slice of Google Calendar this app writes to.
 *
 * ## Why there is no back end
 *
 * The browser flow (Google Identity Services, OAuth 2.0 implicit) needs a
 * client id and no client secret, which is what lets the whole of travl stay a
 * static site. The authorization-code flow would be sturdier — refresh tokens,
 * offline sync, a token the page never sees — but it needs a server holding a
 * secret, and that server would then need accounts, sessions and a database,
 * which is a different product from this one.
 *
 * ## Where the token lives
 *
 * In memory. Not `localStorage`, not a cookie: an access token in storage is
 * readable by any script that ever gets injected into the page, and it grants
 * write access to the user's calendar. The cost of that choice is a silent
 * re-authorization after a reload, which Google grants without a prompt once
 * the user has consented — so the visible behaviour is a short flicker, and
 * the failure mode is "press the button again" rather than "someone else has
 * your calendar".
 *
 * ## What it asks for
 *
 * Identity, so the page can say whose it is, and calendar events, so slots can
 * be mirrored. Read access to the calendar list is what makes "which calendar"
 * a menu rather than an id the owner has to paste.
 */

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ')

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

/** Remembers *that* the user signed in, never anything they signed in with. */
const RETURNING_KEY = 'travl.meet.google.returning'

export const googleConfigured = CLIENT_ID.length > 0

/* -------------------------------------------------------------------------- */
/* The Google Identity Services script                                        */
/* -------------------------------------------------------------------------- */

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string; hint?: string }) => void
}

interface GoogleOAuth2 {
  initTokenClient: (config: {
    client_id: string
    scope: string
    callback: (response: TokenResponse) => void
    error_callback?: (error: { type?: string; message?: string }) => void
  }) => TokenClient
  revoke: (token: string, done?: () => void) => void
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } }
  }
}

let scriptPromise: Promise<GoogleOAuth2> | null = null

function loadGis(): Promise<GoogleOAuth2> {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<GoogleOAuth2>((resolve, reject) => {
    const existing = window.google?.accounts?.oauth2
    if (existing) return resolve(existing)

    const el = document.createElement('script')
    el.src = GIS_SRC
    el.async = true
    el.defer = true
    el.onload = () => {
      const oauth2 = window.google?.accounts?.oauth2
      if (oauth2) resolve(oauth2)
      else reject(new Error('Google sign-in loaded but exposed no OAuth client'))
    }
    // Most often this is a blocker extension or a network that cannot reach
    // Google — the same network condition the map layer already handles by
    // falling back, so it must not be fatal here either.
    el.onerror = () => reject(new Error('Could not reach Google sign-in'))
    document.head.appendChild(el)
  })
  return scriptPromise
}

/* -------------------------------------------------------------------------- */
/* The account hook                                                           */
/* -------------------------------------------------------------------------- */

export interface GoogleProfile {
  name: string
  email: string
  picture: string
}

export type GoogleStatus = 'unconfigured' | 'signed-out' | 'connecting' | 'signed-in' | 'error'

export interface GoogleAccount {
  status: GoogleStatus
  profile: GoogleProfile | null
  error: string | null
  signIn: () => void
  signOut: () => void
  /** A valid access token, refreshing silently if the current one has aged out. */
  token: () => Promise<string>
  /** True when a token is in hand — the gate for every calendar call. */
  ready: boolean
}

export function useGoogleAccount(): GoogleAccount {
  const [status, setStatus] = useState<GoogleStatus>(
    googleConfigured ? 'signed-out' : 'unconfigured',
  )
  const [profile, setProfile] = useState<GoogleProfile | null>(null)
  const [error, setError] = useState<string | null>(null)

  const tokenRef = useRef<{ value: string; expiresAt: number } | null>(null)
  const clientRef = useRef<TokenClient | null>(null)
  const pending = useRef<{ resolve: (t: string) => void; reject: (e: Error) => void }[]>([])
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const settle = useCallback((token: string | null, err?: Error) => {
    const waiting = pending.current
    pending.current = []
    for (const p of waiting) {
      if (token) p.resolve(token)
      else p.reject(err ?? new Error('Google sign-in was cancelled'))
    }
  }, [])

  const client = useCallback(async (): Promise<TokenClient> => {
    if (clientRef.current) return clientRef.current
    const oauth2 = await loadGis()
    clientRef.current = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (response) => {
        if (!response.access_token) {
          const message = response.error_description || response.error || 'No token returned'
          if (alive.current) {
            setStatus('error')
            setError(message)
          }
          settle(null, new Error(message))
          return
        }
        // A minute of headroom, so a call started just before expiry does not
        // arrive just after it.
        tokenRef.current = {
          value: response.access_token,
          expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000 - 60_000,
        }
        try {
          localStorage.setItem(RETURNING_KEY, '1')
        } catch {
          // Silent re-auth on the next load just won't be attempted.
        }
        settle(response.access_token)
        void fetchProfile(response.access_token).then((p) => {
          if (!alive.current) return
          setProfile(p)
          setStatus('signed-in')
          setError(null)
        })
      },
      error_callback: (e) => {
        const message =
          e.type === 'popup_closed'
            ? 'Sign-in window closed'
            : e.type === 'popup_failed_to_open'
              ? 'The sign-in window was blocked'
              : (e.message ?? 'Sign-in failed')
        if (alive.current) {
          setStatus('error')
          setError(message)
        }
        settle(null, new Error(message))
      },
    })
    return clientRef.current
  }, [settle])

  const request = useCallback(
    async (prompt: string): Promise<string> => {
      if (!googleConfigured) throw new Error('Google sign-in is not configured')
      const c = await client()
      return new Promise<string>((resolve, reject) => {
        pending.current.push({ resolve, reject })
        c.requestAccessToken({ prompt })
      })
    },
    [client],
  )

  const token = useCallback(async (): Promise<string> => {
    const held = tokenRef.current
    if (held && held.expiresAt > Date.now()) return held.value
    // `prompt: ''` reuses the existing grant. It only shows UI if consent has
    // genuinely lapsed.
    return request('')
  }, [request])

  const signIn = useCallback(() => {
    setStatus('connecting')
    setError(null)
    request('').catch((e: Error) => {
      if (!alive.current) return
      setStatus('error')
      setError(e.message)
    })
  }, [request])

  const signOut = useCallback(() => {
    const held = tokenRef.current?.value
    tokenRef.current = null
    setProfile(null)
    setStatus('signed-out')
    setError(null)
    try {
      localStorage.removeItem(RETURNING_KEY)
    } catch {
      // Nothing to clean up.
    }
    if (held) void loadGis().then((oauth2) => oauth2.revoke(held))
  }, [])

  // A returning owner gets their calendar back without pressing anything. This
  // is the only reason the "returning" flag exists, and it is why it holds a
  // boolean rather than a token.
  useEffect(() => {
    if (!googleConfigured) return
    let returning = false
    try {
      returning = localStorage.getItem(RETURNING_KEY) === '1'
    } catch {
      returning = false
    }
    if (!returning) return
    setStatus('connecting')
    request('').catch(() => {
      if (alive.current) setStatus('signed-out')
    })
  }, [request])

  return useMemo(
    () => ({
      status,
      profile,
      error,
      signIn,
      signOut,
      token,
      ready: status === 'signed-in',
    }),
    [status, profile, error, signIn, signOut, token],
  )
}

async function fetchProfile(token: string): Promise<GoogleProfile | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const json = (await res.json()) as { name?: string; email?: string; picture?: string }
    return { name: json.name ?? '', email: json.email ?? '', picture: json.picture ?? '' }
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------- */
/* Calendar                                                                   */
/* -------------------------------------------------------------------------- */

const API = 'https://www.googleapis.com/calendar/v3'

export interface GCalendar {
  id: string
  summary: string
  primary: boolean
  accessRole: string
}

export interface GEventTime {
  dateTime?: string
  date?: string
  timeZone?: string
}

export interface GEvent {
  id: string
  summary?: string
  description?: string
  location?: string
  start?: GEventTime
  end?: GEventTime
  status?: string
  htmlLink?: string
}

export interface EventDraft {
  summary: string
  description?: string
  location?: string
  start: string
  end: string
  timeZone?: string
  /** Round-trip key: how a slot recognises its own event on the far side. */
  slotId?: string
}

export class CalendarError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'CalendarError'
    this.status = status
  }
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      detail = body.error?.message ?? detail
    } catch {
      // A non-JSON error body — the status line is all we have.
    }
    throw new CalendarError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Calendars the user can actually write to, plus the ones they can read. */
export async function listCalendars(token: string): Promise<GCalendar[]> {
  const json = await call<{ items?: (GCalendar & { primary?: boolean })[] }>(
    token,
    '/users/me/calendarList?minAccessRole=reader&maxResults=100',
  )
  return (json.items ?? []).map((c) => ({
    id: c.id,
    summary: c.summary,
    primary: c.primary === true,
    accessRole: c.accessRole,
  }))
}

export async function listEvents(
  token: string,
  calendarId: string,
  range: { from: string; to: string },
): Promise<GEvent[]> {
  const params = new URLSearchParams({
    timeMin: new Date(range.from).toISOString(),
    timeMax: new Date(range.to).toISOString(),
    // Recurring events come back expanded into their instances, which is the
    // only way a weekly standing commitment blocks the right afternoons.
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  })
  const json = await call<{ items?: GEvent[] }>(
    token,
    `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
  )
  return (json.items ?? []).filter((e) => e.status !== 'cancelled')
}

export async function createEvent(
  token: string,
  calendarId: string,
  draft: EventDraft,
): Promise<GEvent> {
  return call<GEvent>(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify(toResource(draft)),
  })
}

export async function updateEvent(
  token: string,
  calendarId: string,
  eventId: string,
  draft: EventDraft,
): Promise<GEvent> {
  return call<GEvent>(
    token,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'PATCH', body: JSON.stringify(toResource(draft)) },
  )
}

/**
 * Delete, treating "already gone" as success.
 *
 * The owner deleting the event in Google and then deleting the slot here is
 * an ordinary sequence, and it must not surface as a sync error — the desired
 * end state is the one that already holds.
 */
export async function deleteEvent(
  token: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  try {
    await call<void>(
      token,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' },
    )
  } catch (e) {
    if (e instanceof CalendarError && (e.status === 404 || e.status === 410)) return
    throw e
  }
}

function toResource(draft: EventDraft): Record<string, unknown> {
  const timeZone = draft.timeZone
  return {
    summary: draft.summary,
    description: draft.description ?? '',
    location: draft.location ?? '',
    start: { dateTime: new Date(draft.start).toISOString(), ...(timeZone ? { timeZone } : {}) },
    end: { dateTime: new Date(draft.end).toISOString(), ...(timeZone ? { timeZone } : {}) },
    ...(draft.slotId
      ? { extendedProperties: { private: { travlSlotId: draft.slotId } } }
      : {}),
  }
}

/** The instant a Google event starts, whether it is timed or all-day. */
export function eventInstant(time: GEventTime | undefined): string | null {
  if (!time) return null
  if (time.dateTime) return new Date(time.dateTime).toISOString()
  if (time.date) {
    const [y, m, d] = time.date.split('-').map(Number)
    if (!y || !m || !d) return null
    // All-day means the owner's whole local day, not a UTC midnight.
    return new Date(y, m - 1, d).toISOString()
  }
  return null
}
