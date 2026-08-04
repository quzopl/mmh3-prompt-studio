import { useEffect } from 'react'
import { FPS } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { usePlayhead } from '../store/playheadStore.js'
import { useSelection } from '../store/selectionStore.js'
import { removeShots, splitAtMs } from './shotOperations.js'

/**
 * Skrót nie może wystrzelić, gdy użytkownik pisze — inaczej „s" dzieliłoby
 * ujęcie w trakcie wpisywania opisu. `composedPath()[0]` to element, na
 * którym zdarzenie faktycznie powstało, w przeciwieństwie do `event.target`,
 * które na granicy shadow DOM bywa przekierowane na host — sama nazwa znacznika
 * i tak by tego nie złapała, ale sprawdzanie właściwego elementu jest tańsze
 * niż podwójna naprawa później.
 */
const isTyping = (event: KeyboardEvent): boolean => {
  const origin = event.composedPath()[0]
  if (!(origin instanceof HTMLElement)) return false
  if (origin.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(origin.tagName)
}

/**
 * Bez żadnego modyfikatora (poza ewentualnym Shiftem, osobno dopuszczanym
 * tam, gdzie ma znaczenie) — inaczej skrót podkradłby kombinacje przeglądarki
 * albo systemu, np. Ctrl+S (zapis strony) albo Alt+Left/Right (historia
 * przeglądarki).
 */
const isBareKey = (event: KeyboardEvent): boolean =>
  !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey

const isBareOrShiftKey = (event: KeyboardEvent): boolean =>
  !event.ctrlKey && !event.altKey && !event.metaKey

export function useTimelineShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTyping(event)) return

      const project = useProject.getState().project
      if (!project) return
      const durationMs = project.video.durationMs

      /**
       * `preventDefault`/`stopPropagation` muszą polecieć na każdym zdarzeniu
       * pasującym do skrótu — łącznie z autopowtórzeniami — zanim w ogóle
       * zapadnie decyzja, czy ten konkretny event coś wykona. Klawisz albo
       * jest nasz, albo nie; to, że akcja nie powtarza się przy trzymaniu, to
       * osobna decyzja podjęta NIŻEJ, nie wcześniej. Odwrotna kolejność (jak
       * poprzednio: `if (event.repeat) return` przed `handled()`) oddawała
       * powtórzone zdarzenie przeglądarce nietknięte — trzymana spacja
       * przewijała stronę, bo tylko pierwszy `keydown` dostawał `preventDefault`.
       */
      const handled = (): void => {
        event.preventDefault()
        event.stopPropagation()
      }

      const isArrow = event.key === 'ArrowLeft' || event.key === 'ArrowRight'

      if (event.key === ' ' && isBareKey(event)) {
        handled()
        if (event.repeat) return
        usePlayhead.getState().toggle()
        return
      }

      // Strzałki są jedynym skrótem, który ma reagować na trzymanie —
      // przewijanie klatka po klatce działa tak samo jak scrub myszą.
      if (isArrow && isBareOrShiftKey(event)) {
        handled()
        const direction = event.key === 'ArrowRight' ? 1 : -1
        const frames = event.shiftKey ? FPS : 1
        usePlayhead.getState().stepFrames(direction * frames, durationMs)
        return
      }

      if (event.key === 'Home' && isBareKey(event)) {
        handled()
        if (event.repeat) return
        usePlayhead.getState().setMs(0, durationMs)
        return
      }

      if (event.key === 'End' && isBareKey(event)) {
        handled()
        if (event.repeat) return
        usePlayhead.getState().setMs(durationMs, durationMs)
        return
      }

      if ((event.key === 's' || event.key === 'S') && isBareKey(event)) {
        handled()
        if (event.repeat) return
        useProject.getState().apply(current => splitAtMs(current, usePlayhead.getState().ms))
        return
      }

      if (event.key === 'Delete' && isBareKey(event)) {
        const ids = useSelection.getState().selected
          .filter(ref => ref.kind === 'shot')
          .map(ref => ref.id)
        if (ids.length === 0) return
        handled()
        if (event.repeat) return
        useProject.getState().apply(current => removeShots(current, ids))
        useSelection.getState().clear()
        return
      }

      if ((event.key === 'z' || event.key === 'Z') && (event.ctrlKey || event.metaKey) && !event.altKey) {
        handled()
        if (event.repeat) return
        if (event.shiftKey) useProject.getState().redo()
        else useProject.getState().undo()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
