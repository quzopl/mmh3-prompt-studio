import { create } from 'zustand'
import { MS_PER_FRAME, snapToFrame } from '@mmh3/shared'

interface PlayheadState {
  ms: number
  playing: boolean
  setMs: (ms: number, durationMs: number) => void
  stepFrames: (count: number, durationMs: number) => void
  play: () => void
  pause: () => void
  toggle: () => void
  reset: () => void
}

/**
 * Playhead zawsze stoi na granicy klatki — tak samo jak czasy cięć w modelu —
 * i nigdy nie wychodzi poza materiał. Kolejność ma znaczenie: przyciąganie po
 * przycięciu potrafiłoby wypchnąć wartość z powrotem za koniec, bo długość
 * wideo rzadko wypada dokładnie na granicy klatki. Górnym ograniczeniem jest
 * więc ostatnia pełna klatka mieszcząca się w materiale.
 */
const clampToFrame = (ms: number, durationMs: number): number => {
  const lastFrameMs = Math.round(Math.floor(durationMs / MS_PER_FRAME) * MS_PER_FRAME)
  return Math.min(lastFrameMs, Math.max(0, snapToFrame(ms)))
}

export const usePlayhead = create<PlayheadState>((set, get) => ({
  ms: 0,
  playing: false,
  setMs: (ms, durationMs) => set({ ms: clampToFrame(ms, durationMs) }),
  stepFrames: (count, durationMs) =>
    set({ ms: clampToFrame(get().ms + count * MS_PER_FRAME, durationMs) }),
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  toggle: () => set({ playing: !get().playing }),
  reset: () => set({ ms: 0, playing: false }),
}))
