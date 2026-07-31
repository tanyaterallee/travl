import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../app/i18n'
import { useActions, useTrip } from '../core/store'
import { centerOf } from '../core/geo'
import type { DayId } from '../core/types'
import { mapRegistry } from '../maps/registry'
import type { PlaceHit } from '../maps/provider'
import { Button, CategoryChip, CoverArt, Rating } from './primitives'

/**
 * Place search.
 *
 * Debounced and race-cancelled inside, so the call site is just a query
 * string. Results are biased toward the trip's existing places, which is what
 * makes "the Bund" find the one in Shanghai rather than a bar in Melbourne.
 */
export function SearchBox({ targetDay }: { targetDay?: DayId | null }) {
  const { t, locale } = useI18n()
  const trip = useTrip()
  const actions = useActions()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<readonly PlaceHit[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // Memoised because this feeds an effect dependency array: `centerOf`
  // returns a fresh object every call, which would re-run the search on every
  // render and never settle.
  const near = useMemo(
    () => centerOf(trip.places.map((p) => p.coords)) ?? undefined,
    [trip.places],
  )

  useEffect(() => {
    const text = query.trim()
    if (text.length < 2) {
      // Functional update so an already-empty list keeps its identity and
      // React can bail out instead of re-rendering.
      setHits((prev) => (prev.length === 0 ? prev : []))
      setSearching(false)
      return
    }

    const controller = new AbortController()
    let cancelled = false
    setSearching(true)

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const provider = await mapRegistry().select(near)
          const answer = await provider.query(
            { kind: 'search', text, near, locale },
            controller.signal,
          )
          if (cancelled) return
          setHits(answer.kind === 'search' ? answer.hits : [])
        } catch {
          if (!cancelled) setHits([])
        } finally {
          if (!cancelled) setSearching(false)
        }
      })()
    }, 220)

    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [query, locale, near])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  async function add(hit: PlaceHit) {
    const id = actions.addPlace(
      {
        name: hit.name,
        address: hit.secondary,
        category: hit.category,
        coords: hit.coords,
        rating: hit.rating,
        ratingCount: hit.ratingCount,
        photos: hit.photo ? [hit.photo] : [],
        ref: hit.ref,
        pending: true,
      },
      targetDay ?? null,
    )
    setQuery('')
    setHits([])
    setOpen(false)

    // Details stream in after the card is already on the board, so the drag
    // never waits on a network round trip.
    try {
      const provider = await mapRegistry().select(hit.coords)
      const answer = await provider.query({ kind: 'details', ref: hit.ref, locale })
      if (answer.kind !== 'details') return
      const d = answer.place
      actions.patchPlace(id, {
        name: d.name,
        address: d.address,
        category: d.category,
        coords: d.coords,
        rating: d.rating,
        ratingCount: d.ratingCount,
        photos: d.photos,
        website: d.website,
        phone: d.phone,
        pending: false,
      })
    } catch {
      actions.patchPlace(id, { pending: false })
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-card focus-within:border-brand">
        <SearchIcon />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={t('place.search')}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        />
        {searching && <span className="text-[11px] text-ink-faint">{t('place.searching')}</span>}
      </div>

      {open && query.trim().length >= 2 && (
        <div className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl border border-line bg-surface shadow-lift">
          {hits.length === 0 && !searching && (
            <p className="px-3 py-4 text-center text-xs text-ink-faint">{t('place.noResults')}</p>
          )}
          <ul className="max-h-80 overflow-y-auto">
            {hits.map((hit) => (
              <li key={`${hit.ref.provider}:${hit.ref.id}`}>
                <button
                  type="button"
                  onClick={() => void add(hit)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-sunken active:bg-brand-soft"
                >
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg">
                    {hit.photo ? (
                      <img src={hit.photo.url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <CoverArt seed={hit.name} category={hit.category} className="h-full w-full" />
                    )}
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{hit.name}</span>
                    <span className="block truncate text-[11px] text-ink-faint">{hit.secondary}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Rating value={hit.rating} count={hit.ratingCount} />
                    <CategoryChip category={hit.category} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function AddDayButton() {
  const { t } = useI18n()
  const actions = useActions()
  return <Button onClick={() => actions.addDay()}>+ {t('day.add')}</Button>
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 fill-ink-faint" aria-hidden>
      <path d="M8.5 3a5.5 5.5 0 014.38 8.83l3.65 3.64-1.06 1.06-3.64-3.65A5.5 5.5 0 118.5 3zm0 1.5a4 4 0 100 8 4 4 0 000-8z" />
    </svg>
  )
}
