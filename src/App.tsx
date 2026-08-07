import { useEffect, useState } from 'react'
import { I18nProvider } from './app/i18n'
import { seedDemoTrip } from './app/seed'
import { TripProvider } from './core/store'
import { asId, type Mode, type TripId } from './core/types'
import { MeetApp } from './meet/MeetApp'
import type { MeetMode } from './meet/types'
import { PrintView } from './ui/PrintView'
import { TripShell } from './ui/TripShell'

/**
 * Routing, such as it is.
 *
 *   #/                    your own trip, stored locally, synced if a relay is set
 *   #/print               the printable plan for your own trip
 *   #/s/<snapshot>        a shared trip, read-only, decoded straight from the link
 *   #/s/<snapshot>/print  the printable plan for a shared trip
 *   #/meet                your scheduling page — the hours you are giving away
 *   #/book/<page>         somebody else's scheduling page, ready to book
 *
 * The snapshot lives in the fragment rather than the path so it is never sent
 * to a server or written to an access log. That also means there is no route
 * to look up and nothing to host, which is what lets a shared plan keep
 * working offline.
 *
 * A meet page is the one route whose id *is* addressed rather than carried:
 * the booking link has to be short enough to send in a message, and unlike a
 * trip snapshot it names a live document that both sides keep writing to.
 */

const DEFAULT_TRIP = asId<'trip'>('my-trip')
const DEFAULT_MEET = 'my-meet'
const RELAY_URL = import.meta.env.VITE_RELAY_URL || undefined

interface Route {
  mode: Mode
  snapshot?: string
  tripId: TripId
  printing: boolean
  meet?: { pageId: string; mode: MeetMode }
}

function readRoute(): Route {
  const hash = window.location.hash.replace(/^#/, '')
  const printing = hash === '/print' || hash.endsWith('/print')

  if (hash === '/meet' || hash.startsWith('/meet/')) {
    const id = hash.slice('/meet'.length).replace(/^\//, '')
    return {
      mode: 'edit',
      tripId: DEFAULT_TRIP,
      printing: false,
      meet: { pageId: decodeURIComponent(id) || DEFAULT_MEET, mode: 'own' },
    }
  }

  if (hash.startsWith('/book/')) {
    const id = hash.slice('/book/'.length)
    return {
      mode: 'public',
      tripId: DEFAULT_TRIP,
      printing: false,
      meet: { pageId: decodeURIComponent(id) || DEFAULT_MEET, mode: 'guest' },
    }
  }

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

  if (route.meet) {
    return (
      <I18nProvider>
        <MeetApp pageId={route.meet.pageId} mode={route.meet.mode} />
      </I18nProvider>
    )
  }

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
