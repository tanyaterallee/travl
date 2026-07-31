import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useI18n } from '../app/i18n'
import { useActions, useCan, useTrip } from '../core/store'
import { formatDistance, formatDuration } from '../maps/provider'
import type { Day, DayId, Leg, Place, PlaceId } from '../core/types'
import { PlaceCard, type CardView } from './PlaceCard'
import { Button, EmptyNote, SectionHeading, formatMoney } from './primitives'

const WISHLIST_CONTAINER = 'container:wishlist'
const dayContainer = (id: DayId) => `container:${id}`

/**
 * The planner board.
 *
 * One `DndContext` spans the wishlist and every day, because the drag that
 * matters most — pulling a saved place into a day — crosses containers. The
 * document models that as a single field write, so the card cannot end up in
 * both lists or neither if two people drag it at once.
 */
export function Planner({
  onHover,
  focusDay,
  view = 'picture',
}: {
  onHover?: (id: PlaceId | null) => void
  focusDay?: DayId | null
  view?: CardView
}) {
  const trip = useTrip()
  const actions = useActions()
  const { edit } = useCan()
  const { t } = useI18n()
  const [dragging, setDragging] = useState<Place | null>(null)

  const sensors = useSensors(
    // A few pixels of hysteresis so a click on a card is not read as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const containers = useMemo(() => {
    const map = new Map<string, { dayId: DayId | null; items: readonly Place[] }>()
    map.set(WISHLIST_CONTAINER, { dayId: null, items: trip.wishlist })
    for (const day of trip.days) map.set(dayContainer(day.id), { dayId: day.id, items: day.stops })
    return map
  }, [trip])

  function containerOf(id: string): string | null {
    if (containers.has(id)) return id
    for (const [key, value] of containers) {
      if (value.items.some((p) => p.id === id)) return key
    }
    return null
  }

  function onDragStart(event: DragStartEvent) {
    const place = trip.places.find((p) => p.id === event.active.id)
    setDragging(place ?? null)
  }

  function onDragEnd(event: DragEndEvent) {
    setDragging(null)
    const { active, over } = event
    if (!over) return

    const target = containerOf(String(over.id))
    if (!target) return
    const destination = containers.get(target)
    if (!destination) return

    const placeId = active.id as PlaceId
    const overId = String(over.id)

    // Dropping onto the container itself means the end of the list; dropping
    // onto a card means that card's slot.
    const index =
      overId === target
        ? destination.items.length
        : Math.max(0, destination.items.findIndex((p) => p.id === overId))

    actions.movePlace(placeId, destination.dayId, index)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="space-y-8">
        <Wishlist onHover={onHover} view={view} />

        <section id="itinerary">
          <SectionHeading
            action={
              edit ? (
                <Button variant="ghost" onClick={() => actions.addDay()}>
                  + {t('day.add')}
                </Button>
              ) : undefined
            }
          >
            {t('nav.itinerary')}
          </SectionHeading>

          <div className="space-y-6">
            {trip.days.map((day) => (
              <DayBlock
                key={day.id}
                day={day}
                onHover={onHover}
                view={view}
                highlighted={focusDay === day.id}
              />
            ))}
            {trip.days.length === 0 && <EmptyNote>{t('day.add')}</EmptyNote>}
          </div>
        </section>
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
        {dragging && (
          <div className="w-[min(28rem,80vw)] rotate-1 opacity-95">
            <PlaceCard place={dragging} currency={trip.currency} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

/* -------------------------------------------------------------------------- */

function Wishlist({ onHover, view }: { onHover?: (id: PlaceId | null) => void; view: CardView }) {
  const trip = useTrip()
  const { t } = useI18n()
  const { setNodeRef, isOver } = useDroppable({ id: WISHLIST_CONTAINER })

  return (
    <section id="places">
      <SectionHeading
        action={
          <span className="text-xs text-ink-faint">
            {trip.wishlist.length} {t('wishlist.count')}
          </span>
        }
      >
        {t('wishlist.title')}
      </SectionHeading>

      <div
        ref={setNodeRef}
        data-over={isOver}
        className="rounded-card transition-colors data-[over=true]:bg-brand-soft"
      >
        <SortableContext
          items={trip.wishlist.map((p) => p.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {trip.wishlist.map((place) => (
              <PlaceCard
                key={place.id}
                place={place}
                currency={trip.currency}
                onHover={onHover}
                view={view}
              />
            ))}
          </div>
        </SortableContext>
        {trip.wishlist.length === 0 && <EmptyNote>{t('wishlist.empty')}</EmptyNote>}
      </div>
    </section>
  )
}

function DayBlock({
  day,
  onHover,
  view,
  highlighted,
}: {
  day: Day
  onHover?: (id: PlaceId | null) => void
  view: CardView
  highlighted?: boolean
}) {
  const trip = useTrip()
  const actions = useActions()
  const { edit } = useCan()
  const { t, locale } = useI18n()
  const { setNodeRef, isOver } = useDroppable({ id: dayContainer(day.id) })

  return (
    <div
      id={`day-${day.id}`}
      data-highlighted={highlighted}
      className="scroll-mt-20 rounded-card border border-line bg-surface p-4 shadow-card transition-shadow data-[highlighted=true]:ring-2 data-[highlighted=true]:ring-brand"
    >
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-base font-semibold text-ink">
            {locale === 'zh'
              ? `${t('day.day')} ${day.number} ${t('day.dayUnit')}`
              : `${t('day.day')} ${day.number}`}
          </h3>
          {day.date && (
            <span className="text-xs text-ink-faint tabular-nums">{formatDate(day.date, locale)}</span>
          )}
          <span className="text-xs text-ink-faint">
            · {day.stops.length} {t('day.stops')}
          </span>
          {day.subtotal > 0 && (
            <span className="text-xs text-ink-faint tabular-nums">
              · {formatMoney(day.subtotal, trip.currency, locale)}
            </span>
          )}
        </div>
        {edit && (
          <Button variant="quiet" onClick={() => actions.removeDay(day.id)}>
            {t('day.remove')}
          </Button>
        )}
      </header>

      {edit && (
        <input
          value={day.title}
          onChange={(e) => actions.patchDay(day.id, { title: e.target.value })}
          placeholder={t('day.untitled')}
          className="mb-3 w-full rounded-lg bg-transparent px-1 py-0.5 text-sm text-ink-soft outline-none placeholder:text-ink-faint focus:bg-sunken"
        />
      )}
      {!edit && day.title && <p className="mb-3 text-sm text-ink-soft">{day.title}</p>}

      <div
        ref={setNodeRef}
        data-over={isOver}
        className="min-h-[3rem] rounded-lg transition-colors data-[over=true]:bg-brand-soft"
      >
        <SortableContext items={day.stops.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          <div className={view === 'picture' ? 'grid gap-2 sm:grid-cols-2' : 'space-y-1'}>
            {day.stops.map((place, i) => (
              <div key={place.id}>
                <PlaceCard
                  place={place}
                  index={i + 1}
                  currency={trip.currency}
                  onHover={onHover}
                  view={view}
                />
                {view === 'list' && day.legs[i] && <LegRow leg={day.legs[i]} />}
              </div>
            ))}
          </div>
        </SortableContext>
        {day.stops.length === 0 && (
          <p className="px-3 py-5 text-center text-xs text-ink-faint">{t('day.empty')}</p>
        )}
      </div>
    </div>
  )
}

function LegRow({ leg }: { leg: Leg }) {
  const { t, locale } = useI18n()
  return (
    <div className="flex items-center gap-2 py-1.5 pl-3 text-[11px] text-ink-faint">
      <span className="ml-[11px] h-4 w-px bg-line" aria-hidden />
      <CarIcon />
      {leg.pending ? (
        <span className="italic">{t('leg.pending')}</span>
      ) : (
        <span className="tabular-nums">
          {formatDuration(leg.durationSec ?? 0, locale)}
          {leg.distanceM !== null && <> · {formatDistance(leg.distanceM, locale)}</>}
        </span>
      )}
    </div>
  )
}

function CarIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3 w-3 fill-current" aria-hidden>
      <path d="M5 11l1.2-3.4A2 2 0 018.1 6h3.8a2 2 0 011.9 1.6L15 11h.5a1 1 0 011 1v2a1 1 0 01-1 1H15v.5a1 1 0 01-2 0V15H7v.5a1 1 0 11-2 0V15h-.5a1 1 0 01-1-1v-2a1 1 0 011-1H5zm1.6-1h6.8l-.8-2.3a.5.5 0 00-.5-.4H7.9a.5.5 0 00-.5.4L6.6 10zM6.5 12a.9.9 0 100 1.8.9.9 0 000-1.8zm7 0a.9.9 0 100 1.8.9.9 0 000-1.8z" />
    </svg>
  )
}

function formatDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
      month: 'short',
      day: 'numeric',
      weekday: 'short',
    }).format(new Date(`${iso}T00:00:00`))
  } catch {
    return iso
  }
}
