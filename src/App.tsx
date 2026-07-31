import { useEffect, useState } from 'react'
import { I18nProvider } from './app/i18n'
import { seedDemoTrip } from './app/seed'
import { TripProvider } from './core/store'
import { asId, type Mode, type TripId } from './core/types'
import { PrintView } from './ui/PrintView'
import { TripShell } from './ui/TripShell'

/**
 * Routing, such as it is.
 *
 *   #/                    your own trip, stored locally, synced if a relay is set
 *   #/print               the printable plan for your own trip
 *   #/s/<snapshot>        a shared trip, read-only, decoded straight from the link
 *   #/s/<snapshot>/print  the printable plan for a shared trip
 *
 * The snapshot lives in the fragment rather than the path so it is never sent
 * to a server or written to an access log. That also means there is no route
 * to look up and nothing to host, which is what lets a shared plan keep
 * working offline.
 */

const DEFAULT_TRIP = asId<'trip'>('my-trip')
const RELAY_URL = import.meta.env.VITE_RELAY_URL || undefined

interface Route {
  mode: Mode
  snapshot?: string
  tripId: TripId
  printing: boolean
}

function readRoute(): Route {
  const hash = window.location.hash.replace(/^#/, '')
  const printing = hash === '/print' || hash.endsWith('/print')

  if (hash.startsWith('/s/')) {
    const token = hash.slice(3).replace(/\/print$/, '')
    return {
      mode: printing ? 'print' : 'public',
      snapshot: token,
      tripId: asId<'trip'>('shared'),
      printing,
    }
  }
  return {
    mode: printing ? 'print' : 'edit',
    tripId: DEFAULT_TRIP,
    printing,
  }
}

export default function App() {
  const [route, setRoute] = useState(readRoute)

  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <I18nProvider>
      <TripProvider
        key={`${route.snapshot ?? route.tripId}:${route.printing}`}
        tripId={route.tripId}
        mode={route.mode}
        snapshot={route.snapshot}
        relayUrl={route.mode === 'edit' ? RELAY_URL : undefined}
        seed={seedDemoTrip}
      >
        {route.printing ? <PrintView autoPrint /> : <TripShell />}
      </TripProvider>
    </I18nProvider>
  )
}

/** Navigate to the print view for whatever is currently open. */
export function goToPrint(): void {
  const hash = window.location.hash.replace(/^#/, '')
  if (hash.endsWith('/print')) return
  window.location.hash = hash.startsWith('/s/') ? `${hash}/print` : '/print'
}

/** Leave the print view. */
export function leavePrint(): void {
  const hash = window.location.hash.replace(/^#/, '')
  window.location.hash = hash.replace(/\/print$/, '') || '/'
}
