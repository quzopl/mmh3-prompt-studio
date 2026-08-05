import { describe, expect, it } from 'vitest'
import { MS_PER_FRAME } from '@mmh3/shared'
import { createScale } from '../../src/timeline/scale.js'
import { MIN_CLIP_MS, clipBox, clipTargetMs } from '../../src/timeline/clips.js'

const scale = createScale(8000, 800, 1)

describe('clipBox', () => {
  it('przelicza czasy na piksele', () => {
    expect(clipBox(scale, { id: 'a', startMs: 2000, endMs: 4000 })).toEqual({ left: 200, width: 200 })
  })

  it('trzyma klip przy krawędzi, gdy wyszedł poza materiał', () => {
    const box = clipBox(scale, { id: 'a', startMs: 9000, endMs: 12000 })
    expect(box.left).toBeLessThanOrEqual(800)
    expect(box.width).toBeGreaterThanOrEqual(8)
  })
})

describe('clipTargetMs', () => {
  const bounds = { lowestMs: 0, highestMs: 8000 }

  it('przesuwa cały klip zachowując długość', () => {
    const result = clipTargetMs({
      grip: 'move', clip: { id: 'a', startMs: 2000, endMs: 3000 },
      desiredMs: 5000, grabOffsetMs: 0, snapPoints: [], toleranceMs: 0, ...bounds,
    })
    expect(result.endMs - result.startMs).toBe(1000)
    expect(result.startMs).toBe(5000)
  })

  it('przesunięcie w całości nie wychodzi poza ograniczenia', () => {
    const result = clipTargetMs({
      grip: 'move', clip: { id: 'a', startMs: 2000, endMs: 3000 },
      desiredMs: 7800, grabOffsetMs: 0, snapPoints: [], toleranceMs: 0, ...bounds,
    })
    expect(result.endMs).toBe(8000)
    expect(result.endMs - result.startMs).toBe(1000)
  })

  it('krawędź początkowa nie przechodzi przez koniec', () => {
    const result = clipTargetMs({
      grip: 'start', clip: { id: 'a', startMs: 2000, endMs: 3000 },
      desiredMs: 5000, grabOffsetMs: 0, snapPoints: [], toleranceMs: 0, ...bounds,
    })
    expect(result.startMs).toBeLessThan(result.endMs)
    expect(result.endMs - result.startMs).toBeGreaterThanOrEqual(MIN_CLIP_MS)
  })

  it('krawędź końcowa nie przechodzi przez początek', () => {
    const result = clipTargetMs({
      grip: 'end', clip: { id: 'a', startMs: 2000, endMs: 3000 },
      desiredMs: 100, grabOffsetMs: 0, snapPoints: [], toleranceMs: 0, ...bounds,
    })
    expect(result.startMs).toBe(2000)
    expect(result.endMs - result.startMs).toBeGreaterThanOrEqual(MIN_CLIP_MS)
  })

  it('oba czasy leżą na siatce klatek', () => {
    const result = clipTargetMs({
      grip: 'end', clip: { id: 'a', startMs: 0, endMs: 1000 },
      desiredMs: 2010, grabOffsetMs: 0, snapPoints: [], toleranceMs: 0, ...bounds,
    })
    for (const ms of [result.startMs, result.endMs]) {
      expect(ms).toBe(Math.round(Math.round(ms / MS_PER_FRAME) * MS_PER_FRAME))
    }
  })

  it('przyciąga do podanego punktu w zasięgu tolerancji', () => {
    const result = clipTargetMs({
      grip: 'end', clip: { id: 'a', startMs: 0, endMs: 1000 },
      desiredMs: 3960, grabOffsetMs: 0, snapPoints: [4000], toleranceMs: 100, ...bounds,
    })
    expect(result.endMs).toBe(4000)
  })

  // Poniższe dwa przypadki sprawdzają skrzyżowane ograniczenia — sytuację, w
  // której klip jest za długi (albo za krótki), żeby zmieścić się w dostępnym
  // zakresie. `boundaryTargetMs` w `useDragBoundary.ts` rozstrzyga taki
  // konflikt na korzyść dolnego ograniczenia (`Math.max(lowest, Math.min(x,
  // highest))`), właśnie po to, żeby wynik nigdy nie spadł poniżej zera —
  // ujemny `startMs` odrzuca `ShotSchema` i każdy kolejny autozapis wraca z
  // kodem 400. `clipTargetMs` musi rozstrzygać skrzyżowanie tak samo.
  it('ruch całego klipu: gdy klip jest dłuższy niż dostępny zakres, dolne ograniczenie wygrywa i czas nie spada poniżej zera', () => {
    const result = clipTargetMs({
      grip: 'move', clip: { id: 'a', startMs: 2000, endMs: 3000 },
      desiredMs: 1000, grabOffsetMs: 0, snapPoints: [], toleranceMs: 0,
      lowestMs: 0, highestMs: 500,
    })
    expect(result.startMs).toBe(0)
  })

  it('krawędź początkowa: gdy klip jest krótszy niż dwie klatki, dolne ograniczenie wygrywa i czas nie spada poniżej zera', () => {
    const result = clipTargetMs({
      grip: 'start', clip: { id: 'a', startMs: 0, endMs: 20 },
      desiredMs: 5000, grabOffsetMs: 0, snapPoints: [], toleranceMs: 0,
      lowestMs: 0, highestMs: 8000,
    })
    expect(result.startMs).toBe(0)
  })
})
