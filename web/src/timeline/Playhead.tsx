import { usePlayhead } from '../store/playheadStore.js'
import { msToPx, pxToMs, type Scale } from './scale.js'

export function Playhead({ scale }: { scale: Scale }) {
  const ms = usePlayhead(state => state.ms)
  const setMs = usePlayhead(state => state.setMs)
  const left = msToPx(scale, ms)

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const track = event.currentTarget.parentElement
    if (!track) return
    event.preventDefault()
    event.stopPropagation()
    const bounds = track.getBoundingClientRect()
    const target = event.currentTarget

    const move = (moveEvent: PointerEvent) =>
      setMs(pxToMs(scale, moveEvent.clientX - bounds.left), scale.durationMs)

    const finish = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', finish)
      target.removeEventListener('pointercancel', finish)
      try {
        target.releasePointerCapture(event.pointerId)
      } catch {
        // Przechwycenie mogło już zostać zwolnione przez przeglądarkę.
      }
    }

    target.setPointerCapture(event.pointerId)
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', finish)
    target.addEventListener('pointercancel', finish)
  }

  return (
    <>
      {/*
        Linia jest czysto wizualna (pointer-events-none). Gdyby przyjmowała
        zdarzenia na całej wysokości, zasłaniałaby uchwyty granic ujęć leżące
        w tym samym miejscu co playhead — a tuż po rozcięciu leżą dokładnie
        tam, bo cięcie powstaje w pozycji playheada. Przeciąganie żyje
        wyłącznie w małym uchwycie u góry, tak jak w edytorach wideo.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-amber-400"
        style={{ left }}
      />
      {/*
        Uchwyt jest szczerze prezentacyjny: `role="presentation"` bez
        `aria-label`, bo `aria-label` na elemencie prezentacyjnym jest
        niedozwolone i przeglądarka rozstrzyga ten konflikt zdejmując rolę —
        element nie był wtedy ani prezentacyjny, ani kontrolką (nie miał też
        `tabIndex`). Rozstrzygnięcie długu z zadania 7: dostępną kontrolką tej
        wartości jest linijka czasu, która ma rolę `slider` i własną nazwę,
        a przewijanie z klawiatury działa globalnie strzałkami, Home i End.
        Uchwyt tylko dubluje myszą funkcję już osiągalną — nie potrzebuje
        więc własnej nazwy dostępności i nie powinien jej udawać.
      */}
      <div
        role="presentation"
        onPointerDown={startDrag}
        className="absolute top-0 z-30 h-2 w-2 -translate-x-1 cursor-col-resize rounded-sm bg-amber-400"
        style={{ left }}
      />
    </>
  )
}
