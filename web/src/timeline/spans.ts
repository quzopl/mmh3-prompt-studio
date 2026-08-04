import type { Shot } from '@mmh3/shared'

export interface ShotSpan {
  shot: Shot
  startMs: number
  endMs: number
}

/**
 * Ujęcia w modelu niosą tylko czas cięcia. Koniec wynika z początku następnego,
 * a ostatnie sięga końca wideo — oś czasu potrzebuje obu wartości.
 */
export function shotSpans(shots: Shot[], durationMs: number): ShotSpan[] {
  const ordered = [...shots].sort((a, b) => a.index - b.index)
  return ordered.map((shot, position) => {
    const next = ordered[position + 1]
    const endMs = next ? next.startMs : durationMs
    return { shot, startMs: shot.startMs, endMs: Math.max(shot.startMs, endMs) }
  })
}
