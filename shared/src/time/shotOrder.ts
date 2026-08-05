import { MS_PER_FRAME, snapToFrame } from './frames.js'

/**
 * Najkrótsze dopuszczalne ujęcie w klatkach. Krócej i po przyciągnięciu do
 * klatki cięcia przestałyby rosnąć (patrz przebieg wsteczny w `orderStartTimes`).
 *
 * Jedna definicja dla dwóch wołających, które muszą dawać identyczny wynik na
 * identycznym wejściu: `web/src/timeline/normalize.ts` (`normalizeShots`,
 * porządkuje ujęcia edytowane ręcznie) i `server/src/llm/tasks/structure.ts`
 * (`structureToPatch`, buduje ujęcia od zera z odpowiedzi modelu). Wcześniej
 * każde z nich miało własną kopię tego samego algorytmu — i się rozjechały:
 * jedna liczyła zapas jednej klatki na końcu materiału, druga dwóch. Efekt:
 * łatka językowa potrafiła przyjąć ostatnie ujęcie o długości jednej klatki,
 * krótszej niż `useDragBoundary` w ogóle pozwala przeciągnąć — pierwsza ręczna
 * edycja tego ujęcia cichcem przesuwała jego granicę, bez żadnego komunikatu.
 * „Zgodne z oglądu" nie jest tym samym co „ta sama definicja", więc obie
 * strony wołają teraz wprost to samo miejsce.
 */
export const MIN_SHOT_FRAMES = 2

const frameIndexOf = (ms: number): number => Math.round(ms / MS_PER_FRAME)
const msOfFrameIndex = (frame: number): number => Math.round(frame * MS_PER_FRAME)

/**
 * Rdzeń algorytmu porządkującego znaczniki startu ujęć na siatce klatek.
 * Wejście: czasy start (w ms) już posortowane chronologicznie przez wołającego
 * — sortowanie różni się między wołającymi (jeden sortuje całe `Shot`, drugi
 * opisy modelu razem z ich treścią), więc nie należy do tej funkcji. Wyjście:
 * te same czasy z czterema niezmiennikami naraz — trzymają się wszystkie albo
 * żaden, bo wszystkie zależą od tego samego przebiegu:
 *
 * 1. Pierwsze ujęcie zaczyna się od zera.
 * 2. Kolejność `startMs` zgadza się z kolejnością wejścia.
 * 3. Każdy czas leży na granicy klatki przy 24 fps.
 * 4. Dwa ujęcia nigdy nie dzielą tej samej klatki.
 *
 * Trzy kroki, żaden z wyjściem awaryjnym w środku (patrz historia
 * `web/src/timeline/normalize.ts`, skąd ten algorytm pochodzi, po opis tego,
 * czym groziło wcześniejsze przerywanie się przebiegu wstecznego w środku):
 *
 * 1. Przebieg w przód ustala rosnące, unikalne numery klatek bez górnego
 *    ograniczenia.
 * 2. Przebieg wstecz ściąga to z powrotem do wnętrza materiału: ostatnie
 *    ujęcie przycinane do `lastFrame`, każde wcześniejsze do co najwyżej
 *    jednej klatki przed następnym.
 * 3. Jeśli po kroku 2 pierwsza klatka wyszła poniżej zera, przesuwamy całą
 *    listę o tę samą stałą.
 */
export function orderStartTimes(sortedStartMs: number[], durationMs: number): number[] {
  const count = sortedStartMs.length
  if (count === 0) return []

  let previousFrame = 0
  const frames = sortedStartMs.map((ms, index) => {
    if (index === 0) return 0
    const wanted = frameIndexOf(snapToFrame(ms))
    const frame = Math.max(previousFrame + 1, wanted)
    previousFrame = frame
    return frame
  })

  const lastFrame = frameIndexOf(durationMs) - MIN_SHOT_FRAMES
  const lastIndex = count - 1
  frames[lastIndex] = Math.min(frames[lastIndex] ?? 0, lastFrame)
  for (let index = lastIndex - 1; index >= 0; index -= 1) {
    frames[index] = Math.min(frames[index] ?? 0, (frames[index + 1] ?? 0) - 1)
  }

  const head = frames[0] ?? 0
  if (head < 0) {
    for (let index = 0; index < count; index += 1) {
      frames[index] = (frames[index] ?? 0) - head
    }
  }

  return frames.map(msOfFrameIndex)
}
