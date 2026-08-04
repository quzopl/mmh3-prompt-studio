import { useEffect, useRef } from 'react'
import { usePlayhead } from '../store/playheadStore.js'

/**
 * Jeden krok odtwarzania. Wydzielony z pętli, żeby dało się go przetestować
 * bez zegarów i bez klatek animacji.
 */
export function advancePlayback(
  currentMs: number,
  elapsedMs: number,
  durationMs: number,
): { ms: number; playing: boolean } {
  const next = currentMs + Math.max(0, elapsedMs)
  if (next >= durationMs) return { ms: durationMs, playing: false }
  return { ms: next, playing: true }
}

export function usePlayback(durationMs: number): void {
  const playing = usePlayhead(state => state.playing)
  const lastFrame = useRef<number | null>(null)
  /**
   * Pozycja w pełnej precyzji, niezależna od zaokrąglenia do siatki klatek
   * w magazynie. Prawdziwy vsync tyka co ok. 16,7 ms — mniej niż pół klatki
   * materiału (20,8 ms przy 24 FPS) — więc liczenie kolejnego kroku od
   * `usePlayhead.getState().ms` (już zaokrąglonego) zaokrąglałoby wynik z
   * powrotem do tej samej klatki w nieskończoność: playhead zamarzałby na
   * starcie. Akumulator jest prawdą podczas odtwarzania; magazyn jest tylko
   * jego (zaokrągloną) prezentacją.
   */
  const positionMs = useRef<number | null>(null)
  /**
   * Ostatnia wartość, którą ten hook sam zapisał do magazynu — do wykrycia,
   * że coś spoza pętli przewinęło playhead w trakcie odtwarzania (np. klik
   * w linijkę czasu albo skrót klawiszowy). Bez tego kolejna klatka
   * nadpisałaby przewinięcie starą, zakumulowaną pozycją sprzed niego.
   */
  const lastWrittenMs = useRef<number | null>(null)

  useEffect(() => {
    // Resetowane przy każdym uruchomieniu efektu, nie tylko przy zatrzymaniu —
    // inaczej zmiana `durationMs` w trakcie odtwarzania zostawiłaby znacznik
    // czasu i akumulator sprzed zmiany, a pierwsza klatka po niej policzyłaby
    // odcinek przez granicę zmiany zamiast zacząć od nowa.
    lastFrame.current = null
    positionMs.current = null
    lastWrittenMs.current = null
    if (!playing) return

    let handle = 0
    const tick = (now: number) => {
      const state = usePlayhead.getState()

      // Brak akumulatora (pierwsza klatka) albo magazyn zmienił się spoza
      // tej pętli (przewinięcie) — zaczynamy liczyć od aktualnej pozycji
      // w magazynie, nie od starej, zakumulowanej wartości.
      if (positionMs.current === null || state.ms !== lastWrittenMs.current) {
        positionMs.current = state.ms
        lastWrittenMs.current = state.ms
      }

      const previous = lastFrame.current
      lastFrame.current = now
      if (previous !== null && positionMs.current !== null) {
        const step = advancePlayback(positionMs.current, now - previous, durationMs)
        positionMs.current = step.ms
        state.setMs(step.ms, durationMs)
        lastWrittenMs.current = usePlayhead.getState().ms
        if (!step.playing) {
          state.pause()
          return
        }
      }
      handle = requestAnimationFrame(tick)
    }

    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [playing, durationMs])
}
