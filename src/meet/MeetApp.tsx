import { useI18n } from '../app/i18n'
import { Avatar } from '../ui/primitives'
import { BookingFlow } from './BookingFlow'
import { useGoogleAccount, type GoogleAccount } from './google'
import { OwnerConsole } from './OwnerConsole'
import { seedMeetPage } from './seed'
import { MeetProvider, useMeetMode, useMeetPage, useMeetSync } from './store'
import type { MeetMode } from './types'

/**
 * The scheduling surface, both sides of it.
 *
 * One component serves owner and guest because they are one document: the
 * difference is which half of it you may write, not which app you are in. That
 * is also why the guest page needs no build step, no account and no server —
 * it is the same bundle, opened at a different route.
 */

const RELAY_URL = import.meta.env.VITE_RELAY_URL || undefined

export function MeetApp({ pageId, mode }: { pageId: string; mode: MeetMode }) {
  // The hook lives above the provider so a sign-in survives the document being
  // torn down and rebuilt when the page id changes.
  const account = useGoogleAccount()

  return (
    <MeetProvider
      key={`${pageId}:${mode}`}
      pageId={pageId}
      mode={mode}
      relayUrl={RELAY_URL}
      seed={mode === 'own' ? seedMeetPage : undefined}
    >
      <div className="flex min-h-dvh flex-col bg-canvas">
        <MeetHeader account={account} />
        <main className="flex-1">{mode === 'own' ? <OwnerConsole account={account} /> : <BookingFlow />}</main>
      </div>
    </MeetProvider>
  )
}

function MeetHeader({ account }: { account: GoogleAccount }) {
  const mode = useMeetMode()
  const page = useMeetPage()
  const sync = useMeetSync()
  const { t, locale, setLocale } = useI18n()

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface/80 px-4 py-2.5 backdrop-blur-md">
      <a href="#/meet" className="flex items-center gap-2 text-sm font-semibold tracking-[-0.01em] text-ink">
        <span className="inline-grid h-6 w-6 place-items-center rounded-md bg-brand text-[11px] font-bold text-white">
          tv
        </span>
        {t('meet.name')}
      </a>

      {mode === 'own' ? (
        <span className="hidden text-xs text-ink-faint sm:inline">{t('meet.tagline')}</span>
      ) : (
        page.ownerName && (
          <span className="flex items-center gap-1.5 text-xs text-ink-soft">
            {page.ownerAvatar ? (
              <img
                src={page.ownerAvatar}
                alt=""
                className="h-5 w-5 rounded-full"
                referrerPolicy="no-referrer"
              />
            ) : (
              <Avatar name={page.ownerName} color="oklch(58% 0.16 235)" size={20} />
            )}
            {page.ownerName}
          </span>
        )
      )}

      <div className="ml-auto flex items-center gap-2">
        <SyncDot state={sync} />
        {mode === 'own' && (
          <a
            href="#/"
            className="rounded-lg px-2 py-1 text-xs text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
          >
            {t('meet.backToTrip')}
          </a>
        )}
        {mode === 'own' && account.status === 'signed-in' && account.profile?.picture && (
          <img
            src={account.profile.picture}
            alt={account.profile.name}
            title={account.profile.email}
            className="h-6 w-6 rounded-full"
            referrerPolicy="no-referrer"
          />
        )}
        <button
          type="button"
          onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
          className="rounded-lg px-2 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
        >
          {locale === 'zh' ? 'EN' : '中文'}
        </button>
      </div>
    </header>
  )
}

/**
 * Whether a booking made on somebody else's phone will reach this screen.
 *
 * It is a dot rather than a sentence because the answer is only interesting
 * when it is bad — and when it is bad it is *very* interesting, since a local
 * page still accepts bookings that nobody else will ever see.
 */
function SyncDot({ state }: { state: ReturnType<typeof useMeetSync> }) {
  const { t } = useI18n()
  const label = {
    local: t('sync.local'),
    connecting: t('sync.connecting'),
    live: t('sync.live'),
    offline: t('sync.offline'),
    'read-only': t('sync.readOnly'),
  }[state]

  const colour = {
    local: 'bg-ink-faint',
    connecting: 'bg-amber-400',
    live: 'bg-emerald-500',
    offline: 'bg-red-400',
    'read-only': 'bg-ink-faint',
  }[state]

  return (
    <span className="flex items-center gap-1.5 text-[11px] text-ink-faint" title={label}>
      <span className={`h-1.5 w-1.5 rounded-full ${colour}`} aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </span>
  )
}
