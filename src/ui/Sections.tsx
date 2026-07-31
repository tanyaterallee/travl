import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../app/i18n'
import type { StringKey } from '../app/i18n'
import { useActions, useCan, useTrip } from '../core/store'
import { CATEGORIES, type Category, type ReservationKind } from '../core/types'
import { Button, EmptyNote, SectionHeading, formatMoney } from './primitives'

/* -------------------------------------------------------------------------- */
/* Overview                                                                   */
/* -------------------------------------------------------------------------- */

export function Overview() {
  const trip = useTrip()
  const actions = useActions()
  const { edit } = useCan()
  const { t } = useI18n()
  const [draft, setDraft] = useState(trip.summary)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(trip.summary)
  }, [trip.summary])

  return (
    <section id="overview">
      <SectionHeading>{t('trip.summary')}</SectionHeading>
      {edit ? (
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            actions.setSummaryText(e.target.value)
          }}
          rows={3}
          placeholder={t('trip.summaryPlaceholder')}
          className="w-full resize-y rounded-card border border-line bg-surface px-3 py-2.5 text-sm leading-relaxed text-ink shadow-card outline-none focus:border-brand"
        />
      ) : (
        trip.summary && (
          <p className="whitespace-pre-wrap rounded-card border border-line bg-surface px-3 py-2.5 text-sm leading-relaxed text-ink shadow-card">
            {trip.summary}
          </p>
        )
      )}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Budget                                                                     */
/* -------------------------------------------------------------------------- */

export function Budget() {
  const trip = useTrip()
  const actions = useActions()
  const { edit } = useCan()
  const { t, locale } = useI18n()
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<Category>('other')

  const entries = CATEGORIES.map((c) => [c, trip.budget.byCategory[c] ?? 0] as const).filter(
    ([, v]) => v > 0,
  )
  const max = Math.max(1, ...entries.map(([, v]) => v))

  function submit() {
    const value = Number(amount)
    if (!title.trim() || !Number.isFinite(value) || value <= 0) return
    actions.addExpense(title.trim(), value, category)
    setTitle('')
    setAmount('')
  }

  return (
    <section id="budget">
      <SectionHeading
        action={
          <span className="text-sm font-semibold tabular-nums text-ink">
            {formatMoney(trip.budget.total, trip.currency, locale)}
          </span>
        }
      >
        {t('nav.budget')}
      </SectionHeading>

      <div className="rounded-card border border-line bg-surface p-4 shadow-card">
        {entries.length === 0 ? (
          <EmptyNote>{t('budget.empty')}</EmptyNote>
        ) : (
          <ul className="space-y-2">
            {entries.map(([cat, value]) => (
              <li key={cat} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-xs text-ink-soft">
                  {t(`cat.${cat}` as StringKey)}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-sunken">
                  <span
                    className="block h-full rounded-full bg-brand transition-[width] duration-300"
                    style={{ width: `${(value / max) * 100}%` }}
                  />
                </span>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-ink-soft">
                  {formatMoney(value, trip.currency, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {trip.expenses.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-line pt-3">
            {trip.expenses.map((e) => (
              <li key={e.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-ink">{e.title}</span>
                <span className="tabular-nums text-ink-soft">
                  {formatMoney(e.amount, trip.currency, locale)}
                </span>
                {edit && (
                  <Button variant="danger" onClick={() => actions.removeExpense(e.id)}>
                    ×
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {edit && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder={t('budget.title')}
              className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand"
            />
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              type="number"
              min={0}
              placeholder={t('budget.amount')}
              className="w-28 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm tabular-nums outline-none focus:border-brand"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm outline-none focus:border-brand"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`cat.${c}` as StringKey)}
                </option>
              ))}
            </select>
            <Button variant="primary" onClick={submit}>
              + {t('budget.add')}
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Reservations                                                               */
/* -------------------------------------------------------------------------- */

const RES_KINDS: ReservationKind[] = ['flight', 'lodging', 'rail', 'car', 'other']

export function Reservations() {
  const trip = useTrip()
  const actions = useActions()
  const { edit } = useCan()
  const { t, locale } = useI18n()

  return (
    <section id="reservations">
      <SectionHeading
        action={
          edit ? (
            <div className="flex gap-1">
              {RES_KINDS.map((k) => (
                <Button
                  key={k}
                  variant="quiet"
                  onClick={() => actions.addReservation(k, t(`res.${k}` as StringKey))}
                >
                  + {t(`res.${k}` as StringKey)}
                </Button>
              ))}
            </div>
          ) : undefined
        }
      >
        {t('nav.reservations')}
      </SectionHeading>

      {trip.reservations.length === 0 ? (
        <EmptyNote>{t('res.empty')}</EmptyNote>
      ) : (
        <ul className="space-y-2">
          {trip.reservations.map((r) => (
            <li
              key={r.id}
              className="rounded-card border border-line bg-surface p-3 shadow-card"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                    {t(`res.${r.kind}` as StringKey)}
                  </span>
                  {edit ? (
                    <input
                      value={r.title}
                      onChange={(e) => actions.patchReservation(r.id, { title: e.target.value })}
                      className="mt-1.5 w-full rounded bg-transparent text-sm font-semibold text-ink outline-none focus:bg-sunken"
                    />
                  ) : (
                    <p className="mt-1.5 text-sm font-semibold text-ink">{r.title}</p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-faint">
                    {r.confirmation && (
                      <span>
                        {t('res.confirmation')} <span className="tabular-nums">{r.confirmation}</span>
                      </span>
                    )}
                    {r.start && <span className="tabular-nums">{r.start.replace('T', ' ')}</span>}
                    {r.from && r.to && (
                      <span>
                        {r.from} → {r.to}
                      </span>
                    )}
                  </div>
                  {r.notes && <p className="mt-1.5 text-xs text-ink-soft">{r.notes}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.cost !== undefined && r.cost > 0 && (
                    <span className="text-sm tabular-nums text-ink-soft">
                      {formatMoney(r.cost, trip.currency, locale)}
                    </span>
                  )}
                  {edit && (
                    <Button variant="danger" onClick={() => actions.removeReservation(r.id)}>
                      ×
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Checklists                                                                 */
/* -------------------------------------------------------------------------- */

export function Checklists() {
  const trip = useTrip()
  const actions = useActions()
  const { edit } = useCan()
  const { t } = useI18n()

  return (
    <section id="checklists">
      <SectionHeading
        action={
          edit ? (
            <Button variant="ghost" onClick={() => actions.addChecklist(t('check.add'))}>
              + {t('check.add')}
            </Button>
          ) : undefined
        }
      >
        {t('nav.checklists')}
      </SectionHeading>

      {trip.checklists.length === 0 ? (
        <EmptyNote>{t('check.empty')}</EmptyNote>
      ) : (
        <div className="space-y-3">
          {trip.checklists.map((list) => {
            const done = list.items.filter((i) => i.done).length
            return (
              <div key={list.id} className="rounded-card border border-line bg-surface p-4 shadow-card">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">{list.title}</h3>
                  <span className="text-[11px] tabular-nums text-ink-faint">
                    {done}/{list.items.length} {t('check.done')}
                  </span>
                </div>
                <ul className="space-y-1">
                  {list.items.map((item) => (
                    <li key={item.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={item.done}
                        disabled={!edit}
                        onChange={(e) =>
                          actions.toggleChecklistItem(list.id, item.id, e.target.checked)
                        }
                        className="h-4 w-4 shrink-0 accent-[oklch(58%_0.16_235)]"
                      />
                      <span
                        className={
                          'min-w-0 flex-1 text-sm ' +
                          (item.done ? 'text-ink-faint line-through' : 'text-ink')
                        }
                      >
                        {item.text}
                      </span>
                      {edit && (
                        <Button
                          variant="danger"
                          onClick={() => actions.removeChecklistItem(list.id, item.id)}
                        >
                          ×
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {edit && <AddItem onAdd={(text) => actions.addChecklistItem(list.id, text)} />}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function AddItem({ onAdd }: { onAdd: (text: string) => void }) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || !text.trim()) return
        onAdd(text.trim())
        setText('')
      }}
      placeholder={t('check.addItem')}
      className="mt-2 w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand"
    />
  )
}
