import { useEffect, useRef, useState } from 'react'
import type { Coords } from '../core/geo'
import { useTrip } from '../core/store'
import type { DayId, Locale, Place, PlaceId } from '../core/types'
import type { MapHandle, MapMarker, MapProvider, MapView } from './provider'
import { mapRegistry } from './registry'

/**
 * The only map surface feature code touches.
 *
 * Give it a day (or nothing, for the whole trip) and it works out which
 * provider to use, converts coordinates to that provider's datum, numbers the
 * pins, and draws the route. Nothing above this line knows whether it is
 * looking at Google or Amap.
 */

export function TripMap({
  dayId,
  places,
  focus,
  onPick,
  className,
  locale = 'en',
}: {
  dayId?: DayId | null
  places?: readonly Place[]
  focus?: PlaceId | null
  onPick?: (id: PlaceId) => void
  className?: string
  locale?: Locale
}) {
  const trip = useTrip()
  const elRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<MapHandle | null>(null)
  const [provider, setProvider] = useState<MapProvider | null>(null)
  const [error, setError] = useState<string | null>(null)

  const shown: Place[] = places
    ? [...places]
    : dayId
      ? [...(trip.days.find((d) => d.id === dayId)?.stops ?? [])]
      : [...trip.places]

  const markers: MapMarker[] = shown.map((p, i) => ({
    id: p.id,
    coords: p.coords,
    label: dayId || places ? String(i + 1) : '',
    category: p.category,
    active: focus === p.id,
    dim: focus != null && focus !== p.id,
  }))

  const path: Coords[] = dayId ? shown.map((p) => p.coords) : []
  const fit: Coords[] = shown.map((p) => p.coords)

  // Keep the latest view in a ref so the mount effect does not need it as a
  // dependency — remounting the map on every hover would be catastrophic.
  const viewRef = useRef<MapView>({ markers, path, fit, locale })
  viewRef.current = {
    markers,
    path,
    fit,
    locale,
    onPick: onPick ? (id) => onPick(id as PlaceId) : undefined,
  }

  const near = shown[0]?.coords

  useEffect(() => {
    let cancelled = false
    const el = elRef.current
    if (!el) return

    void (async () => {
      try {
        const chosen = await mapRegistry().select(near)
        if (cancelled) return
        const handle = await chosen.mount(el, viewRef.current)
        if (cancelled) {
          handle.destroy()
          return
        }
        handleRef.current = handle
        // The view may have changed while the SDK was loading, and the update
        // effect below already ran against a null handle.
        handle.update(viewRef.current)
        setProvider(chosen)
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Map failed to load')
      }
    })()

    return () => {
      cancelled = true
      handleRef.current?.destroy()
      handleRef.current = null
    }
    // Only the chosen provider should force a remount, and that is keyed on
    // whether we have any location at all rather than on the exact point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(near)])

  const signature = JSON.stringify({
    m: markers.map((m) => [m.id, m.label, m.active, m.dim]),
    f: fit.length,
    p: path.length,
    locale,
  })

  useEffect(() => {
    handleRef.current?.update(viewRef.current)
  }, [signature])

  return (
    <div className={`relative isolate ${className ?? ''}`}>
      <div ref={elRef} className="absolute inset-0" />
      {error && (
        <div className="absolute inset-x-0 bottom-0 bg-white/90 p-3 text-sm text-ink-soft backdrop-blur">
          {error}
        </div>
      )}
      {provider && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-medium text-ink-soft shadow-sm backdrop-blur">
          {provider.label}
        </div>
      )}
      {shown.length === 0 && (
        <div className="absolute inset-0 grid place-items-center text-sm text-ink-faint">
          {locale === 'zh' ? '还没有地点' : 'No places yet'}
        </div>
      )}
    </div>
  )
}
