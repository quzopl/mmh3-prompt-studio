import { describe, it, expect } from 'vitest'
import type { Shot } from '@mmh3/shared'
import { shotSpans } from '../../src/timeline/spans.js'

const shot = (id: string, index: number, startMs: number): Shot => ({
  id, index, startMs, cutType: 'cut', cutPhrase: 'the camera cuts to',
  composition: '', body: [], cameraMoves: [], dialogue: [],
  screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
})

describe('shotSpans', () => {
  it('koniec ujęcia to początek następnego', () => {
    const spans = shotSpans([shot('a', 0, 0), shot('b', 1, 3000)], 8000)
    expect(spans.map(s => [s.startMs, s.endMs])).toEqual([[0, 3000], [3000, 8000]])
  })

  it('ostatnie ujęcie sięga końca wideo', () => {
    const spans = shotSpans([shot('a', 0, 0)], 8000)
    expect(spans[0]!.endMs).toBe(8000)
  })

  it('porządkuje po indeksie, nie po kolejności w tablicy', () => {
    const spans = shotSpans([shot('b', 1, 3000), shot('a', 0, 0)], 8000)
    expect(spans.map(s => s.shot.id)).toEqual(['a', 'b'])
  })

  it('nie produkuje ujemnej rozpiętości, gdy cięcie wypada poza wideo', () => {
    const spans = shotSpans([shot('a', 0, 0), shot('b', 1, 9000)], 8000)
    expect(spans[1]!.endMs).toBeGreaterThanOrEqual(spans[1]!.startMs)
  })

  it('zwraca pustą listę dla projektu bez ujęć', () => {
    expect(shotSpans([], 8000)).toEqual([])
  })
})
