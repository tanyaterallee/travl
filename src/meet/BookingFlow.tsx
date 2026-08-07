import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n, type StringKey } from '../app/i18n'
import { Button } from '../ui/primitives'
import { googleCalendarUrl, mapsSearchUrl, outlookCalendarUrl } from './links'
import { toICS } from './ics'
import { Card, Field, Notice, Pill, PlacePanel, inputClass } from './parts'
import {
  bookableSlots,
  durationMin,
  formatDuration,
  formatFullDate,
  formatRange,
  groupDays,
  holdsOf,
  localZone,
  looksLikeEmail,
} from './schedule'
import { useMeetActions, useMeetPage } from './store'
import type { Booking, BookingKind, Slot } from './types'

/**
 * The guest's side: four screens, in the order the brief asks for them.
 *
 *   who → pick → detail → done
 *
 * Everything about this flow is shaped by where it gets opened: a phone, in a
 * different city, by someone who has never seen this app and will use it once.
 * So it asks for two fields before anything else — a booking with no name on
 * it is useless to the host — shows one decision per screen, and ends on a
 * page whose only job is to get the plan into whatever calendar that person
 * actually uses.
 *
 * The one rule the interface has to carry is the two-choice cap: a guest may
 * book one slot outright and mark one more as a second option. It is expressed
 * as two differently weighted buttons on the same screen rather than a mode
 * chosen up front, because "I'd take either, but preferably this one" is a
 * single thought.
 */

type Step = 'who' | 'pick' | 'detail' | 'done'

const GUEST_KEY = 'travl.meet.guest.v1'

interface Guest {
  name: string
  email: string
}

function loadGuest(): Guest {
  try {
    const raw = localStorage.getItem(GUEST_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Guest
      if (parsed?.email) return { name: parsed.name ?? '', email: parsed.email }
    }
  } catch {
    // Private browsing, or a stale value — either way, ask again.
  }
  return { name: '', email: '' }
}

function saveGuest(guest: Guest): void {
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(guest))
  } catch {
    // The guest will just re-type their name if they come back.
  }
}

export function BookingFlow() {
  const page = useMeetPage()
  const actions = useMeetActions()
  const { t } = useI18n()

  const [guest, setGuest] = useState<Guest>(loadGuest)
  const [step, setStep] = useState<Step>(() => (loadGuest().email ? 'pick' : 'who'))
  const [chosen, setChosen] = useState<Slot | null>(null)
  const [intent, setIntent] = useState<BookingKind>('primary')
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<StringKey | null>(null)
  const [confirmed, setConfirmed] = useState<Booking | null>(null)

  const holds = useMemo(
    () => (guest.email ? holdsOf(guest.email, page.bookings) : { primary: null, tentative: null }),
    [guest.email, page.bookings],
  )

  /**
   * A guest who comes back to the link lands on what they already have, not on
   * an empty form that implies they never booked.
   *
   * It waits for the document to hold something, because the local replay is
   * asynchronous and an empty page one tick after mount is indistinguishable
   * from a guest with no booking. And it fires exactly once, so that pressing
   * "pick a different time" afterwards is not immediately undone.
   */
  const landed = useRef(false)
  const hasContent = page.slots.length > 0 || page.bookings.length > 0
  useEffect(() => {
    if (landed.current || !hasContent) return
    landed.current = true
    if (holds.primary) {
      setConfirmed(holds.primary)
      setStep('done')
    }
  }, [hasContent, holds.primary])

  // Give the document a moment to arrive before declaring the page empty: a
  // relayed page is blank for the first second of its life, and "nothing here"
  // is a much worse first impression than a beat of waiting.
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), 1200)
    return () => window.clearTimeout(timer)
  }, [])

  const slotOf = useCallback(
    (id: string | undefined) => page.slots.find((s) => s.id === id) ?? null,
    [page.slots],
  )

  const confirm = (kind: BookingKind) => {
    if (!chosen) return
    const result = actions.book({
      slotId: chosen.id,
      name: guest.name,
      email: guest.email,
      kind,
      note,
    })
    if (!result.ok) {
      setProblem(`meet.prob.${result.problem}` as StringKey)
      return
    }
    saveGuest(guest)
    setProblem(null)
    setConfirmed(result.booking)
    setStep('done')
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-ink">
          {page.title || t('meet.name')}
        </h1>
        {page.ownerName && (
          <p className="mt-0.5 text-sm text-ink-soft">
            {t('meet.guest.hosted')} {page.ownerName}
          </p>
        )}
        {page.headline && (
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">{page.headline}</p>
        )}
      </header>

      {!hasContent && settled && (
        <Card>
          <Notice tone="warn">{t('meet.guest.empty')}</Notice>
        </Card>
      )}

      {hasContent && step === 'who' && (
        <WhoStep
          guest={guest}
          onChange={setGuest}
          onNext={() => {
            saveGuest(guest)
            setStep('pick')
          }}
        />
      )}

      {hasContent && step === 'pick' && (
        <PickStep
          holds={holds}
          onPick={(slot) => {
            setChosen(slot)
            setProblem(null)
            setNote('')
            setIntent(holds.primary ? 'tentative' : 'primary')
            setStep('detail')
          }}
          onBack={() => setStep('who')}
        />
      )}

      {step === 'detail' && chosen && (
        <DetailStep
          slot={chosen}
          intent={intent}
          hasPrimary={Boolean(holds.primary) && holds.primary?.slotId !== chosen.id}
          note={note}
          onNote={setNote}
          problem={problem}
          onConfirm={confirm}
          onBack={() => {
            setChosen(null)
            setProblem(null)
            setStep('pick')
          }}
        />
      )}

      {step === 'done' && confirmed && (
        <DoneStep
          booking={confirmed}
          slot={slotOf(confirmed.slotId)}
          canAddSecond={!holds.tentative}
          onAddSecond={() => {
            setIntent('tentative')
            setChosen(null)
            setStep('pick')
          }}
          onChange={() => {
            setChosen(null)
            setStep('pick')
          }}
        />
      )}

      <footer className="mt-6 text-center text-[11px] text-ink-faint">
        {t('meet.times')} · {page.timezone || localZone()}
      </footer>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 1 — who                                                                    */
/* -------------------------------------------------------------------------- */

function WhoStep({
  guest,
  onChange,
  onNext,
}: {
  guest: Guest
  onChange: (g: Guest) => void
  onNext: () => void
}) {
  const { t } = useI18n()
  const ready = guest.name.trim().length > 0 && looksLikeEmail(guest.email)

  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) onNext()
        }}
      >
        <Field label={t('meet.guest.name')}>
          <input
            autoFocus
            value={guest.name}
            onChange={(e) => onChange({ ...guest, name: e.target.value })}
            autoComplete="name"
            className={inputClass}
          />
        </Field>
        <Field label={t('meet.guest.email')}>
          <input
            type="email"
            inputMode="email"
            value={guest.email}
            onChange={(e) => onChange({ ...guest, email: e.target.value })}
            autoComplete="email"
            className={inputClass}
          />
        </Field>
        <Button variant="primary" type="submit" disabled={!ready} className="w-full py-2">
          {t('meet.guest.continue')}
        </Button>
      </form>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* 2 — pick                                                                   */
/* -------------------------------------------------------------------------- */

function PickStep({
  holds,
  onPick,
  onBack,
}: {
  holds: { primary: Booking | null; tentative: Booking | null }
  onPick: (slot: Slot) => void
  onBack: () => void
}) {
  const page = useMeetPage()
  const { t, locale } = useI18n()
  const open = useMemo(() => bookableSlots(page), [page])
  const days = useMemo(() => groupDays(open), [open])

  return (
    <Card
      title={t('meet.guest.slots')}
      action={
        <Button variant="quiet" onClick={onBack}>
          {t('meet.guest.back')}
        </Button>
      }
    >
      {holds.primary && (
        <div className="mb-3">
          <Notice tone="info">{t('meet.prob.hasPrimary')}</Notice>
        </div>
      )}

      {days.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-ink-faint">
          {t('meet.guest.noSlots')}
        </p>
      ) : (
        <div className="space-y-4">
          {days.map((day) => (
            <div key={day.key}>
              {/* Full date, weekday first: a guest picking a time in a foreign
                  city has no other cue for which day of their trip this is. */}
              <h3 className="mb-2 text-xs font-semibold text-ink-soft">
                {formatFullDate(day.at, locale)}
              </h3>
              <ul className="space-y-1.5">
                {day.slots.map((slot) => (
                  <li key={slot.id}>
                    <button
                      type="button"
                      onClick={() => onPick(slot)}
                      className={
                        'flex w-full items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-left ' +
                        'transition-[background-color,border-color,transform] duration-100 active:scale-[0.99] ' +
                        'hover:border-brand hover:bg-brand-soft/40 ' +
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'
                      }
                    >
                      <span className="w-24 shrink-0 text-xs tabular-nums text-ink-soft">
                        {formatRange(slot.start, slot.end, locale)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {slot.title}
                        </span>
                        {slot.locationName && (
                          <span className="block truncate text-xs text-ink-soft">
                            {slot.locationName}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-ink-faint" aria-hidden>
                        ›
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* 3 — the place, then confirm                                                */
/* -------------------------------------------------------------------------- */

function DetailStep({
  slot,
  intent,
  hasPrimary,
  note,
  onNote,
  problem,
  onConfirm,
  onBack,
}: {
  slot: Slot
  intent: BookingKind
  hasPrimary: boolean
  note: string
  onNote: (v: string) => void
  problem: StringKey | null
  onConfirm: (kind: BookingKind) => void
  onBack: () => void
}) {
  const { t, locale } = useI18n()
  const minutes = durationMin(slot.start, slot.end)

  return (
    <Card
      action={
        <Button variant="quiet" onClick={onBack}>
          {t('meet.guest.back')}
        </Button>
      }
      title={slot.title}
    >
      <div className="space-y-4">
        <p className="text-sm text-ink">
          {formatFullDate(slot.start, locale)}
          <span className="mx-1.5 text-ink-faint">·</span>
          <span className="tabular-nums">{formatRange(slot.start, slot.end, locale)}</span>
          <span className="ml-1.5 text-xs text-ink-faint">
            ({formatDuration(minutes, locale)})
          </span>
        </p>

        {slot.blurb && <p className="text-sm leading-relaxed text-ink-soft">{slot.blurb}</p>}

        <PlacePanel place={slot} title={t('meet.guest.about')} />

        <Field label={t('meet.guest.note')}>
          <textarea
            value={note}
            onChange={(e) => onNote(e.target.value)}
            rows={2}
            placeholder={t('meet.guest.notePlaceholder')}
            className={`${inputClass} resize-y`}
          />
        </Field>

        {problem && <Notice tone="error">{t(problem)}</Notice>}

        {/* Confirm is on this screen, not a step later: the guest has just
            read what the place is, and that is the moment they decide. */}
        <div className="space-y-2">
          {!hasPrimary && (
            <Button
              variant="primary"
              onClick={() => onConfirm('primary')}
              className="w-full py-2.5"
            >
              {t('meet.guest.confirm')}
            </Button>
          )}
          <Button
            variant={hasPrimary || intent === 'tentative' ? 'primary' : 'ghost'}
            onClick={() => onConfirm('tentative')}
            className="w-full py-2"
          >
            {t('meet.guest.confirmTentative')}
          </Button>
          <p className="text-center text-[11px] text-ink-faint">{t('meet.guest.tentativeHint')}</p>
        </div>
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* 4 — confirmed                                                              */
/* -------------------------------------------------------------------------- */

function DoneStep({
  booking,
  slot,
  canAddSecond,
  onAddSecond,
  onChange,
}: {
  booking: Booking
  slot: Slot | null
  canAddSecond: boolean
  onAddSecond: () => void
  onChange: () => void
}) {
  const page = useMeetPage()
  const actions = useMeetActions()
  const { t, locale } = useI18n()

  if (!slot) {
    return (
      <Card>
        <Notice tone="warn">{t('meet.prob.gone')}</Notice>
        <div className="mt-3">
          <Button onClick={onChange}>{t('meet.guest.change')}</Button>
        </div>
      </Card>
    )
  }

  const tentative = booking.kind === 'tentative'
  const withHost = page.ownerName ? ` ${t('meet.guest.with')} ${page.ownerName}` : ''
  const calendarDraft = {
    title: `${slot.title}${withHost}`,
    start: slot.start,
    end: slot.end,
    location: [slot.locationName, slot.address].filter(Boolean).join(', '),
    details: [slot.blurb, mapsSearchUrl(slot)].filter(Boolean).join('\n\n'),
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <CheckMark tentative={tentative} />
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-ink">
                {tentative ? t('meet.guest.savedTentative') : t('meet.guest.booked')}
              </h2>
              <p className="text-xs text-ink-faint">{booking.email}</p>
            </div>
            {tentative && (
              <Pill className="ml-auto bg-amber-50 text-amber-700">{t('meet.state.tentative')}</Pill>
            )}
          </div>

          <div className="rounded-lg bg-sunken px-3 py-2.5">
            <p className="text-sm font-medium text-ink">{slot.title}</p>
            <p className="text-sm text-ink-soft">
              {formatFullDate(slot.start, locale)}
              <span className="mx-1.5 text-ink-faint">·</span>
              <span className="tabular-nums">{formatRange(slot.start, slot.end, locale)}</span>
            </p>
          </div>

          <PlacePanel place={slot} title={t('meet.guest.about')} compact />
        </div>
      </Card>

      <Card title={t('meet.guest.addGoogle')}>
        <AddToCalendar draft={calendarDraft} slot={slot} booking={booking} />
      </Card>

      <div className="flex flex-wrap gap-2">
        {canAddSecond && !tentative && (
          <Button onClick={onAddSecond}>{t('meet.guest.addSecond')}</Button>
        )}
        <Button variant="quiet" onClick={onChange}>
          {t('meet.guest.change')}
        </Button>
        <Button
          variant="danger"
          className="ml-auto"
          onClick={() => {
            actions.cancelBooking(booking.id)
            onChange()
          }}
        >
          {t('meet.book.cancel')}
        </Button>
      </div>
    </div>
  )
}

/**
 * Getting the plan off this page and into the guest's own calendar.
 *
 * Three routes, because there is no single one that works for everybody. The
 * Google link is a URL, so it opens the app on Android and the web anywhere
 * else. The `.ics` download is what an iPhone, Outlook, or a desktop client
 * understands, and it is generated in the browser from the same data — no
 * round trip, so it works on a plane.
 */
function AddToCalendar({
  draft,
  slot,
  booking,
}: {
  draft: { title: string; start: string; end: string; location: string; details: string }
  slot: Slot
  booking: Booking
}) {
  const page = useMeetPage()
  const { t } = useI18n()

  const download = () => {
    const text = toICS({
      uid: `${booking.id}@travl.meet`,
      title: draft.title,
      start: slot.start,
      end: slot.end,
      location: draft.location,
      description: draft.details,
      organizer: page.ownerEmail
        ? { name: page.ownerName || 'Host', email: page.ownerEmail }
        : undefined,
    })
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slugify(slot.title) || 'travl-meet'}.ics`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Revoking immediately can cancel the download on some mobile browsers.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  const linkClass =
    'inline-flex flex-1 items-center justify-center rounded-lg px-3 py-2.5 text-sm font-medium ' +
    'transition-[background-color,transform] duration-100 active:scale-[0.98] ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

  return (
    <div className="flex flex-col gap-2">
      <a
        href={googleCalendarUrl(draft)}
        target="_blank"
        rel="noreferrer"
        className={`${linkClass} bg-brand text-white shadow-sm hover:brightness-110`}
      >
        {t('meet.guest.addGoogle')}
      </a>
      <div className="flex gap-2">
        <button type="button" onClick={download} className={`${linkClass} border border-line bg-surface text-ink hover:bg-sunken`}>
          {t('meet.guest.download')}
        </button>
        <a
          href={outlookCalendarUrl(draft)}
          target="_blank"
          rel="noreferrer"
          className={`${linkClass} border border-line bg-surface text-ink hover:bg-sunken`}
        >
          {t('meet.guest.addOutlook')}
        </a>
      </div>
    </div>
  )
}

function CheckMark({ tentative }: { tentative: boolean }) {
  return (
    <span
      className={
        'mt-0.5 inline-grid h-7 w-7 shrink-0 place-items-center rounded-full ' +
        (tentative ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')
      }
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden>
        {tentative ? (
          <path d="M8 1.5A6.5 6.5 0 1 0 8 14.5 6.5 6.5 0 0 0 8 1.5Zm.8 9.8H7.2V9.7h1.6v1.6Zm0-2.8H7.2V4.5h1.6v4Z" />
        ) : (
          <path d="M6.6 11.9 3.2 8.5l1.1-1.1 2.3 2.3 5-5 1.1 1.1-6.1 6.1Z" />
        )}
      </svg>
    </span>
  )
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}
