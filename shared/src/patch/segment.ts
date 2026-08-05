import type { Segment } from '../model/types.js'

/**
 * Odczytuje segment pod danym indeksem, jawnie odrzucając indeksy, które nie
 * mogą wskazywać pozycji w tablicy: ujemne, ułamkowe albo `NaN`.
 *
 * Zwykłe indeksowanie `body[i]` w JS i tak zwraca `undefined` dla takiego
 * indeksu — klucz w rodzaju `"-1"`, `"1.5"` albo `"NaN"` nigdy nie pasuje do
 * wpisu tablicy. To poprawne, ale niewidoczne dla czytającego: bez tej
 * funkcji ochrona przed łatką, która poda taki indeks, wygląda jak przypadek,
 * a nie zamierzony warunek. Wewnętrzny moduł pakietu — nieeksportowany
 * z `index.ts`.
 */
export function segmentAt(body: Segment[], index: number): Segment | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= body.length) return undefined
  return body[index]
}
