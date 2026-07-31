import type { ReactNode } from 'react'
import type { Category } from '../core/types'
import { useI18n } from '../app/i18n'
import type { StringKey } from '../app/i18n'

/* -------------------------------------------------------------------------- */
/* Cover art                                                                  */
/* -------------------------------------------------------------------------- */

const COVER_HUES: Record<Category, [number, number]> = {
  sight: [235, 200],
  food: [40, 20],
  stay: [300, 275],
  activity: [150, 175],
  shopping: [350, 320],
  transit: [255, 235],
  other: [250, 230],
}

/**
 * A deterministic cover for a place with no photo.
 *
 * Picture mode needs an image in every card or the grid falls apart, but the
 * keyless provider has no photo source. Rather than a grey box or a stock
 * photo of the wrong city, each place gets a stable gradient derived from its
 * own name — clearly not a photograph, and stable across reloads so the board
 * does not reshuffle its colours.
 */
export function CoverArt({
  seed,
  category,
  className,
}: {
  seed: string
  category: Category
  className?: string
}) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0

  const [h1, h2] = COVER_HUES[category] ?? COVER_HUES.other
  const drift = (hash % 24) - 12
  const angle = 120 + (hash % 90)
  const light = 62 + (hash % 10)

  return (
    <div
      className={className}
      aria-hidden
      style={{
        background:
          `linear-gradient(${angle}deg, ` +
          `oklch(${light}% 0.13 ${h1 + drift}) 0%, ` +
          `oklch(${light - 14}% 0.11 ${h2 + drift}) 100%)`,
      }}
    >
      <svg className="h-full w-full opacity-25" viewBox="0 0 120 80" preserveAspectRatio="none">
        <path
          d={`M0 ${60 + (hash % 10)} L${24 + (hash % 12)} ${34 + (hash % 14)} L${48 + (hash % 8)} ${
            56 - (hash % 10)
          } L${74 + (hash % 10)} ${26 + (hash % 12)} L120 ${52 + (hash % 8)} L120 80 L0 80 Z`}
          fill="rgba(255,255,255,0.55)"
        />
        <circle cx={96 - (hash % 30)} cy={18 + (hash % 8)} r={7} fill="rgba(255,255,255,0.6)" />
      </svg>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Small pieces                                                               */
/* -------------------------------------------------------------------------- */

export function CategoryChip({ category }: { category: Category }) {
  const { t } = useI18n()
  return (
    <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-ink-soft">
      {t(`cat.${category}` as StringKey)}
    </span>
  )
}

export function Rating({ value, count }: { value?: number; count?: number }) {
  if (value === undefined) return null
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-ink-soft tabular-nums">
      <svg viewBox="0 0 20 20" className="h-3 w-3 fill-amber-500" aria-hidden>
        <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9z" />
      </svg>
      {value.toFixed(1)}
      {count !== undefined && count > 0 && (
        <span className="text-ink-faint">({compactCount(count)})</span>
      )}
    </span>
  )
}

function compactCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  title,
  type = 'button',
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'quiet' | 'danger'
  disabled?: boolean
  title?: string
  type?: 'button' | 'submit'
  className?: string
}) {
  // Feedback lands on pointer-down via :active rather than waiting for click,
  // which is the difference between a button that feels connected and one
  // that feels like it is thinking about it.
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium ' +
    'transition-[background-color,color,transform,box-shadow] duration-100 ease-out ' +
    'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

  const variants = {
    primary: 'bg-brand text-white px-3 py-1.5 hover:brightness-110 shadow-sm',
    ghost: 'bg-surface text-ink px-3 py-1.5 border border-line hover:bg-sunken',
    quiet: 'text-ink-soft px-2 py-1 hover:bg-sunken hover:text-ink',
    danger: 'text-red-600 px-2 py-1 hover:bg-red-50',
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

export function Avatar({ name, color, size = 26 }: { name: string; color: string; size?: number }) {
  const label = name.trim().slice(0, 2).toUpperCase() || '?'
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white ring-2 ring-white"
      style={{ background: color, width: size, height: size, fontSize: size * 0.4 }}
      title={name}
    >
      {label}
    </span>
  )
}

export function SectionHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-lg font-semibold text-ink">{children}</h2>
      {action}
    </div>
  )
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-ink-faint">
      {children}
    </p>
  )
}

export function formatMoney(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    // An unknown currency code should not blank out the budget.
    return `${currency} ${Math.round(amount)}`
  }
}
