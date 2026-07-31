import { useEffect, useRef, useState } from 'react'
import { goToPrint } from '../App'
import { useI18n } from '../app/i18n'
import { useShareLink } from '../core/store'
import { Button } from './primitives'

/**
 * Sharing.
 *
 * The link carries a sealed snapshot in its fragment, so it never touches a
 * server and keeps working with no network. "Leave the budget out" removes the
 * expense data from the bytes rather than hiding it — anyone can read a
 * fragment, so hiding would publish it.
 */
export function ShareDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const { build } = useShareLink()
  const [excludeBudget, setExcludeBudget] = useState(false)
  const [copied, setCopied] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  const { url, ok } = build({ excludeBudget })

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    dialogRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard blocked — the field is selectable, so this is recoverable.
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('share.title')}
        tabIndex={-1}
        className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-lift outline-none"
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">{t('share.title')}</h2>
          <Button variant="quiet" onClick={onClose}>
            {t('action.close')}
          </Button>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-ink-soft">{t('share.description')}</p>

        <label className="mb-3 flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={excludeBudget}
            onChange={(e) => setExcludeBudget(e.target.checked)}
            className="h-4 w-4 accent-[oklch(58%_0.16_235)]"
          />
          {t('share.excludeBudget')}
        </label>

        {ok ? (
          <div className="flex gap-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 truncate rounded-lg border border-line bg-canvas px-2.5 py-2 font-mono text-[11px] text-ink-soft outline-none"
            />
            <Button variant="primary" onClick={() => void copy()}>
              {copied ? t('share.copied') : t('share.copy')}
            </Button>
          </div>
        ) : (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {t('share.tooLong')}
          </p>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
          <span className="text-[11px] text-ink-faint">
            {Math.round(url.length / 1024)} KB
          </span>
          <Button onClick={goToPrint}>{t('share.print')}</Button>
        </div>
      </div>
    </div>
  )
}
