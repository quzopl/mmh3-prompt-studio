import { useRef } from 'react'
import { MS_PER_FRAME, snapToFrame } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { pxToMs, snapMs, type Scale } from './scale.js'
import { shotSpans } from './spans.js'

/** Dwie klatki. Krócej i po przyciągnięciu do klatki cięcia przestałyby rosnąć. */
export const MIN_SHOT_MS = Math.round(2 * MS_PER_FRAME)

export interface BoundaryArgs {
  desiredMs: number
  previousMs: number
  nextMs: number
  snapPoints: number[]
  toleranceMs: number
}

/**
 * Docelowy czas cięcia: najpierw przyciąganie do punktów, potem do klatki,
 * na końcu ograniczenia sąsiadów. Kolejność ma znaczenie — ograniczenie
 * postawione na końcu nie da się obejść żadnym przyciąganiem.
 */
export function boundaryTargetMs(args: BoundaryArgs): number {
  const snapped = snapToFrame(snapMs(args.desiredMs, args.snapPoints, args.toleranceMs))
  const lowest = args.previousMs + MIN_SHOT_MS
  const highest = args.nextMs - MIN_SHOT_MS
  return Math.min(Math.max(snapped, lowest), highest)
}

export function useDragBoundary(scale: Scale) {
  const gesture = useRef(0)

  return (shotId: string, event: React.PointerEvent<HTMLElement>) => {
    const project = useProject.getState().project
    if (!project) return
    const track = event.currentTarget.parentElement
    if (!track) return

    event.preventDefault()
    event.stopPropagation()
    gesture.current += 1
    const coalesceKey = `shot-boundary:${shotId}:${gesture.current}`
    const bounds = track.getBoundingClientRect()
    const target = event.currentTarget

    const move = (moveEvent: PointerEvent) => {
      const current = useProject.getState().project
      if (!current) return
      const spans = shotSpans(current.shots, current.video.durationMs)
      const position = spans.findIndex(span => span.shot.id === shotId)
      if (position <= 0) return

      const desiredMs = pxToMs(scale, moveEvent.clientX - bounds.left)
      const snapPoints = [
        0,
        current.video.durationMs,
        ...spans.filter(span => span.shot.id !== shotId).map(span => span.startMs),
      ]
      const startMs = boundaryTargetMs({
        desiredMs,
        previousMs: spans[position - 1]!.startMs,
        nextMs: spans[position + 1]?.startMs ?? current.video.durationMs,
        snapPoints,
        toleranceMs: MIN_SHOT_MS,
      })

      useProject.getState().apply(
        candidate => ({
          ...candidate,
          shots: candidate.shots.map(shot => shot.id === shotId ? { ...shot, startMs } : shot),
        }),
        { coalesceKey },
      )
    }

    const finish = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', finish)
      target.removeEventListener('pointercancel', finish)
      try {
        target.releasePointerCapture(event.pointerId)
      } catch {
        // Przeglądarka mogła już zwolnić przechwycenie — to nie jest błąd.
      }
    }

    target.setPointerCapture(event.pointerId)
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', finish)
    target.addEventListener('pointercancel', finish)
  }
}
