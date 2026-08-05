import { describe, it, expect } from 'vitest'
import { MIN_SHOT_FRAMES, orderStartTimes } from '../../src/time/shotOrder.js'

/**
 * `shotOrder.ts` przeniósł tu algorytm porządkujący z `web/src/timeline/normalize.ts`
 * (runda 1 recenzji zadania 6), ale nie miał WŁASNYCH testów — jedyna
 * weryfikacja była pośrednia: test punktu stałego w `server/test/llm/tasks/structure.test.ts`
 * i istniejące testy `web/test/timeline/normalize.test.ts`. Runda 2: test punktu
 * stałego woła `orderStartTimes` po OBU stronach porównania, więc jest
 * tautologiczny względem `MIN_SHOT_FRAMES` — z `MIN_SHOT_FRAMES = 1` zgadzałby
 * się równie dobrze, tylko na złej wartości (zmierzone ręcznie: `npm test` przy
 * podmienionej stałej wychodził w całości zielony). Testy niżej liczą
 * oczekiwany wynik z niezależnej arytmetyki klatek, nie z samej funkcji.
 */

describe('MIN_SHOT_FRAMES', () => {
  it('to dwie klatki — wartość, o którą rozjechały się kiedyś dwie osobne kopie tego algorytmu', () => {
    expect(MIN_SHOT_FRAMES).toBe(2)
  })
})

describe('orderStartTimes', () => {
  it('pustej listy nie psuje', () => {
    expect(orderStartTimes([], 8000)).toEqual([])
  })

  it('pierwsze ujęcie zawsze na zero, niezależnie od podanego czasu', () => {
    expect(orderStartTimes([500], 8000)).toEqual([0])
  })

  it('przyciąga czas do siatki klatek 24 fps', () => {
    // 2010 ms / (1000/24 ms na klatkę) ≈ 48,24 klatki → zaokrąglenie w dół do
    // klatki 48 → 48 * (1000/24) = 2000 ms dokładnie.
    expect(orderStartTimes([0, 2010], 8000)).toEqual([0, 2000])
  })

  it('rozsuwa dwa czasy, które po przyciągnięciu wypadły na tej samej klatce', () => {
    const result = orderStartTimes([0, 4000, 4001], 8000)
    expect(new Set(result).size).toBe(3)
    expect(result[1]).toBeGreaterThan(result[0] ?? 0)
    expect(result[2]).toBeGreaterThan(result[1] ?? 0)
  })

  it('nie wypuszcza ostatniego czasu poza koniec materiału', () => {
    const result = orderStartTimes([0, 99999], 8000)
    expect(result[1]).toBeLessThan(8000)
  })

  /**
   * Test przypinający `MIN_SHOT_FRAMES` — patrz komentarz na górze pliku.
   * Materiał 8000 ms przy 24 fps to DOKŁADNIE 192 klatki (8000 / (1000/24) =
   * 192, bez reszty, więc żadne zaokrąglenie nie zaciemnia rachunku).
   * Ostatnie ujęcie musi zostać co najmniej `MIN_SHOT_FRAMES` klatek przed
   * końcem, czyli na klatce 190 — `190 * (1000/24)` zaokrąglone do
   * najbliższej milisekundy to 7917. Z błędną stałą `1` (ta, która się kiedyś
   * rozjechała) wyszłaby klatka 191 → 7958 ms — dokładnie liczba, którą
   * zgłosił recenzent jako obserwowaną różnicę między dwiema kopiami
   * algorytmu, zanim ta funkcja stała się jedyną z nich.
   */
  it('ostatnie ujęcie w materiale 8000 ms ląduje dwie klatki przed końcem (7917 ms), nie jedną (7958 ms)', () => {
    const result = orderStartTimes([0, 7999], 8000)
    expect(result[1]).toBe(7917)
    expect(result[1]).not.toBe(7958)
  })
})
