import { Fragment } from 'react'
import { useProject } from '../store/projectStore.js'
import { same, useSelection } from '../store/selectionStore.js'
import { useT } from '../i18n/useT.js'
import { AnchorBadges } from './AnchorBadges.js'
import { clipBox } from './clips.js'
import { msToPx, type Scale } from './scale.js'
import { shotSpans } from './spans.js'
import { useDragBoundary } from './useDragBoundary.js'

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
      {shotSpans(project.shots, project.video.durationMs).map((span, position, spans) => {
        const ref = { kind: 'shot' as const, id: span.shot.id }
        const isSelected = selected.some(candidate => same(candidate, ref))
        // `shotSpans` sortuje rosnąco po `index`, więc ostatni element tablicy —
        // nie ten z najwyższym `index` z osobna liczony — to ujęcie zamykające.
        const isLastShot = position === spans.length - 1
        return (
          <Fragment key={span.shot.id}>
            <div
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={t('timeline.clipLabel', {
                number: span.shot.index + 1, start: span.startMs, end: span.endMs,
              })}
              onClick={event => (event.shiftKey ? toggle(ref) : select(ref))}
              onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                // Klip obsłużył ten klawisz — nie może polecieć dalej do globalnego
                // `useTimelineShortcuts` na `window`, bo tam sama spacja przełącza
                // odtwarzanie. Bez tego aktywacja klipu klawiaturą uruchamiałaby
                // playback jako efekt uboczny.
                event.stopPropagation()
                select(ref)
              }}
              className={`absolute top-1 h-8 rounded border px-2 text-left text-xs ${
                isSelected
                  ? 'border-sky-600 bg-sky-950 text-sky-100'
                  : 'border-neutral-700 bg-neutral-900 hover:border-neutral-500'
              }`}
              style={clipBox(scale, { id: span.shot.id, startMs: span.startMs, endMs: span.endMs })}
            >
              {/*
                Etykieta ujęcia ma własny overflow-hidden, a nie cały klip —
                gdyby obcinał całą zawartość, odznaki kotwic byłyby nieklikalne
                na klipach przyciętych do MIN_CLIP_PX (8px). `position: absolute`
                na tym elemencie już samo w sobie tworzy kontekst pozycjonowania
                dla dzieci — nie trzeba dokładać `relative`.
              */}
              <span className="block h-full overflow-hidden">
                <span className="font-mono">{span.shot.index + 1}</span>
                {span.shot.composition && (
                  <span className="ml-2 text-neutral-400">{span.shot.composition}</span>
                )}
              </span>
              <AnchorBadges
                shotId={span.shot.id}
                anchors={span.shot.anchors}
                shotNumber={span.shot.index + 1}
                isLastShot={isLastShot}
              />
            </div>
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
