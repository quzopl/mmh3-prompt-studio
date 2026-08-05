import { useProject } from '../store/projectStore.js'
import { same, useSelection } from '../store/selectionStore.js'
import { useT } from '../i18n/useT.js'
import { msToPx, type Scale } from './scale.js'
import { clipBox } from './clips.js'
import { useDragClip } from './useDragClip.js'
import { shotSpans } from './spans.js'

/**
 * Ruch kamery należy do ujęcia i reguła `CAM_IN_SHOT_BOUNDS` wymaga, żeby się
 * w nim mieścił. Ograniczenia gestu biorą się więc z rozpiętości ujęcia, a nie
 * z całego materiału — inaczej interfejs pozwalałby wyprodukować stan, który
 * walidator zaraz odrzuci.
 *
 * Dwa ruchy w tym samym ujęciu mogą się nachodzić — model tego nie zabrania i
 * żadna reguła walidatora nie wymaga rozłączności ruchów kamery, więc gest
 * celowo tego nie pilnuje. Dokładanie tu ograniczenia, którego nie ma w
 * modelu, byłoby zgadywaniem wymagania.
 */
export function CameraTrack({ scale }: { scale: Scale }) {
  const t = useT()
  const project = useProject(state => state.project)
  const selected = useSelection(state => state.selected)
  const select = useSelection(state => state.select)

  const spans = project ? shotSpans(project.shots, project.video.durationMs) : []

  const findMove = (moveId: string) => {
    for (const span of spans) {
      const move = span.shot.cameraMoves.find(candidate => candidate.id === moveId)
      if (move) return { span, move }
    }
    return undefined
  }

  const startDrag = useDragClip(scale, {
    read: moveId => {
      const found = findMove(moveId)
      return found && { id: moveId, startMs: found.move.startMs, endMs: found.move.endMs }
    },
    bounds: moveId => {
      const found = findMove(moveId)
      return found
        ? { lowestMs: found.span.startMs, highestMs: found.span.endMs }
        : { lowestMs: 0, highestMs: scale.durationMs }
    },
    // Tylko granice własnego ujęcia — ruch i tak nie może opuścić `bounds`
    // powyżej, więc granice innych ujęć nigdy nie zostają w wyniku: albo
    // leżą poza `bounds` i przyciąganie do nich i tak zostanie zaraz
    // przycięte do tej samej wartości co bez przyciągania, albo pokrywają
    // się z granicą własnego ujęcia (koniec jednego to początek następnego)
    // i są tu już policzone. Zwracanie całej listy `shotSpans` kosztowałoby
    // więcej porównań w `snapMs` bez żadnej obserwowalnej różnicy w wyniku.
    snapPoints: moveId => {
      const found = findMove(moveId)
      return found ? [found.span.startMs, found.span.endMs] : []
    },
    toleranceMs: 80,
    write: (moveId, next, coalesceKey) => {
      useProject.getState().apply(
        candidate => ({
          ...candidate,
          shots: candidate.shots.map(shot => ({
            ...shot,
            cameraMoves: shot.cameraMoves.map(move =>
              move.id === moveId ? { ...move, ...next } : move),
          })),
        }),
        { coalesceKey },
      )
    },
  })

  if (!project) return null

  return (
    <div
      data-track="camera"
      aria-label={t('timeline.trackCamera')}
      className="relative h-8 border-b border-neutral-800"
      style={{ width: msToPx(scale, scale.durationMs) }}
    >
      {spans.flatMap(span => span.shot.cameraMoves.map(move => {
        const ref = { kind: 'camera' as const, id: move.id }
        const isSelected = selected.some(candidate => same(candidate, ref))
        return (
          <div
            key={move.id}
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            aria-label={t('camera.clipLabel', { type: move.type, shot: span.shot.index + 1 })}
            onClick={() => select(ref)}
            onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              // Jak w `ShotTrack`: klip obsłużył ten klawisz, więc nie może
              // polecieć dalej do globalnego skrótu na `window`, gdzie sama
              // spacja przełącza odtwarzanie.
              event.stopPropagation()
              select(ref)
            }}
            onPointerDown={event => startDrag(move.id, 'move', event)}
            className={`absolute top-1 h-6 rounded border px-1 text-left text-[10px] ${
              isSelected
                ? 'border-violet-500 bg-violet-950 text-violet-100'
                : 'border-neutral-700 bg-neutral-900 hover:border-neutral-500'
            }`}
            style={clipBox(scale, move)}
          >
            {/*
              Jak w `ShotTrack`: overflow-hidden tylko na etykiecie, nie na
              całym klipie — gdyby obcinał całą zawartość, uchwyty krawędzi
              byłyby nieklikalne na klipach przyciętych do MIN_CLIP_PX (8px).
            */}
            <span className="block h-full overflow-hidden">{move.type}</span>
            <button
              type="button"
              aria-label={t('camera.dragStart', { type: move.type })}
              onPointerDown={event => startDrag(move.id, 'start', event)}
              className="absolute inset-y-0 left-0 w-1 cursor-ew-resize bg-violet-500/40"
            />
            <button
              type="button"
              aria-label={t('camera.dragEnd', { type: move.type })}
              onPointerDown={event => startDrag(move.id, 'end', event)}
              className="absolute inset-y-0 right-0 w-1 cursor-ew-resize bg-violet-500/40"
            />
          </div>
        )
      }))}
    </div>
  )
}
