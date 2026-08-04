import { Fragment } from 'react'
import { useProject } from '../store/projectStore.js'
import { same, useSelection } from '../store/selectionStore.js'
import { useT } from '../i18n/useT.js'
import { msToPx, type Scale } from './scale.js'
import { shotSpans, type ShotSpan } from './spans.js'
import { useDragBoundary } from './useDragBoundary.js'

/** Najwęższy klip, jaki da się jeszcze chwycić myszą. */
const MIN_CLIP_PX = 8

/**
 * Prostokąt klipu przycięty do widocznego obszaru. Ujęcie z czasem cięcia poza
 * długością wideo jest błędem, który walidator zgłasza — ale narysowane poza
 * ekranem byłoby nie do chwycenia, więc jedyny klip, który trzeba naprawić,
 * byłby jedynym nieosiągalnym. Przypinamy je do krawędzi zamiast gubić.
 */
export function clipBox(scale: Scale, span: ShotSpan): { left: number; width: number } {
  const left = Math.min(msToPx(scale, span.startMs), msToPx(scale, scale.durationMs) - MIN_CLIP_PX)
  const right = Math.min(msToPx(scale, span.endMs), msToPx(scale, scale.durationMs))
  return { left: Math.max(0, left), width: Math.max(MIN_CLIP_PX, right - left) }
}

export function ShotTrack({ scale }: { scale: Scale }) {
  const t = useT()
  const project = useProject(state => state.project)
  // `state.selected` (nie `state.isSelected`) — funkcja gettera ma stałą
  // referencję między wywołaniami `set`, więc subskrypcja na niej nigdy nie
  // wykryłaby zmiany zaznaczenia i klip nie przemalowałby się po kliknięciu.
  const selected = useSelection(state => state.selected)
  const select = useSelection(state => state.select)
  const toggle = useSelection(state => state.toggle)
  const startDrag = useDragBoundary(scale)

  if (!project) return null

  return (
    <div
      aria-label={t('timeline.trackShots')}
      className="relative h-10 border-b border-neutral-800"
      style={{ width: msToPx(scale, scale.durationMs) }}
    >
      {shotSpans(project.shots, project.video.durationMs).map(span => {
        const ref = { kind: 'shot' as const, id: span.shot.id }
        const isSelected = selected.some(candidate => same(candidate, ref))
        return (
          <Fragment key={span.shot.id}>
            <button
              type="button"
              aria-pressed={isSelected}
              aria-label={t('timeline.clipLabel', {
                number: span.shot.index + 1, start: span.startMs, end: span.endMs,
              })}
              onClick={event => (event.shiftKey ? toggle(ref) : select(ref))}
              className={`absolute top-1 h-8 overflow-hidden rounded border px-2 text-left text-xs ${
                isSelected
                  ? 'border-sky-600 bg-sky-950 text-sky-100'
                  : 'border-neutral-700 bg-neutral-900 hover:border-neutral-500'
              }`}
              style={clipBox(scale, span)}
            >
              <span className="font-mono">{span.shot.index + 1}</span>
              {span.shot.composition && (
                <span className="ml-2 text-neutral-400">{span.shot.composition}</span>
              )}
            </button>
            {span.shot.index > 0 && (
              <div
                role="separator"
                aria-label={t('timeline.boundaryHandle', { number: span.shot.index + 1 })}
                onPointerDown={event => startDrag(span.shot.id, event)}
                className="absolute top-0 z-10 h-10 w-2 -translate-x-1 cursor-col-resize bg-transparent hover:bg-sky-600/40"
                style={{ left: msToPx(scale, span.startMs) }}
              />
            )}
          </Fragment>
        )
      })}
    </div>
  )
}
