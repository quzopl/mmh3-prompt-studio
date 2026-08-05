import { describe, expect, it } from 'vitest'
import { isFrameAligned, MS_PER_FRAME, type Shot } from '@mmh3/shared'
import { normalizeShots } from '../../src/timeline/normalize.js'

const shot = (id: string, index: number, startMs: number): Shot => ({
  id, index, startMs,
  cutType: 'cut', cutPhrase: 'the camera cuts to', composition: '',
  body: [], cameraMoves: [], dialogue: [], screenText: [], diegeticSfx: [],
  labelRefs: [], anchors: [],
})

/**
 * Cztery niezmienniki `normalizeShots` naraz, w jednym miejscu — zamiast
 * powtarzać ten sam komplet asercji w każdym teście z osobna.
 */
function expectShotInvariants(result: Shot[]): void {
  const starts = result.map(s => s.startMs)
  expect(starts[0]).toBe(0)
  for (let i = 1; i < starts.length; i += 1) {
    expect(starts[i]).toBeGreaterThan(starts[i - 1] ?? 0)
  }
  expect(starts.every(ms => isFrameAligned(ms))).toBe(true)
  expect(new Set(starts).size).toBe(starts.length)
}

describe('normalizeShots', () => {
  it('numeruje po czasie, a nie po dotychczasowym indeksie', () => {
    const result = normalizeShots([shot('a', 0, 6000), shot('b', 1, 2000)], 8000)
    expect(result.map(s => s.id)).toEqual(['b', 'a'])
    expect(result.map(s => s.index)).toEqual([0, 1])
  })

  it('pierwsze ujęcie zawsze zaczyna się od zera', () => {
    const result = normalizeShots([shot('a', 0, 500)], 8000)
    expect(result[0]?.startMs).toBe(0)
  })

  it('przyciąga każdy czas do siatki klatek', () => {
    const result = normalizeShots([shot('a', 0, 0), shot('b', 1, 2010)], 8000)
    expect(result[1]?.startMs).toBe(Math.round(Math.round(2010 / MS_PER_FRAME) * MS_PER_FRAME))
  })

  it('rozsuwa ujęcia, które po przyciągnięciu wypadły na tej samej klatce', () => {
    const result = normalizeShots([shot('a', 0, 0), shot('b', 1, 4000), shot('c', 2, 4001)], 8000)
    const starts = result.map(s => s.startMs)
    expect(new Set(starts).size).toBe(3)
    expect(starts[2]).toBeGreaterThan(starts[1] ?? 0)
  })

  it('nie wypuszcza ujęcia poza materiał', () => {
    const result = normalizeShots([shot('a', 0, 0), shot('b', 1, 99999)], 8000)
    expect(result[1]?.startMs).toBeLessThan(8000)
  })

  it('pustej listy nie psuje', () => {
    expect(normalizeShots([], 8000)).toEqual([])
  })

  it('rozsuwanie przy końcu materiału nie zlepia kilku ujęć na tej samej klatce', () => {
    // Pięć ujęć, cztery ostatnie stłoczone w ostatnich ~30 ms materiału —
    // każde z osobna przyciąga się do ostatniej dostępnej klatki (190), więc
    // podbijanie każdego kolejnego o jedną klatkę względem poprzedniego
    // zderza się z górnym ograniczeniem `lastFrame`. Sprawdzam to zamiast
    // zakładać, że rozsuwanie zawsze wygrywa.
    const result = normalizeShots(
      [shot('a', 0, 0), shot('b', 1, 7900), shot('c', 2, 7910), shot('d', 3, 7920), shot('e', 4, 7930)],
      8000,
    )
    expectShotInvariants(result)
  })

  it('ściąga ogon do wnętrza materiału, zachowując rosnący, unikalny porządek', () => {
    // Sześć ujęć, pięć ostatnich stłoczonych w ostatnich ~200 ms materiału —
    // mieszczą się w dostępnych klatkach, ale tylko jeśli przebieg wstecz
    // faktycznie odsunie każde od następnego, a nie tylko przytnie do sufitu.
    const result = normalizeShots(
      [
        shot('a', 0, 0), shot('b', 1, 7800), shot('c', 2, 7850),
        shot('d', 3, 7900), shot('e', 4, 7950), shot('f', 5, 7999),
      ],
      8000,
    )
    expect(result.map(s => s.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expectShotInvariants(result)
  })

  it('gdy ujęć jest więcej niż klatek w materiale, kolejność i unikalność przeżywają', () => {
    // 100 ms przy 24 kl/s to dwie-trzy klatki, a ujęć jest pięć — fizycznie
    // nie da się ich upchnąć w materiale bez zlepienia. Przebieg wstecz ma
    // wtedy odpuścić, a nie zlepić: reszta ujęć wypada poza `durationMs`, ale
    // każde zostaje na osobnej, rosnącej klatce.
    const result = normalizeShots(
      [shot('a', 0, 0), shot('b', 1, 10), shot('c', 2, 20), shot('d', 3, 30), shot('e', 4, 40)],
      100,
    )
    expect(result.map(s => s.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expectShotInvariants(result)
    expect(result.map(s => s.startMs).some(ms => ms >= 100)).toBe(true)
  })

  it('20 ujęć w 500 ms materiału zachowuje wszystkie cztery niezmienniki', () => {
    // Ten przypadek znalazła recenzja przeciw dwuprzebiegowej wersji z
    // przerywaniem (`if (candidate < 1) break`): 11 unikalnych klatek na 20 i
    // czasy, które przestawały rosnąć. Szew powstawał w miejscu przerwania —
    // ujęcia poniżej niego zostawały przy surowych wartościach z przebiegu w
    // przód, które nachodziły na ściśnięty ogon powyżej. Mój wcześniejszy test
    // degeneracji (5 ujęć w 100 ms) tego nie złapał, bo przy tak małym
    // materiale przebieg wstecz przerywał się od razu, na pierwszej
    // iteracji — sprawdzał tylko przypadek skrajny, nie ogólny.
    const shots = Array.from({ length: 20 }, (_, i) => shot(`s${i}`, i, Math.round((i * 500) / 20)))
    const result = normalizeShots(shots, 500)
    expectShotInvariants(result)
  })

  it('150 ujęć w minimalnym z schematu materiale 4000 ms zachowuje wszystkie cztery niezmienniki', () => {
    // Ten sam szew co wyżej, przy liczbach z drugiego przypadku znalezionego
    // przez recenzję: 95 unikalnych klatek na 150 i brak rosnącej kolejności.
    const shots = Array.from({ length: 150 }, (_, i) => shot(`s${i}`, i, Math.round((i * 4000) / 150)))
    const result = normalizeShots(shots, 4000)
    expectShotInvariants(result)
  })
})
