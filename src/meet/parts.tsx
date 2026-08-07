import { useCallback, useState, type ReactNode } from 'react'
import { useI18n } from '../app/i18n'
import { mapsEmbedUrl, mapsSearchUrl, type PlaceLike } from './links'
import type { SlotState } from './types'

/**
 * The pieces both sides of the product share.
 *
 * The owner console and the booking page are different surfaces for different
 * people, but a slot has to *look* the same in both — an owner who sees a slot
 * as open and a guest who sees the same slot as unavailable is a bug the user
 * reports as "it lied to me". So the state pill and the place panel are
 * written once.
 */

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-card border border-line bg-surface p-4 shadow-card ${className}`}
    >
      {(title || action) && (
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-ink-faint">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink ' +
  'placeholder:text-ink-faint outline-none transition-colors ' +
  'focus:border-brand focus:ring-2 focus:ring-brand/20'

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'error'
  children: ReactNode
}) {
  const tones = {
    info: 'border-line bg-sunken text-ink-soft',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-800',
  }
  return (
    <p className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${tones[tone]}`}>
      {children}
    </p>
  )
}

/* -------------------------------------------------------------------------- */
/* Slot state                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The three states, and their colours.
 *
 * They are deliberately not a traffic light. Green-amber-red would read as
 * good-warning-bad, and there is nothing bad about an afternoon that is
 * already spoken for: one is an invitation, one is a fact about a person, one
 * is a fact about the plan. So: brand for open, a settled green for booked,
 * and no colour at all for unavailable.
 */
export function StatePill({ state, past = false }: { state: SlotState; past?: boolean }) {
  const { t } = useI18n()
  if (past) {
    return <Pill className="bg-sunken text-ink-faint">{t('meet.state.past')}</Pill>
  }
  if (state === 'booked') {
    return <Pill className="bg-emerald-50 text-emerald-700">{t('meet.state.booked')}</Pill>
  }
  if (state === 'blocked') {
    return <Pill className="bg-sunken text-ink-faint line-through">{t('meet.state.blocked')}</Pill>
  }
  return <Pill className="bg-brand-soft text-brand">{t('meet.state.open')}</Pill>
}

export function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}
    >
      {children}
    </span>
  )
}

/** The left rule that lets a long day be scanned without reading the pills. */
export function stateRule(state: SlotState, past: boolean): string {
  if (past) return 'border-l-line'
  if (state === 'booked') return 'border-l-emerald-400'
  if (state === 'blocked') return 'border-l-line'
  return 'border-l-brand'
}

/* -------------------------------------------------------------------------- */
/* Place                                                                      */
/* -------------------------------------------------------------------------- */

const MAPS_KEY: string = import.meta.env.VITE_GOOGLE_MAPS_KEY ?? ''

/**
 * Where a slot happens.
 *
 * The name and the address are both the link, because that is what a guest
 * reaches for — nobody hunts for a separate "directions" button when the
 * address is right there. The embedded map sits below rather than above: the
 * words identify the place, the map only reassures.
 */
export function PlacePanel({
  place,
  title,
  compact = false,
}: {
  place: PlaceLike
  title?: string
  compact?: boolean
}) {
  const { t, locale } = useI18n()
  const hasPlace = Boolean(place.locationName || place.address || place.coords)
  if (!hasPlace) return null

  const href = mapsSearchUrl(place)

  return (
    <div className="space-y-2">
      {title && (
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{title}</h3>
      )}
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="group block rounded-lg px-1 -mx-1 py-0.5 transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <span className="flex items-center gap-1.5 text-sm font-medium text-ink group-hover:text-brand">
          {place.locationName || place.address}
          <PinIcon />
        </span>
        {place.address && place.locationName && (
          <span className="block text-xs text-ink-soft">{place.address}</span>
        )}
        {/* Always visible, never revealed on hover: this is read on a phone,
            where there is no hover and this is the action most likely wanted. */}
        <span className="mt-0.5 block text-[11px] font-medium text-brand">
          {t('meet.guest.openMaps')}
        </span>
      </a>

      {/* The embed sits on a filled panel so that a network which cannot reach
          Google — a phone on a plane, a browser behind a blocker — degrades to
          a quiet grey card rather than a broken frame. The link above is the
          part that always works. */}
      <div className={`overflow-hidden rounded-lg border border-line bg-sunken ${compact ? 'h-36' : 'h-56'}`}>
        <iframe
          title={place.locationName || place.address}
          src={mapsEmbedUrl(place, { key: MAPS_KEY || undefined, locale })}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
          className="h-full w-full border-0"
        />
      </div>
    </div>
  )
}

function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 fill-current opacity-60" aria-hidden>
      <path d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5c0 3.2 4 8.2 4.2 8.4a.4.4 0 0 0 .6 0c.2-.2 4.2-5.2 4.2-8.4A4.5 4.5 0 0 0 8 1.5Zm0 6.2a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4Z" />
    </svg>
  )
}

/* -------------------------------------------------------------------------- */
/* Copying                                                                    */
/* -------------------------------------------------------------------------- */

/** Copy, with the "Copied" state that tells the user the click landed. */
export function useCopy(): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false)
  const copy = useCallback((text: string) => {
    const done = () => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(done, fallback)
    } else {
      fallback()
    }

    // Clipboard access is denied outright in some embedded browsers; a
    // selected, copyable input beats a button that silently does nothing.
    function fallback() {
      const el = document.createElement('textarea')
      el.value = text
      el.setAttribute('readonly', '')
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      try {
        document.execCommand('copy')
        done()
      } catch {
        // Nothing left to try; the field is still selectable by hand.
      }
      document.body.removeChild(el)
    }
  }, [])
  return { copied, copy }
}
