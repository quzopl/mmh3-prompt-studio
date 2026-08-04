import { MS_PER_FRAME, snapToFrame } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { pxToMs, snapMs, type Scale } from './scale.js'
import { shotSpans } from './spans.js'

/**
 * Indeks klatki najbliższej danemu czasowi i odwrotność — te same wzory co
 * `snapToFrame`, ale osobno, żeby dało się dodawać/odejmować klatki jako
 * liczby całkowite. `previousMs + MIN_SHOT_MS` wygląda kusząco prosto, ale
 * MIN_SHOT_MS to zaokrąglone dwie klatki (83 ms, nie dokładne 83,333…), więc
 * dodanie go do czasu sąsiada zdejmuje wynik z siatki klatek za każdym razem,
 * gdy ten sąsiad sam nie leży w klatce zero. Licząc na indeksach klatek,
 * ograniczenie zawsze wypada dokładnie na granicy klatki.
 */
const frameIndexOf = (ms: number): number => Math.round(ms / MS_PER_FRAME)
const msOfFrameIndex = (frame: number): number => Math.round(frame * MS_PER_FRAME)

/** Najkrótsze dopuszczalne ujęcie w klatkach. Krócej i po przyciągnięciu do klatki cięcia przestałyby rosnąć. */
const MIN_SHOT_FRAMES = 2

export const MIN_SHOT_MS = msOfFrameIndex(MIN_SHOT_FRAMES)

/**
 * Tolerancja przyciągania do punktów (inne granice, początek i koniec wideo).
 * Liczbowo dziś taka sama jak `MIN_SHOT_MS`, ale to zbieżność, nie zależność
 * — jedno reguluje najkrótsze ujęcie, drugie promień przyciągania kursora, i
 * wolno je stroić osobno.
 */
export const SNAP_TOLERANCE_MS = msOfFrameIndex(MIN_SHOT_FRAMES)

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
 *
 * Ograniczenia potrafią się przeciąć: kiedy sąsiedzi stoją bliżej niż cztery
 * klatki, `highest` wypada poniżej `lowest` i trzeba rozstrzygnąć, które z nich
 * wygrywa. Wygrywa dolne — granica nigdy nie może stanąć przed swoim
 * poprzednikiem. Odwrotna kolejność (`Math.min(Math.max(...), highest)`)
 * oddawała w tej sytuacji wartość mniejszą od poprzednika, a przy poprzedniku
 * bliskim zera wręcz ujemną; `ShotSchema` odrzuca ujemny `startMs`, więc każdy
 * kolejny autozapis wracał z kodem 400 i projekt przestawał się zapisywać.
 * Przecięcie oznacza, że żaden czas nie spełnia obu warunków naraz — wtedy
 * lepiej zostawić ujęcie następne za krótkie (walidator to zgłosi) niż
 * wyprodukować model, którego schemat w ogóle nie przyjmuje.
 */
export function boundaryTargetMs(args: BoundaryArgs): number {
  const snapped = snapToFrame(snapMs(args.desiredMs, args.snapPoints, args.toleranceMs))
  const lowest = msOfFrameIndex(frameIndexOf(args.previousMs) + MIN_SHOT_FRAMES)
  const highest = msOfFrameIndex(frameIndexOf(args.nextMs) - MIN_SHOT_FRAMES)
  return Math.max(lowest, Math.min(snapped, highest))
}

/**
 * Identyfikator gestu musi być unikalny w całym procesie, nie tylko w obrębie
 * jednej instancji komponentu — stąd zmienna modułowa zamiast `useRef`. Gdyby
 * licznik żył w refie, odmontowanie i ponowne zamontowanie `ShotTrack`
 * zresetowałoby go do zera, a drugi (osobny) gest odtworzyłby ten sam klucz
 * koalescencji co pierwszy i scaliłby się z jego już zamkniętym wpisem
 * historii zamiast dołożyć nowy.
 */
let gestureCounter = 0

export function useDragBoundary(scale: Scale) {
  return (shotId: string, event: React.PointerEvent<HTMLElement>) => {
    const project = useProject.getState().project
    if (!project) return
    const track = event.currentTarget.parentElement
    if (!track) return

    event.preventDefault()
    event.stopPropagation()
    gestureCounter += 1
    const coalesceKey = `shot-boundary:${shotId}:${gestureCounter}`
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
        previousMs: spans[position - 1]?.startMs ?? 0,
        nextMs: spans[position + 1]?.startMs ?? current.video.durationMs,
        snapPoints,
        toleranceMs: SNAP_TOLERANCE_MS,
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
