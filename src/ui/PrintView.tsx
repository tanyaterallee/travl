import { useEffect, useState } from 'react'
import { leavePrint } from '../App'
import { useI18n } from '../app/i18n'
import { useTrip } from '../core/store'
import type { Day } from '../core/types'
import { formatDistance, formatDuration } from '../maps/provider'
import { mapRegistry } from '../maps/registry'
import { formatMoney } from './primitives'

/**
 * The printable plan.
 *
 * Every map here is a flat image, resolved once before printing. A live map
 * canvas does not survive a print dialog reliably, and the shared link has to
 * print without an API key, so the static path is the only one that works for
 * both.
 */
export function PrintView({ autoPrint = false }: { autoPrint?: boolean }) {
  const trip = useTrip()
  const { t, locale } = useI18n()
  const [maps, setMaps] = useState<Record<string, string>>({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const out: Record<string, string> = {}
      for (const day of trip.days) {
        if (day.stops.length === 0) continue
        try {
          const provider = await mapRegistry().select(day.stops[0].coords)
          const answer = await provider.query({
            kind: 'static',
            markers: day.stops.map((p, i) => ({ coords: p.coords, label: String(i + 1) })),
            path: day.stops.map((p) => p.coords),
            size: [720, 320],
            scale: 2,
            locale,
          })
          if (answer.kind === 'static') out[day.id] = answer.url
        } catch {
          // A day without a map still prints; the stop list is the point.
        }
      }
      if (!cancelled) {
        setMaps(out)
        setReady(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [trip.days, locale])

  // Wait for the maps before opening the dialog — printing a page whose images
  // are still resolving produces a plan with blank rectangles where the maps
  // should be, and the user has already committed by then.
  useEffect(() => {
    if (!autoPrint || !ready) return
    const timer = setTimeout(() => window.print(), 350)
    return () => clearTimeout(timer)
  }, [autoPrint, ready])

  return (
    <article className="mx-auto max-w-3xl bg-white px-8 py-10 text-ink print:px-0 print:py-0">
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <button
          type="button"
          onClick={leavePrint}
          className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-soft transition-colors hover:bg-sunken"
        >
          ← {t('action.close')}
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!ready}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {ready ? t('share.print') : t('print.generating')}
        </button>
      </div>

      <header className="mb-6 border-b border-line pb-4">
        <h1 className="text-3xl font-semibold tracking-[-0.02em]">{trip.title}</h1>
        {trip.startDate && trip.endDate && (
          <p className="mt-1 text-sm tabular-nums text-ink-soft">
            {trip.startDate} → {trip.endDate}
          </p>
        )}
        {trip.summary && (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
            {trip.summary}
          </p>
        )}
        {!ready && (
          <p className="mt-2 text-xs italic text-ink-faint print:hidden">{t('print.generating')}</p>
        )}
      </header>

      {trip.reservations.length > 0 && (
        <section className="mb-6 break-inside-avoid">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">
            {t('nav.reservations')}
          </h2>
          <ul className="space-y-1 text-sm">
            {trip.reservations.map((r) => (
              <li key={r.id} className="flex justify-between gap-4 border-b border-line/60 py-1">
                <span className="min-w-0">
                  <span className="font-medium">{r.title}</span>
                  {r.confirmation && (
                    <span className="ml-2 text-xs tabular-nums text-ink-faint">
                      {r.confirmation}
                    </span>
                  )}
                </span>
                {r.start && (
                  <span className="shrink-0 text-xs tabular-nums text-ink-soft">
                    {r.start.replace('T', ' ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {trip.days.map((day) => (
        <PrintDay key={day.id} day={day} mapUrl={maps[day.id]} currency={trip.currency} />
      ))}

      {trip.wishlist.length > 0 && (
        <section className="mt-6 break-inside-avoid">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">
            {t('wishlist.title')}
          </h2>
          <ul className="columns-2 gap-6 text-sm">
            {trip.wishlist.map((p) => (
              <li key={p.id} className="mb-1 break-inside-avoid">
                · {p.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      {trip.checklists.map((list) => (
        <section key={list.id} className="mt-6 break-inside-avoid">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">
            {list.title}
          </h2>
          <ul className="columns-2 gap-6 text-sm">
            {list.items.map((i) => (
              <li key={i.id} className="mb-1 break-inside-avoid">
                <span className="mr-1.5 inline-block h-3 w-3 border border-ink-faint align-middle" />
                {i.text}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {trip.budget.total > 0 && (
        <section className="mt-6 break-inside-avoid border-t border-line pt-3">
          <div className="flex justify-between text-sm font-semibold">
            <span>{t('budget.total')}</span>
            <span className="tabular-nums">
              {formatMoney(trip.budget.total, trip.currency, locale)}
            </span>
          </div>
        </section>
      )}
    </article>
  )
}

function PrintDay({ day, mapUrl, currency }: { day: Day; mapUrl?: string; currency: string }) {
  const { t, locale } = useI18n()
  if (day.stops.length === 0) return null

  return (
    <section className="mb-8 break-inside-avoid">
      <h2 className="mb-2 flex items-baseline gap-2 text-lg font-semibold">
        {t('day.day')} {day.number}
        {locale === 'zh' && ` ${t('day.dayUnit')}`}
        {day.date && <span className="text-sm font-normal tabular-nums text-ink-soft">{day.date}</span>}
        {day.title && <span className="text-sm font-normal text-ink-soft">· {day.title}</span>}
      </h2>

      {mapUrl && (
        <img
          src={mapUrl}
          alt=""
          className="mb-3 w-full rounded-lg border border-line"
          style={{ aspectRatio: '720 / 320', objectFit: 'cover' }}
        />
      )}

      <ol className="space-y-2">
        {day.stops.map((place, i) => (
          <li key={place.id}>
            <div className="flex gap-2">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink text-[11px] font-semibold text-white">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">
                    {place.startTime && (
                      <span className="mr-2 text-xs tabular-nums text-ink-soft">
                        {place.startTime}
                      </span>
                    )}
                    {place.name}
                  </span>
                  {place.cost !== undefined && place.cost > 0 && (
                    <span className="shrink-0 text-xs tabular-nums text-ink-soft">
                      {formatMoney(place.cost, currency, locale)}
                    </span>
                  )}
                </div>
                <p className="text-xs text-ink-faint">{place.address}</p>
                {place.notes && (
                  <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-ink-soft">
                    {place.notes}
                  </p>
                )}
              </div>
            </div>
            {day.legs[i] && !day.legs[i].pending && (
              <p className="ml-7 mt-1 text-[11px] tabular-nums text-ink-faint">
                ↓ {formatDuration(day.legs[i].durationSec ?? 0, locale)}
                {day.legs[i].distanceM !== null && (
                  <> · {formatDistance(day.legs[i].distanceM!, locale)}</>
                )}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
