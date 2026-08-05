import { pxToMs, type Scale } from './scale.js'
import { clipTargetMs, type ClipGrip, type TimeClip } from './clips.js'

/**
 * Licznik gestów w zakresie modułu, nie w `useRef`. Referencja komponentu
 * zeruje się po przemontowaniu, a klucz sklejania historii żyje w store, który
 * go nie czyści — dwa osobne przeciągnięcia dostawały wtedy ten sam klucz
 * koalescencji i wpadały do jednego wpisu cofania. Tożsamość gestu musi być
 * unikalna w skali procesu, a nie komponentu.
 */
let gestureCounter = 0

export interface DragClipOptions {
  read: (clipId: string) => TimeClip | undefined
  bounds: (clipId: string) => { lowestMs: number; highestMs: number }
  snapPoints: (clipId: string) => number[]
  write: (clipId: string, next: { startMs: number; endMs: number }, coalesceKey: string) => void
  toleranceMs?: number
}

export function useDragClip(scale: Scale, options: DragClipOptions) {
  return (clipId: string, grip: ClipGrip, event: React.PointerEvent<HTMLElement>) => {
    const clip = options.read(clipId)
    /**
     * Uchwyt bywa zagnieżdżony głębiej niż jeden poziom pod korzeniem
     * ściezki — np. wewnątrz własnego kontenera klipu, tak jak w torach
     * kamery czy dialogu, gdzie jeden klip mieści trzy uchwyty (przesunięcie,
     * początek, koniec). `parentElement` trafiłby wtedy w kontener klipu, a
     * nie w ściezkę, i cała geometria gestu liczyłaby się od złej krawędzi —
     * każde przeciągnięcie byłoby przesunięte o tyle, ile kontener klipu stoi
     * od lewej krawędzi ściezki. Zamiast zgadywać głębokość zagnieżdżenia,
     * wymagamy jawnego `data-track` na korzeniu ściezki: brak atrybutu to
     * błąd konfiguracji komponentu, a cichy zły wynik byłby gorszy niż gest,
     * który się nie zaczyna.
     */
    const track = event.currentTarget.closest('[data-track]')
    if (!track) {
      // Nie tylko cichy powrót: sześć kolejnych torów (kamera, dialog, SFX…)
      // dopiero powstanie na tym hooku, a „przeciąganie nic nie robi" jest
      // drogie do zdiagnozowania z samego zrzutu ekranu. Zachowanie zostaje
      // no-opem — ostrzeżenie tylko zostawia ślad w konsoli.
      console.warn(
        `useDragClip: brak elementu z atrybutem "data-track" wśród przodków uchwytu (klip ${clipId}) — gest się nie zaczyna.`,
      )
      return
    }
    if (!clip) return

    event.preventDefault()
    event.stopPropagation()
    gestureCounter += 1
    const coalesceKey = `clip:${clipId}:${gestureCounter}`
    const bounds = track.getBoundingClientRect()
    const target = event.currentTarget
    // Odległość od początku klipu do punktu chwycenia — stała cecha gestu, nie
    // stanu klipu. Liczona raz przy `pointerdown`: gdyby przeliczać ją na
    // bieżąco z aktualnej pozycji klipu w `move`, punkt pod kursorem
    // przeskakiwałby przy każdej klatce, bo sam klip w międzyczasie już się
    // przesunął o wynik poprzedniej klatki — offset i pozycja goniłyby się
    // nawzajem zamiast trzymać stały uchwyt. To co musi być świeże w `move`
    // to długość i granice klipu (mogą zmienić się z zewnątrz), nie miejsce,
    // w które użytkownik złapał.
    const grabOffsetMs = Math.max(0, pxToMs(scale, event.clientX - bounds.left) - clip.startMs)

    const move = (moveEvent: PointerEvent) => {
      const current = options.read(clipId)
      if (!current) return
      const next = clipTargetMs({
        grip,
        clip: current,
        desiredMs: pxToMs(scale, moveEvent.clientX - bounds.left),
        grabOffsetMs,
        snapPoints: options.snapPoints(clipId),
        toleranceMs: options.toleranceMs ?? 0,
        ...options.bounds(clipId),
      })
      options.write(clipId, next, coalesceKey)
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
