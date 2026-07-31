import type { Coords } from '../core/geo'
import type { MapProvider } from './provider'
import { createLocalProvider } from './local'
import { createGoogleProvider } from './google'
import { createAmapProvider } from './amap'

/**
 * Provider selection.
 *
 * Feature code never names Google or Amap. It asks for a provider near a
 * location and gets whichever one can actually answer — which matters because
 * the two failure modes here are geographic and they are not symmetric: Google
 * has no usable data problem worldwide but is *unreachable* from mainland
 * China, while Amap is reachable everywhere but only has good data for greater
 * China.
 *
 * So selection is two questions, in order: who covers this place, and who can
 * this browser actually reach. The keyless local provider answers yes to both
 * and is always last, which is why the app still works with no configuration.
 */

export interface MapConfig {
  googleKey?: string
  googleStaticKey?: string
  amapJsKey?: string
  amapSecurityCode?: string
  amapWebKey?: string
}

export function readMapConfig(): MapConfig {
  const env = import.meta.env
  return {
    googleKey: env.VITE_GOOGLE_MAPS_KEY || undefined,
    googleStaticKey: env.VITE_GOOGLE_STATIC_KEY || undefined,
    amapJsKey: env.VITE_AMAP_JS_KEY || undefined,
    amapSecurityCode: env.VITE_AMAP_SECURITY_CODE || undefined,
    amapWebKey: env.VITE_AMAP_WEB_KEY || undefined,
  }
}

export type ProviderPreference = 'auto' | 'google' | 'amap' | 'local'

export class MapRegistry {
  private providers: MapProvider[] = []
  private reachability = new Map<string, boolean>()
  private preference: ProviderPreference = 'auto'
  private listeners = new Set<() => void>()

  constructor(cfg: MapConfig = readMapConfig()) {
    if (cfg.googleKey) {
      this.providers.push(
        createGoogleProvider({ apiKey: cfg.googleKey, staticKey: cfg.googleStaticKey }),
      )
    }
    if (cfg.amapJsKey) {
      this.providers.push(
        createAmapProvider({
          jsKey: cfg.amapJsKey,
          securityCode: cfg.amapSecurityCode,
          webKey: cfg.amapWebKey,
        }),
      )
    }
    this.providers.push(createLocalProvider())
  }

  all(): readonly MapProvider[] {
    return this.providers
  }

  get(id: string): MapProvider | undefined {
    return this.providers.find((p) => p.id === id)
  }

  setPreference(pref: ProviderPreference): void {
    this.preference = pref
    this.emit()
  }

  getPreference(): ProviderPreference {
    return this.preference
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const l of this.listeners) l()
  }

  /**
   * The provider to use near a location.
   *
   * Reachability is probed once per provider and cached: a China-based user
   * should pay the Google timeout at most once per session, not on every
   * keystroke in the search box.
   */
  async select(near?: Coords): Promise<MapProvider> {
    if (this.preference !== 'auto') {
      const forced = this.get(this.preference)
      if (forced && (await this.reachable(forced))) return forced
    }

    const candidates = near ? this.providers.filter((p) => p.covers(near)) : this.providers
    for (const provider of candidates) {
      if (await this.reachable(provider)) return provider
    }
    return this.providers[this.providers.length - 1]
  }

  private async reachable(provider: MapProvider): Promise<boolean> {
    const cached = this.reachability.get(provider.id)
    if (cached !== undefined) return cached
    let ok = false
    try {
      ok = await provider.available()
    } catch {
      ok = false
    }
    this.reachability.set(provider.id, ok)
    this.emit()
    return ok
  }

  /** What the status chip shows: which providers are configured and live. */
  status(): { id: string; label: string; state: 'ready' | 'unreachable' | 'unknown' }[] {
    return this.providers.map((p) => {
      const known = this.reachability.get(p.id)
      return {
        id: p.id,
        label: p.label,
        state: known === undefined ? 'unknown' : known ? 'ready' : 'unreachable',
      }
    })
  }
}

let singleton: MapRegistry | null = null

export function mapRegistry(): MapRegistry {
  singleton ??= new MapRegistry()
  return singleton
}
