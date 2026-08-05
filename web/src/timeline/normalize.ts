import { orderStartTimes, type Shot } from '@mmh3/shared'

/**
 * Jedyna droga zapisu listy ujęć. Wymusza cztery niezmienniki naraz — pierwsze
 * ujęcie zaczyna się od zera, kolejność `index` zgadza się z kolejnością
 * `startMs`, każdy czas leży na klatce, dwa ujęcia nigdy nie dzielą tej samej
 * klatki — ale sam algorytm liczący te czasy mieszka teraz w
 * `orderStartTimes` (`shared/src/time/shotOrder.ts`), nie tutaj.
 *
 * Powód przeniesienia: `server/src/llm/tasks/structure.ts` (zadanie „pomysł →
 * struktura ujęć") buduje ujęcia od zera z odpowiedzi modelu i potrzebuje
 * DOKŁADNIE tych samych czterech niezmienników. Wcześniej miało własną kopię
 * tego algorytmu, licząc na końcu materiału zapas JEDNEJ klatki zamiast DWÓCH
 * jak tutaj — rozjazd niewidoczny w recenzji „na oko", ale realny: łatka
 * językowa potrafiła przyjąć ostatnie ujęcie o długości jednej klatki, krótszej
 * niż `useDragBoundary` w ogóle pozwala przeciągnąć, więc pierwsza ręczna
 * edycja cichcem przesuwała jego granicę. Jedna definicja w `shared/`, którą
 * woła i `web/`, i `server/`, usuwa możliwość takiego rozjazdu w ogóle.
 */
export function normalizeShots(shots: Shot[], durationMs: number): Shot[] {
  const ordered = [...shots].sort((a, b) => a.startMs - b.startMs)
  const starts = orderStartTimes(ordered.map(shot => shot.startMs), durationMs)

  /**
   * Ujęcie, którego ani `index`, ani `startMs` się nie zmienia, wraca TYM
   * SAMYM obiektem. `normalizeProject` (`normalizeProject.ts`) stoi na tym
   * swoim krótkim spięciu tożsamościowym — porównuje kandydata z oryginałem
   * ELEMENT PO ELEMENCIE, więc bez tego każde przejście przez tę funkcję
   * produkowałoby nowe obiekty, `apply` widziałby zmianę tam, gdzie jej nie
   * ma, i dokładał do historii cofania wpisy nieodpowiadające niczemu.
   */
  return ordered.map((shot, index) => {
    const startMs = starts[index] ?? 0
    return shot.index === index && shot.startMs === startMs ? shot : { ...shot, index, startMs }
  })
}
