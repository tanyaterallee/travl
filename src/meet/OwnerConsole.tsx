import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useI18n, type StringKey } from '../app/i18n'
import type { BookingId, SlotId } from '../core/types'
import { Button } from '../ui/primitives'
import { listCalendars, type GCalendar, type GoogleAccount } from './google'
import { bookingUrl, inviteMailto } from './links'
import { useCalendarMirror } from './mirror'
import { Card, Field, Notice, Pill, StatePill, inputClass, stateRule, useCopy } from './parts'
import {
  blockedBy,
  formatFullDate,
  formatRange,
  fromLocalInput,
  groupDays,
  isPast,
  localZone,
  nextHour,
  primaryFor,
  slotState,
  tentativesFor,
  toLocalInput,
} from './schedule'
import { importFromGoogle, importFromTrip, importFromUrl, fromIcsText, type ImportResult } from './itinerary'
import { useMeetActions, useMeetPage, useMeetPageId } from './store'
import type { BusyEvent, ItinerarySource, Slot } from './types'

/**
 * The owner's side.
 *
 * The layout answers the question this page exists to answer — *what does my
 * week look like, and what have I given away?* — so the calendar is the page
 * and everything else is a column of settings beside it. Adding a slot, seeing
 * who took it, and seeing what the itinerary already ate are all one glance
 * apart, because they are one decision.
 */

const TRIP_ID = 'my-trip'
/** How far ahead an imported calendar is read. See `importFromGoogle`. */
const IMPORT_DAYS = 60
const RELAY_CONFIGURED = Boolean(import.meta.env.VITE_RELAY_URL)

export function OwnerConsole({ account }: { account: GoogleAccount }) {
  const page = useMeetPage()
  const actions = useMeetActions()
  const mirror = useCalendarMirror(account, page, actions)
  const [editing, setEditing] = useState<Slot | 'new' | null>(null)

  // The signed-in identity is the page's identity: a booking page with a
  // stranger's name on it is not one anybody replies to.
  useEffect(() => {
    if (!account.profile) return
    const patch: Record<string, string> = {}
    if (!page.ownerName && account.profile.name) patch.ownerName = account.profile.name
    if (page.ownerEmail !== account.profile.email) patch.ownerEmail = account.profile.email
    if (page.ownerAvatar !== account.profile.picture) patch.ownerAvatar = account.profile.picture
    if (!page.timezone) patch.timezone = localZone()
    if (Object.keys(patch).length > 0) actions.setProfile(patch)
  }, [account.profile, page.ownerName, page.ownerEmail, page.ownerAvatar, page.timezone, actions])

  const onSave = useCallback(
    (draft: SlotDraft, existing: Slot | null) => {
      if (existing) {
        actions.editSlot(existing.id, draft)
        void mirror.push({ ...existing, ...draft })
      } else {
        void mirror.push(actions.addSlot(draft))
      }
      setEditing(null)
    },
    [actions, mirror],
  )

  const onDelete = useCallback(
    (slot: Slot) => {
      // Google first: once the slot is gone from the document we no longer know
      // which event belonged to it, and an orphan would sit in the calendar
      // claiming an hour that is now free.
      void mirror.drop(slot).finally(() => actions.deleteSlot(slot.id))
      setEditing(null)
    },
    [actions, mirror],
  )

  const onDuplicate = useCallback(
    (slot: Slot) => {
      const copy = actions.duplicateSlot(slot.id)
      if (copy) void mirror.push(copy)
    },
    [actions, mirror],
  )

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-5">
        <Preview
          onEdit={setEditing}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onAdd={() => setEditing('new')}
        />
        {editing !== null && (
          <SlotEditor
            slot={editing === 'new' ? null : editing}
            onSave={onSave}
            onDelete={editing === 'new' ? undefined : () => onDelete(editing)}
            onCancel={() => setEditing(null)}
          />
        )}
        <Bookings />
      </div>

      <div className="space-y-5">
        <ShareCard />
        <ItineraryCard account={account} />
        <GoogleCard account={account} mirror={mirror} />
        <PageCard />
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The calendar                                                               */
/* -------------------------------------------------------------------------- */

function Preview({
  onEdit,
  onDuplicate,
  onDelete,
  onAdd,
}: {
  onEdit: (slot: Slot) => void
  onDuplicate: (slot: Slot) => void
  onDelete: (slot: Slot) => void
  onAdd: () => void
}) {
  const page = useMeetPage()
  const { t, locale } = useI18n()
  const days = useMemo(() => groupDays(page.slots, page.busy), [page.slots, page.busy])

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {page.title || t('meet.name')}
          <span className="font-normal text-ink-faint">· {page.slots.length}</span>
        </span>
      }
      action={
        <Button variant="primary" onClick={onAdd}>
          + {t('meet.slot.add')}
        </Button>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
        <Legend />
        <span className="ml-auto">{t('meet.times')}</span>
      </div>

      {days.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-ink-faint">
          {t('meet.slot.none')}
        </p>
      ) : (
        <div className="space-y-5">
          {days.map((day) => (
            <div key={day.key}>
              <h3 className="mb-2 text-xs font-semibold tracking-[-0.01em] text-ink-soft">
                {formatFullDate(day.at, locale)}
              </h3>
              <div className="space-y-1.5">
                {merge(day.slots, day.busy).map((entry) =>
                  entry.kind === 'slot' ? (
                    <SlotRow
                      key={entry.slot.id}
                      slot={entry.slot}
                      onEdit={onEdit}
                      onDuplicate={onDuplicate}
                      onDelete={onDelete}
                    />
                  ) : (
                    <BusyRow key={entry.event.id} event={entry.event} />
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

type Entry = { kind: 'slot'; slot: Slot; at: number } | { kind: 'busy'; event: BusyEvent; at: number }

/** Slots and itinerary entries interleaved, so a day reads as one timeline. */
function merge(slots: readonly Slot[], busy: readonly BusyEvent[]): Entry[] {
  const entries: Entry[] = [
    ...slots.map((slot) => ({ kind: 'slot' as const, slot, at: new Date(slot.start).getTime() })),
    ...busy.map((event) => ({ kind: 'busy' as const, event, at: new Date(event.start).getTime() })),
  ]
  return entries.sort((a, b) => a.at - b.at)
}

function Legend() {
  const { t } = useI18n()
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Pill className="bg-brand-soft text-brand">{t('meet.state.open')}</Pill>
      <Pill className="bg-emerald-50 text-emerald-700">{t('meet.state.booked')}</Pill>
      <Pill className="bg-sunken text-ink-faint line-through">{t('meet.state.blocked')}</Pill>
    </span>
  )
}

function SlotRow({
  slot,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  slot: Slot
  onEdit: (slot: Slot) => void
  onDuplicate: (slot: Slot) => void
  onDelete: (slot: Slot) => void
}) {
  const page = useMeetPage()
  const { t, locale } = useI18n()
  const state = slotState(slot, page.bookings, page.busy)
  const past = isPast(slot.end)
  const primary = primaryFor(slot.id, page.bookings)
  const holds = tentativesFor(slot.id, page.bookings)
  const clash = state === 'blocked' ? blockedBy(slot, page.busy) : null

  return (
    <article
      className={`group flex items-start gap-3 rounded-r-lg border-l-4 bg-surface py-2 pl-3 pr-2 transition-colors hover:bg-sunken/60 ${stateRule(state, past)} ${past ? 'opacity-60' : ''}`}
    >
      <div className="w-24 shrink-0 pt-0.5 text-[11px] tabular-nums text-ink-soft">
        {formatRange(slot.start, slot.end, locale)}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{slot.title}</p>
        {slot.locationName && (
          <p className="truncate text-xs text-ink-soft">{slot.locationName}</p>
        )}
        {primary && (
          <p className="mt-1 text-xs text-emerald-700">
            {primary.name} · <span className="text-ink-faint">{primary.email}</span>
            {primary.note && <span className="block text-ink-soft italic">“{primary.note}”</span>}
          </p>
        )}
        {holds.length > 0 && (
          <p className="mt-1 text-xs text-amber-700">
            {holds.map((h) => h.name).join(', ')} — {t('meet.state.holds')}
          </p>
        )}
        {clash && (
          <p className="mt-1 truncate text-xs text-ink-faint">
            {clash.title} · {clash.source}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatePill state={state} past={past} />
        <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <IconButton label={t('meet.slot.edit')} onClick={() => onEdit(slot)}>
            <path d="M12.1 2.6a1.5 1.5 0 0 1 2.1 2.1l-.8.8-2.1-2.1.8-.8ZM10.2 4.5l2.1 2.1-6 6-2.6.5.5-2.6 6-6Z" />
          </IconButton>
          <IconButton label={t('meet.slot.duplicate')} onClick={() => onDuplicate(slot)}>
            <path d="M5.5 2.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Zm-2 3v5a2 2 0 0 0 2 2h5v1a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" />
          </IconButton>
          <IconButton label={t('meet.slot.delete')} danger onClick={() => onDelete(slot)}>
            <path d="M6 2.5h4l.4 1H13v1.4H3V3.5h2.6L6 2.5ZM4 6h8l-.6 7.1a1 1 0 0 1-1 .9H5.6a1 1 0 0 1-1-.9L4 6Z" />
          </IconButton>
        </div>
      </div>
    </article>
  )
}

/**
 * An itinerary entry. It is a *row*, not a badge on a slot, because the reason
 * an afternoon is gone is as useful to the owner as the fact of it — and it is
 * the only thing on this page they cannot edit here.
 */
function BusyRow({ event }: { event: BusyEvent }) {
  const { t, locale } = useI18n()
  return (
    <article className="flex items-start gap-3 rounded-lg border border-dashed border-line bg-sunken/50 py-2 pl-3 pr-2">
      <div className="w-24 shrink-0 pt-0.5 text-[11px] tabular-nums text-ink-faint">
        {formatRange(event.start, event.end, locale)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink-soft">{event.title}</p>
        <p className="truncate text-xs text-ink-faint">
          {[event.location, event.source].filter(Boolean).join(' · ')}
        </p>
      </div>
      <StatePill state="blocked" />
      <span className="sr-only">{t('meet.state.blocked')}</span>
    </article>
  )
}

function IconButton({
  label,
  onClick,
  children,
  danger = false,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={
        'rounded-md p-1 transition-colors active:scale-95 ' +
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ' +
        (danger ? 'text-ink-faint hover:bg-red-50 hover:text-red-600' : 'text-ink-faint hover:bg-sunken hover:text-ink')
      }
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current" aria-hidden>
        {children}
      </svg>
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* Adding and editing                                                         */
/* -------------------------------------------------------------------------- */

export interface SlotDraft {
  start: string
  end: string
  title: string
  locationName: string
  address: string
  blurb: string
}

function SlotEditor({
  slot,
  onSave,
  onDelete,
  onCancel,
}: {
  slot: Slot | null
  onSave: (draft: SlotDraft, existing: Slot | null) => void
  onDelete?: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const page = useMeetPage()
  const [form, setForm] = useState(() => initialForm(slot))
  const [problem, setProblem] = useState<StringKey | null>(null)

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))

  const submit = () => {
    const start = fromLocalInput(form.start)
    const end = fromLocalInput(form.end)
    if (!form.title.trim()) return setProblem('meet.slot.needsTitle')
    if (!start || !end || new Date(end) <= new Date(start)) return setProblem('meet.slot.backwards')
    setProblem(null)
    onSave(
      {
        start,
        end,
        title: form.title.trim(),
        locationName: form.locationName.trim(),
        address: form.address.trim(),
        blurb: form.blurb.trim(),
      },
      slot,
    )
  }

  // Places already in the plan are the likeliest answer to "where", and typing
  // an address twice is the kind of chore that makes people stop using a tool.
  const known = useMemo(() => knownPlaces(page.slots), [page.slots])

  return (
    <Card title={slot ? t('meet.slot.edit') : t('meet.slot.add')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label={t('meet.slot.what')}>
            <input
              autoFocus
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder={t('meet.slot.whatPlaceholder')}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label={t('meet.slot.start')}>
          <input
            type="datetime-local"
            value={form.start}
            onChange={(e) => set({ start: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label={t('meet.slot.end')}>
          <input
            type="datetime-local"
            value={form.end}
            onChange={(e) => set({ end: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label={t('meet.slot.place')}>
          <input
            value={form.locationName}
            onChange={(e) => set({ locationName: e.target.value })}
            list="travl-meet-places"
            className={inputClass}
          />
          <datalist id="travl-meet-places">
            {known.map((p) => (
              <option key={p.locationName} value={p.locationName} />
            ))}
          </datalist>
        </Field>
        <Field label={t('meet.slot.address')}>
          <input
            value={form.address}
            onChange={(e) => set({ address: e.target.value })}
            className={inputClass}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('meet.slot.blurb')}>
            <textarea
              value={form.blurb}
              onChange={(e) => set({ blurb: e.target.value })}
              rows={2}
              className={`${inputClass} resize-y`}
            />
          </Field>
        </div>
      </div>

      {problem && (
        <div className="mt-3">
          <Notice tone="error">{t(problem)}</Notice>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={submit}>
          {t('meet.slot.save')}
        </Button>
        <Button onClick={onCancel}>{t('action.cancel')}</Button>
        {onDelete && (
          <Button variant="danger" className="ml-auto" onClick={onDelete}>
            {t('meet.slot.delete')}
          </Button>
        )}
      </div>
    </Card>
  )
}

function initialForm(slot: Slot | null) {
  const start = slot?.start ?? nextHour()
  const end = slot?.end ?? new Date(new Date(start).getTime() + 60 * 60_000).toISOString()
  return {
    start: toLocalInput(start),
    end: toLocalInput(end),
    title: slot?.title ?? '',
    locationName: slot?.locationName ?? '',
    address: slot?.address ?? '',
    blurb: slot?.blurb ?? '',
  }
}

function knownPlaces(slots: readonly Slot[]): { locationName: string; address: string }[] {
  const seen = new Map<string, string>()
  for (const s of slots) {
    if (s.locationName && !seen.has(s.locationName)) seen.set(s.locationName, s.address)
  }
  return [...seen].map(([locationName, address]) => ({ locationName, address }))
}

/* -------------------------------------------------------------------------- */
/* Bookings                                                                   */
/* -------------------------------------------------------------------------- */

function Bookings() {
  const page = useMeetPage()
  const actions = useMeetActions()
  const { t, locale } = useI18n()

  if (page.bookings.length === 0) {
    return (
      <Card title={t('meet.book.who')}>
        <p className="text-sm text-ink-faint">{t('meet.book.none')}</p>
      </Card>
    )
  }

  const slotOf = (id: SlotId) => page.slots.find((s) => s.id === id)

  return (
    <Card title={`${t('meet.book.who')} · ${page.bookings.length}`}>
      <ul className="divide-y divide-line">
        {page.bookings.map((b) => {
          const slot = slotOf(b.slotId)
          return (
            <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">
                  {b.name}{' '}
                  <span className="font-normal text-ink-faint">{b.email}</span>
                </p>
                {slot ? (
                  <p className="text-xs text-ink-soft">
                    {slot.title} · {formatFullDate(slot.start, locale)} ·{' '}
                    {formatRange(slot.start, slot.end, locale)}
                  </p>
                ) : (
                  <p className="text-xs text-ink-faint">—</p>
                )}
                {b.note && <p className="text-xs italic text-ink-soft">“{b.note}”</p>}
              </div>
              {b.kind === 'tentative' ? (
                <Pill className="bg-amber-50 text-amber-700">{t('meet.state.tentative')}</Pill>
              ) : (
                <Pill className="bg-emerald-50 text-emerald-700">{t('meet.state.booked')}</Pill>
              )}
              {b.kind === 'tentative' && (
                <Button variant="quiet" onClick={() => actions.promoteBooking(b.id as BookingId)}>
                  {t('meet.book.promote')}
                </Button>
              )}
              <Button variant="danger" onClick={() => actions.cancelBooking(b.id)}>
                {t('meet.book.cancel')}
              </Button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* The side column                                                            */
/* -------------------------------------------------------------------------- */

function ShareCard() {
  const pageId = useMeetPageId()
  const page = useMeetPage()
  const { t } = useI18n()
  const { copied, copy } = useCopy()
  const url = bookingUrl(pageId)

  return (
    <Card title={t('meet.link.title')}>
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className={`${inputClass} text-xs`}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => copy(url)}>
          {copied ? t('meet.link.copied') : t('meet.link.copy')}
        </Button>
        <a
          href={inviteMailto({ ownerName: page.ownerName || 'A friend', pageTitle: page.title, url })}
          className="inline-flex items-center rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-sunken"
        >
          {t('meet.link.email')}
        </a>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-lg px-2 py-1.5 text-sm text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
        >
          {t('meet.link.open')}
        </a>
      </div>
      <p className="mt-2 text-[11px] text-ink-faint">{t('meet.link.hint')}</p>
      {/* Said here rather than in a README, because handing out a link that
          only works in the browser that made it is the one way this page can
          fail silently and completely. */}
      {!RELAY_CONFIGURED && (
        <div className="mt-2">
          <Notice tone="warn">{t('meet.link.localOnly')}</Notice>
        </div>
      )}
    </Card>
  )
}

function PageCard() {
  const page = useMeetPage()
  const actions = useMeetActions()
  const { t } = useI18n()

  return (
    <Card title={t('meet.page.title')}>
      <div className="space-y-3">
        <input
          value={page.title}
          onChange={(e) => actions.setProfile({ title: e.target.value })}
          placeholder={t('meet.page.title')}
          className={inputClass}
        />
        <textarea
          value={page.headline}
          onChange={(e) => actions.setProfile({ headline: e.target.value })}
          placeholder={t('meet.page.headline')}
          rows={2}
          className={`${inputClass} resize-y`}
        />
        <Field label={t('meet.page.host')}>
          <input
            value={page.ownerName}
            onChange={(e) => actions.setProfile({ ownerName: e.target.value })}
            placeholder={t('meet.page.hostPlaceholder')}
            className={inputClass}
          />
        </Field>
        <p className="text-[11px] text-ink-faint">{page.timezone || localZone()}</p>
      </div>
    </Card>
  )
}

function GoogleCard({ account, mirror }: { account: GoogleAccount; mirror: ReturnType<typeof useCalendarMirror> }) {
  const page = useMeetPage()
  const actions = useMeetActions()
  const { t } = useI18n()
  const calendars = useCalendars(account)

  return (
    <Card title={t('meet.google.title')}>
      {account.status === 'unconfigured' ? (
        <Notice tone="warn">{t('meet.google.unconfigured')}</Notice>
      ) : account.status === 'signed-in' && account.profile ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {account.profile.picture ? (
              <img
                src={account.profile.picture}
                alt=""
                className="h-8 w-8 rounded-full"
                referrerPolicy="no-referrer"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{account.profile.name}</p>
              <p className="truncate text-xs text-ink-faint">{account.profile.email}</p>
            </div>
            <Button variant="quiet" onClick={account.signOut}>
              {t('meet.google.signOut')}
            </Button>
          </div>

          <Field label={t('meet.google.calendar')}>
            <select
              value={page.syncCalendarId}
              onChange={(e) => {
                const chosen = calendars.find((c) => c.id === e.target.value)
                actions.setProfile({
                  syncCalendarId: chosen?.id ?? '',
                  syncCalendarName: chosen?.summary ?? '',
                })
              }}
              className={inputClass}
            >
              <option value="">{t('meet.google.noCalendar')}</option>
              {calendars
                .filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.summary}
                    {c.primary ? ' ·' : ''}
                  </option>
                ))}
            </select>
          </Field>

          {page.syncCalendarId && (
            <div className="flex items-center gap-2">
              <Button onClick={() => void mirror.pushAll()}>{t('meet.google.pushAll')}</Button>
              <span className="text-[11px] text-ink-faint">
                {mirror.status === 'syncing'
                  ? t('meet.google.syncing')
                  : mirror.status === 'error'
                    ? t('meet.google.syncFailed')
                    : t('meet.google.synced')}
              </span>
            </div>
          )}
          {mirror.error && <Notice tone="error">{mirror.error}</Notice>}
        </div>
      ) : (
        <div className="space-y-2">
          <Button
            variant="primary"
            onClick={account.signIn}
            disabled={account.status === 'connecting'}
          >
            {account.status === 'connecting' ? t('meet.google.connecting') : t('meet.google.connect')}
          </Button>
          <p className="text-[11px] text-ink-faint">{t('meet.google.why')}</p>
          {account.error && <Notice tone="error">{account.error}</Notice>}
        </div>
      )}
    </Card>
  )
}

function useCalendars(account: GoogleAccount): GCalendar[] {
  const [calendars, setCalendars] = useState<GCalendar[]>([])
  useEffect(() => {
    if (!account.ready) {
      setCalendars([])
      return
    }
    let cancelled = false
    void account
      .token()
      .then(listCalendars)
      .then((list) => {
        if (!cancelled) setCalendars(list)
      })
      .catch(() => {
        // The picker simply stays empty; the page does not depend on it.
      })
    return () => {
      cancelled = true
    }
  }, [account])
  return calendars
}

/* -------------------------------------------------------------------------- */
/* Linking an itinerary                                                       */
/* -------------------------------------------------------------------------- */

function ItineraryCard({ account }: { account: GoogleAccount }) {
  const page = useMeetPage()
  const actions = useMeetActions()
  const { t, locale } = useI18n()
  const calendars = useCalendars(account)

  const [url, setUrl] = useState('')
  const [pasting, setPasting] = useState(false)
  const [paste, setPaste] = useState('')
  const [calendarId, setCalendarId] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<StringKey | null>(null)

  const apply = useCallback(
    (result: ImportResult) => {
      if (result.ok) {
        actions.linkItinerary(result.source, result.events)
        setProblem(null)
        setPasting(false)
        setPaste('')
        setUrl('')
      } else {
        setProblem(`meet.err.${result.problem}` as StringKey)
        // A cross-origin refusal has exactly one remedy, so offer it rather
        // than making the owner find it.
        if (result.problem === 'blocked') setPasting(true)
      }
    },
    [actions],
  )

  const run = useCallback(
    async (task: () => Promise<ImportResult>) => {
      setBusy(true)
      try {
        apply(await task())
      } finally {
        setBusy(false)
      }
    },
    [apply],
  )

  const importGoogle = useCallback(() => {
    const chosen = calendars.find((c) => c.id === calendarId)
    if (!chosen) {
      setProblem('meet.err.noCalendar')
      return
    }
    void run(async () => {
      const token = await account.token()
      return importFromGoogle(token, chosen, defaultRange())
    })
  }, [account, calendarId, calendars, run])

  const reimport = useCallback(
    (source: ItinerarySource) => {
      if (source.kind === 'trip') return void run(() => importFromTrip(source.calendarId || TRIP_ID))
      if (source.kind === 'ics' && source.url) return void run(() => importFromUrl(source.url))
      if (source.kind === 'gcal') {
        return void run(async () => {
          const token = await account.token()
          return importFromGoogle(
            token,
            { id: source.calendarId, summary: source.label },
            defaultRange(),
          )
        })
      }
      setPasting(true)
    },
    [account, run],
  )

  const linked = page.source.kind !== 'none'

  return (
    <Card title={t('meet.itin.title')}>
      {linked ? (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-ink">{page.source.label}</p>
            <p className="text-xs text-ink-faint">
              {page.busy.length} {t('meet.itin.events')}
              {page.source.importedAt > 0 && (
                <> · {formatFullDate(new Date(page.source.importedAt).toISOString(), locale)}</>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => reimport(page.source)} disabled={busy}>
              {busy ? t('meet.itin.importing') : t('meet.itin.refresh')}
            </Button>
            <Button variant="quiet" onClick={() => actions.unlinkItinerary()}>
              {t('meet.itin.unlink')}
            </Button>
          </div>
          {problem && <Notice tone="error">{t(problem)}</Notice>}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-ink-soft">{t('meet.itin.help')}</p>

          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && url.trim()) void run(() => importFromUrl(url))
              }}
              placeholder={t('meet.itin.placeholder')}
              className={`${inputClass} text-xs`}
            />
            <Button
              variant="primary"
              disabled={busy || url.trim().length === 0}
              onClick={() => void run(() => importFromUrl(url))}
            >
              {busy ? t('meet.itin.importing') : t('meet.itin.link')}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void run(() => importFromTrip(TRIP_ID))}>
              {t('meet.itin.useTrip')}
            </Button>
            <Button variant="quiet" onClick={() => setPasting((p) => !p)}>
              {t('meet.itin.paste')}
            </Button>
          </div>

          {account.ready && calendars.length > 0 && (
            <div className="flex gap-2">
              <select
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
                className={`${inputClass} text-xs`}
              >
                <option value="">—</option>
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.summary}
                  </option>
                ))}
              </select>
              <Button disabled={busy} onClick={importGoogle}>
                {t('meet.itin.useCalendar')}
              </Button>
            </div>
          )}

          {pasting && (
            <div className="space-y-2">
              <textarea
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder={t('meet.itin.pastePlaceholder')}
                rows={4}
                className={`${inputClass} font-mono text-[11px]`}
              />
              <Button
                variant="primary"
                disabled={paste.trim().length === 0}
                onClick={() => apply(fromIcsText(paste, { url }))}
              >
                {t('meet.itin.link')}
              </Button>
            </div>
          )}

          {problem && <Notice tone="error">{t(problem)}</Notice>}
        </div>
      )}
    </Card>
  )
}

function defaultRange(): { from: string; to: string } {
  const from = new Date()
  from.setHours(0, 0, 0, 0)
  const to = new Date(from)
  to.setDate(to.getDate() + IMPORT_DAYS)
  return { from: from.toISOString(), to: to.toISOString() }
}
