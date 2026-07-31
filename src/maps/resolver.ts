import { useEffect, useRef } from 'react'
import { cacheLeg, legKey } from '../core/doc'
import { useCan, useDoc, useTrip } from '../core/store'
import type { Locale, TravelMode } from '../core/types'
import { mapRegistry } from './registry'

/**
 * The leg resolver.
 *
 * Travel times are derived data, so nothing renders them by calling a
 * directions API — a component that fetched on render would re-fetch on every
 * keystroke and bill for it. Instead this watches for stop pairs with no
 * cached leg, resolves them once, and writes the answer into the document.
 *
 * Writing results into the CRDT rather than into component state is what makes
 * the rest work: collaborators see the same drive times without each paying
 * for the same lookup, and the shared link and the print view render with no
 * network and no API key at all.
 */

export function useLegResolver(locale: Locale = 'en'): void {
  const trip = useTrip()
  const { mutate } = useDoc()
  const { edit } = useCan()

  // Keys currently being fetched, so a re-render mid-flight does not fire the
  // same request again.
  const inflight = useRef(new Set<string>())
  // Pairs that failed. Retrying forever against a provider that cannot route
  // them would be a slow, billable loop.
  const failed = useRef(new Set<string>())

  useEffect(() => {
    if (!edit) return

    const mode: TravelMode = 'drive'
    let cancelled = false

    void (async () => {
      for (const day of trip.days) {
        const missing = day.legs
          .map((leg, i) => ({ leg, i }))
          .filter(({ leg }) => leg.pending)
          .filter(({ leg }) => {
            const key = legKey(leg.from, leg.to, mode)
            return !inflight.current.has(key) && !failed.current.has(key)
          })
        if (missing.length === 0) continue

        for (const { i } of missing) {
          const from = day.stops[i]
          const to = day.stops[i + 1]
          if (!from || !to) continue
          const key = legKey(from.id, to.id, mode)
          inflight.current.add(key)

          try {
            const provider = await mapRegistry().select(from.coords)
            const answer = await provider.query({
              kind: 'route',
              stops: [from.coords, to.coords],
              mode,
              locale,
            })
            if (cancelled) return
            if (answer.kind !== 'route' || !answer.legs[0]) {
              failed.current.add(key)
              continue
            }
            const leg = answer.legs[0]
            mutate((doc) =>
              cacheLeg(doc, from.id, to.id, mode, {
                durationSec: leg.durationSec,
                distanceM: leg.distanceM,
                polyline: leg.polyline,
                provider: provider.id,
                at: Date.now(),
              }),
            )
          } catch {
            failed.current.add(key)
          } finally {
            inflight.current.delete(key)
          }
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [trip, mutate, edit, locale])
}
