import { useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useI18n } from '../app/i18n'
import { useActions, useCan, useFocusReporter, useWhosHere } from '../core/store'
import { heroPhoto, type Place, type PlaceId } from '../core/types'
import { Button, CategoryChip, CoverArt, Rating, formatMoney } from './primitives'

/**
 * A place, in picture mode.
 *
 * The card is the unit collaborators actually manipulate, so it carries the
 * live outline when someone else has it focused and it is the drag handle for
 * the whole itinerary.
 */

/** Wanderlog's two card layouts: a dense row, or a photo-led tile. */
export type CardView = 'list' | 'picture'

export function PlaceCard({
  place,
  index,
  currency,
  onHover,
  view = 'list',
}: {
  place: Place
  index?: number
  currency: string
  onHover?: (id: PlaceId | null) => void
  view?: CardView
}) {
  const { t, locale } = useI18n()
  const actions = useActions()
  const { edit } = useCan()
  const { others } = useWhosHere()
  const reportFocus = useFocusReporter()
  const [open, setOpen] = useState(false)

  const busy = others.find((o) => o.editing === place.id)
  const photo = heroPhoto(place)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: place.id,
    disabled: !edit,
    data: { type: 'place', place },
  })

  // Numbered cards drag by their badge. Wishlist cards have no badge, so the
  // whole card is the handle — without this they could not be dragged into a
  // day at all, which is the single most important gesture in the app.
  const cardHandle = index === undefined && edit ? { ...attributes, ...listeners } : {}

  return (
    <article
      ref={setNodeRef}
      {...cardHandle}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        ...(busy ? { boxShadow: `0 0 0 2px ${busy.color}` } : {}),
      }}
      data-dragging={isDragging}
      className={
        'group relative rounded-card border border-line bg-surface shadow-card ' +
        'transition-shadow duration-150 hover:shadow-lift ' +
        'data-[dragging=true]:z-10 data-[dragging=true]:opacity-90 data-[dragging=true]:shadow-lift'
      }
      onMouseEnter={() => onHover?.(place.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      {view === 'picture' && (
        <div className="relative h-36 overflow-hidden rounded-t-card">
          {photo ? (
            <img src={photo.url} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <CoverArt seed={place.name} category={place.category} className="h-full w-full" />
          )}
          {index !== undefined && (
            <div
              {...attributes}
              {...listeners}
              className={
                'absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-full ' +
                'bg-white/95 text-xs font-semibold text-ink shadow-sm backdrop-blur ' +
                (edit ? 'cursor-grab active:cursor-grabbing' : '')
              }
            >
              {index}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3 p-3">
        {index !== undefined && view === 'list' && (
          <div
            {...attributes}
            {...listeners}
            className={
              'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand ' +
              'text-xs font-semibold text-white ' +
              (edit ? 'cursor-grab active:cursor-grabbing' : '')
            }
            title={edit ? 'Drag to reorder' : undefined}
          >
            {index}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3
              className="truncate text-[15px] font-semibold leading-tight text-ink"
              title={place.name}
            >
              {place.name}
            </h3>
            {edit && (
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <Button variant="quiet" onClick={() => setOpen((v) => !v)} title={t('place.notes')}>
                  <PencilIcon />
                </Button>
                <Button
                  variant="danger"
                  onClick={() => actions.removePlace(place.id)}
                  title={t('place.remove')}
                >
                  <TrashIcon />
                </Button>
              </div>
            )}
          </div>

          <p className="mt-0.5 truncate text-xs text-ink-faint" title={place.address}>
            {place.address}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <CategoryChip category={place.category} />
            <Rating value={place.rating} count={place.ratingCount} />
            {place.startTime && (
              <span className="text-[11px] font-medium text-ink-soft tabular-nums">
                {place.startTime}
              </span>
            )}
            {place.cost !== undefined && place.cost > 0 && (
              <span className="text-[11px] font-medium text-ink-soft tabular-nums">
                {formatMoney(place.cost, currency, locale)}
              </span>
            )}
          </div>

          {place.notes && !open && (
            <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-ink-soft">
              {place.notes}
            </p>
          )}
        </div>

        {view === 'list' && (
          <div className="h-[72px] w-[96px] shrink-0 overflow-hidden rounded-lg">
            {photo ? (
              <img
                src={photo.url}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <CoverArt seed={place.name} category={place.category} className="h-full w-full" />
            )}
          </div>
        )}
      </div>

      {busy && (
        <span
          className="absolute -top-2 right-3 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
          style={{ background: busy.color }}
        >
          {busy.name}
        </span>
      )}

      {open && edit && (
        <NoteEditor
          place={place}
          currency={currency}
          onFocus={() => reportFocus(place.id)}
          onBlur={() => reportFocus(null)}
          onClose={() => setOpen(false)}
        />
      )}
    </article>
  )
}

function NoteEditor({
  place,
  currency,
  onFocus,
  onBlur,
  onClose,
}: {
  place: Place
  currency: string
  onFocus: () => void
  onBlur: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const actions = useActions()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState(place.notes)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  // Remote edits should appear while typing, but not while this field has the
  // caret — overwriting the user's own in-progress text is worse than being a
  // moment behind.
  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(place.notes)
  }, [place.notes])

  return (
    <div className="border-t border-line px-3 pb-3 pt-2">
      <textarea
        ref={ref}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          actions.setNotes(place.id, e.target.value)
        }}
        onFocus={onFocus}
        onBlur={onBlur}
        rows={3}
        placeholder={t('place.notesPlaceholder')}
        className="w-full resize-y rounded-lg border border-line bg-canvas px-2.5 py-2 text-xs leading-relaxed text-ink outline-none focus:border-brand"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-[11px] text-ink-soft">
          {t('place.startTime')}
          <input
            type="time"
            value={place.startTime ?? ''}
            onChange={(e) => actions.patchPlace(place.id, { startTime: e.target.value })}
            className="rounded border border-line bg-canvas px-1.5 py-0.5 text-[11px] tabular-nums"
          />
        </label>
        <label className="flex items-center gap-1 text-[11px] text-ink-soft">
          {t('place.cost')} ({currency})
          <input
            type="number"
            min={0}
            value={place.cost ?? ''}
            onChange={(e) =>
              actions.patchPlace(place.id, {
                cost: e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
            className="w-20 rounded border border-line bg-canvas px-1.5 py-0.5 text-[11px] tabular-nums"
          />
        </label>
        <label className="flex items-center gap-1 text-[11px] text-ink-soft">
          {t('place.duration')}
          <input
            type="number"
            min={0}
            step={15}
            value={place.durationMin ?? ''}
            onChange={(e) =>
              actions.patchPlace(place.id, {
                durationMin: e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
            className="w-16 rounded border border-line bg-canvas px-1.5 py-0.5 text-[11px] tabular-nums"
          />
          {t('place.minutes')}
        </label>
        <Button variant="quiet" onClick={onClose} className="ml-auto">
          {t('action.done')}
        </Button>
      </div>
    </div>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden>
      <path d="M13.6 2.9a1.6 1.6 0 012.3 0l1.2 1.2a1.6 1.6 0 010 2.3l-8.6 8.6-3.9.9.9-3.9 8.1-9.1zM3 17h14v1.5H3z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden>
      <path d="M7.5 2h5l.6 1.5H17V5H3V3.5h3.9L7.5 2zM4.5 6.5h11l-.8 10.2a1.5 1.5 0 01-1.5 1.3H6.8a1.5 1.5 0 01-1.5-1.3L4.5 6.5z" />
    </svg>
  )
}
