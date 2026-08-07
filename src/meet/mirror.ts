import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SlotId } from '../core/types'
import { createEvent, deleteEvent, updateEvent, type EventDraft, type GoogleAccount } from './google'
import { formatRange, primaryFor, tentativesFor } from './schedule'
import type { MeetActions } from './store'
import type { MeetPage, Slot } from './types'

/**
 * Keeping Google Calendar told.
 *
 * A slot published here is an hour of the owner's life, and the owner does not
 * look at this page to decide whether they are free — they look at their
 * calendar. So every slot is mirrored into a chosen Google calendar, and the
 * mirrored event's title carries the answer at a glance: who has it, or that
 * it is still open.
 *
 * The direction is deliberately one-way. Two-way sync would need to reconcile
 * an event the owner dragged in Google against a booking a guest made here in
 * the same minute, and the honest resolution of that conflict is a
 * conversation, not an algorithm. What comes *back* from Google is separate
 * and explicit: the owner imports a calendar as their itinerary, which blocks
 * slots rather than editing them.
 *
 * Nothing here is load-bearing. Every write is best-effort, failures surface
 * as a line of text rather than a thrown error, and a slot whose mirror failed
 * is still a slot — the page works signed out, on a keyless deployment, and
 * behind a network that cannot reach Google at all.
 */

export type MirrorStatus = 'off' | 'idle' | 'syncing' | 'error'

export interface Mirror {
  status: MirrorStatus
  error: string | null
  /** Create or update the event behind a slot. Returns the event id, if any. */
  push: (slot: Slot) => Promise<string | null>
  /** Remove the event behind a slot, if it has one. */
  drop: (slot: Slot) => Promise<void>
  /** Backfill everything — for slots made before the calendar was connected. */
  pushAll: () => Promise<void>
  dismissError: () => void
}

export function useCalendarMirror(
  account: GoogleAccount,
  page: MeetPage,
  actions: MeetActions,
): Mirror {
  const [status, setStatus] = useState<MirrorStatus>('off')
  const [error, setError] = useState<string | null>(null)

  const enabled = account.ready && page.syncCalendarId.length > 0
  const pageRef = useRef(page)
  pageRef.current = page

  useEffect(() => {
    setStatus((s) => (enabled ? (s === 'off' ? 'idle' : s) : 'off'))
  }, [enabled])

  const push = useCallback(
    async (slot: Slot): Promise<string | null> => {
      const current = pageRef.current
      if (!account.ready || !current.syncCalendarId) return null
      setStatus('syncing')
      try {
        const token = await account.token()
        const draft = draftFor(slot, current)
        const event = slot.gcalEventId
          ? await updateEvent(token, current.syncCalendarId, slot.gcalEventId, draft)
          : await createEvent(token, current.syncCalendarId, draft)
        if (event.id !== slot.gcalEventId) actions.editSlot(slot.id, { gcalEventId: event.id })
        setStatus('idle')
        setError(null)
        return event.id
      } catch (e) {
        setStatus('error')
        setError(messageOf(e))
        return null
      }
    },
    [account, actions],
  )

  const drop = useCallback(
    async (slot: Slot): Promise<void> => {
      const current = pageRef.current
      if (!account.ready || !current.syncCalendarId || !slot.gcalEventId) return
      setStatus('syncing')
      try {
        const token = await account.token()
        await deleteEvent(token, current.syncCalendarId, slot.gcalEventId)
        setStatus('idle')
        setError(null)
      } catch (e) {
        setStatus('error')
        setError(messageOf(e))
      }
    },
    [account],
  )

  const pushAll = useCallback(async (): Promise<void> => {
    for (const slot of pageRef.current.slots) await push(slot)
  }, [push])

  /**
   * Follow bookings.
   *
   * A guest books while the owner is asleep, so the mirrored event has to be
   * corrected after the fact rather than at the moment of the click. Each
   * mirrored slot carries a digest of what its event *should* say; when the
   * digest moves, the event is patched and nothing else is touched.
   *
   * Only slots that somebody has booked are considered, which keeps a page of
   * fifty open slots from costing fifty requests every time it loads.
   */
  const digests = useRef(new Map<SlotId, string>())
  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    void (async () => {
      for (const slot of page.slots) {
        if (!slot.gcalEventId) continue
        const relevant = page.bookings.filter((b) => b.slotId === slot.id)
        if (relevant.length === 0) {
          digests.current.delete(slot.id)
          continue
        }
        const digest = digestFor(slot, page)
        if (digests.current.get(slot.id) === digest) continue
        digests.current.set(slot.id, digest)
        if (cancelled) return
        await push(slot)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, page, push])

  return useMemo(
    () => ({ status, error, push, drop, pushAll, dismissError: () => setError(null) }),
    [status, error, push, drop, pushAll],
  )
}

/* -------------------------------------------------------------------------- */

/** What the owner should see in their own calendar, without opening this app. */
function draftFor(slot: Slot, page: MeetPage): EventDraft {
  const primary = primaryFor(slot.id, page.bookings)
  const tentative = tentativesFor(slot.id, page.bookings)

  const lines: string[] = []
  if (primary) {
    lines.push(`Booked by ${primary.name} (${primary.email})`)
    if (primary.note) lines.push(`Note: ${primary.note}`)
  } else {
    lines.push('Open — nobody has taken this yet.')
  }
  if (tentative.length > 0) {
    lines.push(
      `Second choice for: ${tentative.map((b) => `${b.name} (${b.email})`).join(', ')}`,
    )
  }
  if (slot.blurb) lines.push('', slot.blurb)
  lines.push('', `${formatRange(slot.start, slot.end)} · via travl meet`)

  return {
    summary: primary ? `${slot.title} · ${primary.name}` : `${slot.title} · open`,
    description: lines.join('\n'),
    location: [slot.locationName, slot.address].filter(Boolean).join(', '),
    start: slot.start,
    end: slot.end,
    timeZone: page.timezone || undefined,
    slotId: slot.id,
  }
}

function digestFor(slot: Slot, page: MeetPage): string {
  const relevant = page.bookings
    .filter((b) => b.slotId === slot.id)
    .map((b) => `${b.kind}:${b.id}:${b.name}`)
    .sort()
    .join('|')
  return `${slot.start}|${slot.end}|${slot.title}|${relevant}`
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Calendar sync failed'
}
