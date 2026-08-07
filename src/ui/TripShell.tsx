import { useState, useSyncExternalStore } from 'react'
import { goToPrint } from '../App'
import { useI18n } from '../app/i18n'
import {
  useActions,
  useCan,
  useIdentity,
  useMode,
  useSyncStatus,
  useTrip,
  useUndo,
  useWhosHere,
} from '../core/store'
import type { DayId, PlaceId } from '../core/types'
import { useLegResolver } from '../maps/resolver'
import { mapRegistry, type ProviderPreference } from '../maps/registry'
import { TripMap } from '../maps/TripMap'
import { Planner } from './Itinerary'
import type { CardView } from './PlaceCard'
import { SearchBox } from './SearchBox'
import { Budget, Checklists, Overview, Reservations } from './Sections'
import { ShareDialog } from './ShareDialog'
import { Avatar, Button } from './primitives'

export function TripShell() {
  const trip = useTrip()
  const mode = useMode()
  const { t, locale } = useI18n()
  const [hovered, setHovered] = useState<PlaceId | null>(null)
  const [activeDay, setActiveDay] = useState<DayId | null>(null)
  const [sharing, setSharing] = useState(false)
  const [view, setView] = useState<CardView>(readViewFromUrl)

  useLegResolver(locale)

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <TripHeader onShare={() => setSharing(true)} />

      {mode === 'public' && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-900 print:hidden">
          {t('share.readOnly')}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <SideNav activeDay={activeDay} onPickDay={setActiveDay} />

        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="mx-auto max-w-2xl space-y-8">
            <div className="sticky top-0 z-20 -mx-2 bg-canvas/85 px-2 py-2 backdrop-blur-md print:hidden">
              <SearchBox targetDay={activeDay} />
            </div>
            <Overview />
            <ViewToggle view={view} onChange={setView} />
            <Planner onHover={setHovered} focusDay={activeDay} view={view} />
            <Budget />
            <Reservations />
            <Checklists />
            <footer className="pb-12 pt-4 text-center text-[11px] text-ink-faint">
              {trip.places.length} places · {trip.days.length} days
            </footer>
          </div>
        </main>

        <aside className="hidden w-[42%] max-w-[640px] shrink-0 border-l border-line lg:block print:hidden">
          <TripMap
            dayId={activeDay}
            focus={hovered}
            onPick={setHovered}
            locale={locale}
            className="h-full w-full"
          />
        </aside>
      </div>

      {sharing && <ShareDialog onClose={() => setSharing(false)} />}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Picture mode is the default, matching the `?mode=picture` view this was
 * modelled on: photo-led cards make a plan far easier to scan than a dense
 * list, which is the whole reason to look at a trip visually.
 */
function readViewFromUrl(): CardView {
  const mode = new URLSearchParams(window.location.search).get('mode')
  return mode === 'list' ? 'list' : 'picture'
}

function ViewToggle({ view, onChange }: { view: CardView; onChange: (v: CardView) => void }) {
  const { locale } = useI18n()
  const options: { id: CardView; label: string }[] = [
    { id: 'picture', label: locale === 'zh' ? '图片' : 'Picture' },
    { id: 'list', label: locale === 'zh' ? '列表' : 'List' },
  ]
  return (
    <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-0.5 w-fit print:hidden">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => {
            onChange(o.id)
            const url = new URL(window.location.href)
            url.searchParams.set('mode', o.id)
            window.history.replaceState(null, '', url)
          }}
          className={
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors ' +
            (view === o.id ? 'bg-brand-soft text-ink' : 'text-ink-soft hover:bg-sunken')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function TripHeader({ onShare }: { onShare: () => void }) {
  const trip = useTrip()
  const actions = useActions()
  const { edit } = useCan()
  const { t, locale, setLocale } = useI18n()
  const { canUndo, canRedo, undo, redo } = useUndo()

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface/80 px-4 py-2.5 backdrop-blur-md print:hidden">
      <div className="min-w-0 flex-1">
        {edit ? (
          <input
            value={trip.title}
            onChange={(e) => actions.setTitle(e.target.value)}
            placeholder={t('trip.untitled')}
            className="w-full truncate rounded bg-transparent text-base font-semibold tracking-[-0.01em] text-ink outline-none focus:bg-sunken"
          />
        ) : (
          <h1 className="truncate text-base font-semibold tracking-[-0.01em] text-ink">
            {trip.title}
          </h1>
        )}
        <div className="flex items-center gap-2 text-[11px] text-ink-faint">
          {trip.startDate && trip.endDate ? (
            <span className="tabular-nums">
              {trip.startDate} → {trip.endDate}
            </span>
          ) : (
            <span>{t('trip.addDates')}</span>
          )}
          <SyncChip />
        </div>
      </div>

      <PresenceStrip />
      <ProviderChip />

      {edit && (
        <div className="flex items-center gap-0.5">
          <Button variant="quiet" onClick={undo} disabled={!canUndo} title={t('action.undo')}>
            <UndoIcon />
          </Button>
          <Button variant="quiet" onClick={redo} disabled={!canRedo} title={t('action.redo')}>
            <UndoIcon flip />
          </Button>
        </div>
      )}

      <Button
        variant="quiet"
        onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
        title="Language"
      >
        {locale === 'zh' ? 'EN' : '中文'}
      </Button>
      {/* The scheduling page is a second surface onto the same trip, so it
          belongs in the header rather than behind a menu — the moment you want
          it is the moment you are looking at the days you have free. */}
      <a
        href="#/meet"
        className="rounded-lg px-2 py-1 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
      >
        {t('meet.nav')}
      </a>
      <Button onClick={goToPrint}>{t('share.print')}</Button>
      <Button variant="primary" onClick={onShare}>
        {t('share.copy')}
      </Button>
    </header>
  )
}

function SyncChip() {
  const status = useSyncStatus()
  const { t } = useI18n()
  const label = {
    local: t('sync.local'),
    connecting: t('sync.connecting'),
    live: t('sync.live'),
    offline: t('sync.offline'),
    'read-only': t('sync.readOnly'),
  }[status]
  const tone = {
    local: 'bg-sunken text-ink-soft',
    connecting: 'bg-amber-100 text-amber-800',
    live: 'bg-emerald-100 text-emerald-800',
    offline: 'bg-red-100 text-red-800',
    'read-only': 'bg-sunken text-ink-soft',
  }[status]
  return <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${tone}`}>{label}</span>
}

function PresenceStrip() {
  const { me, others } = useWhosHere()
  const { identity, rename } = useIdentity()
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)

  if (!me) return null

  return (
    <div className="flex items-center">
      {editing ? (
        <input
          autoFocus
          defaultValue={identity.name}
          onBlur={(e) => {
            rename(e.target.value.trim() || identity.name, identity.color)
            setEditing(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="w-28 rounded border border-line bg-canvas px-1.5 py-0.5 text-xs outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title={t('presence.rename')}
          className="flex -space-x-1.5"
        >
          <Avatar name={me.name} color={me.color} />
          {others.slice(0, 4).map((p) => (
            <Avatar key={p.actor} name={p.name} color={p.color} />
          ))}
          {others.length > 4 && (
            <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-sunken text-[10px] font-semibold text-ink-soft ring-2 ring-white">
              +{others.length - 4}
            </span>
          )}
        </button>
      )}
    </div>
  )
}

/**
 * Which map provider is in play.
 *
 * Worth surfacing rather than hiding: a user in Shanghai seeing "高德地图" is
 * getting an explanation for why the map looks different, and a user who
 * expected Google seeing "OpenStreetMap" learns their key is missing without
 * having to open a console.
 */
function ProviderChip() {
  const registry = mapRegistry()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const version = useSyncExternalStore(
    registry.subscribe,
    () => JSON.stringify(registry.status()) + registry.getPreference(),
    () => JSON.stringify(registry.status()) + registry.getPreference(),
  )
  void version

  const statuses = registry.status()
  const preference = registry.getPreference()

  return (
    <div className="relative">
      <Button variant="quiet" onClick={() => setOpen((v) => !v)} title={t('map.provider')}>
        <GlobeIcon />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-xl border border-line bg-surface p-2 shadow-lift">
          <p className="px-2 pb-1.5 text-[11px] font-medium text-ink-soft">{t('map.provider')}</p>
          {(['auto', ...statuses.map((s) => s.id)] as ProviderPreference[]).map((id) => {
            const status = statuses.find((s) => s.id === id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  registry.setPreference(id)
                  setOpen(false)
                }}
                className={
                  'flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-sunken ' +
                  (preference === id ? 'bg-brand-soft text-ink' : 'text-ink-soft')
                }
              >
                <span>{id === 'auto' ? t('map.auto') : status?.label}</span>
                {status && (
                  <span
                    className={
                      'text-[10px] ' +
                      (status.state === 'unreachable' ? 'text-red-600' : 'text-emerald-600')
                    }
                  >
                    {status.state === 'unknown'
                      ? ''
                      : status.state === 'ready'
                        ? t('map.ready')
                        : t('map.unreachable')}
                  </span>
                )}
              </button>
            )
          })}
          <p className="mt-1.5 border-t border-line px-2 pt-1.5 text-[10px] leading-relaxed text-ink-faint">
            {t('map.hint')}
          </p>
        </div>
      )}
    </div>
  )
}

function SideNav({
  activeDay,
  onPickDay,
}: {
  activeDay: DayId | null
  onPickDay: (id: DayId | null) => void
}) {
  const trip = useTrip()
  const { t, locale } = useI18n()

  const links: { id: string; label: string }[] = [
    { id: 'overview', label: t('nav.overview') },
    { id: 'places', label: t('nav.places') },
    { id: 'itinerary', label: t('nav.itinerary') },
    { id: 'budget', label: t('nav.budget') },
    { id: 'reservations', label: t('nav.reservations') },
    { id: 'checklists', label: t('nav.checklists') },
  ]

  return (
    <nav className="hidden w-52 shrink-0 overflow-y-auto border-r border-line px-3 py-4 md:block print:hidden">
      <ul className="space-y-0.5">
        {links.map((l) => (
          <li key={l.id}>
            <a
              href={`#${l.id}`}
              className="block rounded-lg px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>

      <p className="mb-1 mt-5 px-2.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        {t('nav.itinerary')}
      </p>
      <ul className="space-y-0.5">
        <li>
          <button
            type="button"
            onClick={() => onPickDay(null)}
            className={
              'w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-sunken ' +
              (activeDay === null ? 'bg-brand-soft font-medium text-ink' : 'text-ink-soft')
            }
          >
            {locale === 'zh' ? '全部' : 'All days'}
          </button>
        </li>
        {trip.days.map((day) => (
          <li key={day.id}>
            <button
              type="button"
              onClick={() => {
                onPickDay(day.id)
                document.getElementById(`day-${day.id}`)?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start',
                })
              }}
              className={
                'flex w-full items-baseline justify-between rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-sunken ' +
                (activeDay === day.id ? 'bg-brand-soft font-medium text-ink' : 'text-ink-soft')
              }
            >
              <span>
                {t('day.day')} {day.number}
                {locale === 'zh' ? ` ${t('day.dayUnit')}` : ''}
              </span>
              <span className="text-[11px] tabular-nums text-ink-faint">{day.stops.length}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function UndoIcon({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4 fill-current"
      style={flip ? { transform: 'scaleX(-1)' } : undefined}
      aria-hidden
    >
      <path d="M8 5V2.5L3.5 6.5 8 10.5V8h3.5a3.5 3.5 0 010 7H7v1.5h4.5a5 5 0 000-10H8z" />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden>
      <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm5.9 7h-2.4a12.7 12.7 0 00-1-4.1A6.5 6.5 0 0115.9 9zM10 3.6c.6.8 1.3 2.5 1.5 5.4h-3c.2-2.9.9-4.6 1.5-5.4zM4.1 9a6.5 6.5 0 013.4-4.1 12.7 12.7 0 00-1 4.1H4.1zm0 2h2.4c.1 1.6.4 3 .9 4.1A6.5 6.5 0 014.1 11zm4 0h3.8c-.2 2.9-.9 4.6-1.9 5.4-1-.8-1.7-2.5-1.9-5.4zm5.4 4.1c.5-1.1.8-2.5.9-4.1h2.4a6.5 6.5 0 01-3.3 4.1z" />
    </svg>
  )
}
