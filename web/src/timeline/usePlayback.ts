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

  useEffect(() => {
    if (!playing) {
      lastFrame.current = null
      return
    }

    let handle = 0
    const tick = (now: number) => {
      const previous = lastFrame.current
      lastFrame.current = now
      if (previous !== null) {
        const state = usePlayhead.getState()
        const step = advancePlayback(state.ms, now - previous, durationMs)
        state.setMs(step.ms, durationMs)
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
