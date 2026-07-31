import type { Category } from '../core/types'
import type { MapMarker } from './provider'

/**
 * Marker DOM, shared by every provider that can take a custom element.
 *
 * Building it here rather than per adapter keeps a pin on the Google map and a
 * pin on the Amap map visually identical — the provider swap is meant to be
 * invisible to the person reading the itinerary.
 */

export const CATEGORY_COLOR: Record<Category, string> = {
  sight: 'oklch(58% 0.16 235)',
  food: 'oklch(62% 0.17 40)',
  stay: 'oklch(56% 0.16 300)',
  activity: 'oklch(60% 0.16 150)',
  shopping: 'oklch(62% 0.18 350)',
  transit: 'oklch(52% 0.06 260)',
  other: 'oklch(55% 0.04 260)',
}

export function markerElement(m: MapMarker): HTMLElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'travl-pin'
  el.setAttribute('aria-label', m.label)
  el.dataset.active = String(m.active ?? false)
  el.dataset.dim = String(m.dim ?? false)

  const pin = document.createElement('span')
  pin.className = 'travl-pin__body'
  pin.style.background = CATEGORY_COLOR[m.category] ?? CATEGORY_COLOR.other
  pin.textContent = m.label
  el.appendChild(pin)

  const stem = document.createElement('span')
  stem.className = 'travl-pin__stem'
  stem.style.background = CATEGORY_COLOR[m.category] ?? CATEGORY_COLOR.other
  el.appendChild(stem)

  return el
}
