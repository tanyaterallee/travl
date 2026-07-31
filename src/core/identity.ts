import { asId, type ActorId } from './types'

/**
 * Who you are on this device.
 *
 * There is no account system: a trip is reachable by whoever holds the link,
 * which is the model the app is actually built around. This just gives each
 * browser a stable identity so presence cursors and authorship survive a
 * reload.
 */

const KEY = 'travl.identity.v1'

export interface Identity {
  actor: ActorId
  name: string
  color: string
}

/** Distinguishable at a glance and legible on both light and dark chrome. */
const COLORS = [
  'oklch(62% 0.19 25)',
  'oklch(68% 0.17 60)',
  'oklch(72% 0.16 130)',
  'oklch(64% 0.15 175)',
  'oklch(58% 0.17 235)',
  'oklch(56% 0.19 285)',
  'oklch(62% 0.20 330)',
]

const ANIMALS = [
  'Traveller',
  'Wanderer',
  'Explorer',
  'Navigator',
  'Nomad',
  'Voyager',
  'Rambler',
]

export function loadIdentity(): Identity {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Identity
      if (parsed.actor && parsed.name && parsed.color) return parsed
    }
  } catch {
    // Private browsing, disabled storage, or corrupt JSON — fall through and
    // mint a fresh identity rather than failing to open the trip.
  }
  const fresh: Identity = {
    actor: asId<'actor'>(crypto.randomUUID()),
    name: ANIMALS[Math.floor(Math.random() * ANIMALS.length)],
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }
  saveIdentity(fresh)
  return fresh
}

export function saveIdentity(id: Identity): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(id))
  } catch {
    // Non-fatal: presence just won't survive a reload.
  }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
