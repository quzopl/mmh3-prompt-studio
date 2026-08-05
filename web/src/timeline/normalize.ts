import { MS_PER_FRAME, snapToFrame, type Shot } from '@mmh3/shared'

/** Najkrótsze dopuszczalne ujęcie w klatkach — ta sama wartość co w `useDragBoundary`. */
const MIN_SHOT_FRAMES = 2

const frameIndexOf = (ms: number): number => Math.round(ms / MS_PER_FRAME)
const msOfFrameIndex = (frame: number): number => Math.round(frame * MS_PER_FRAME)

/**
 * Jedyna droga zapisu listy ujęć. Wymusza cztery niezmienniki naraz, bo trzymają
 * się albo wszystkie, albo żaden: pierwsze ujęcie zaczyna się od zera, kolejność
 * `index` zgadza się z kolejnością `startMs`, każdy czas leży na klatce, a dwa
 * ujęcia nigdy nie dzielą tej samej klatki.
 *
 * Ostatni warunek nie jest ozdobą. Przyciąganie do klatki potrafi zetknąć dwa
 * czasy, które w modelu różniły się o milisekundę, a wtedy `shotSpans` daje
 * ujęcie o zerowej długości — nie do chwycenia i nie do naprawienia myszą.
 *
 * Trzy kroki, żaden z wyjściem awaryjnym w środku:
 *
 * 1. Przebieg w przód ustala rosnące, unikalne numery klatek bez żadnego
 *    górnego ograniczenia: `frame[0] = 0`, potem `frame[i] = max(frame[i-1] + 1,
 *    przyciągnięta_klatka)`. Wynik jest ściśle rosnący i unikalny z definicji,
 *    ale może sięgać poza `durationMs`.
 *
 * 2. Przebieg wstecz ściąga to z powrotem do wnętrza materiału: ostatnie
 *    ujęcie przycinane do `lastFrame`, a każde wcześniejsze do co najwyżej
 *    jednej klatki przed następnym — `frame[i] = min(frame[i], frame[i+1] - 1)`
 *    aż do `frame[0]` włącznie, bez żadnego warunku przerywającego. Klatki
 *    mogą przy tym zejść poniżej zera — to na razie dozwolone i naprawiane w
 *    kroku 3, nie tutaj.
 *
 *    Wcześniejsza wersja tego przebiegu przerywała się, gdy zabrakło miejsca
 *    (`if (candidate < 1) break`), zostawiając nieprzetworzoną resztę przy
 *    surowych wartościach z przebiegu w przód. To tworzyło szew dokładnie w
 *    punkcie przerwania: klatki poniżej szwu (nietknięte, z przebiegu w przód,
 *    rosnące od zera) i klatki powyżej szwu (ściśnięte do `lastFrame`) mogły
 *    się nakładać, bo nic nie wymuszało odstępu między nimi. Przy 20 ujęciach
 *    w 500 ms dawało to 11 unikalnych klatek na 20 i czasy, które przestawały
 *    rosnąć — dokładnie ta kolizja, przed którą cała funkcja miała chronić.
 *    Przebieg bez przerwania nie ma szwu: każda klatka jest wymuszona ściśle
 *    poniżej swojego następcy przez konstrukcję pętli, więc unikalność i
 *    kolejność trzymają się dla całej listy, nie tylko dla jej ogona.
 *
 * 3. Jeśli po kroku 2 pierwsza klatka wyszła poniżej zera, przesuwamy całą
 *    listę o tę samą stałą, żeby wróciła na zero — jednorodne przesunięcie
 *    nie rusza ani kolejności, ani unikalności, bo dodaje tę samą liczbę do
 *    każdej klatki. Nadmiar wędruje wtedy na koniec, poza `durationMs`, co
 *    jest złym wyjściem, ale naprawialnym: `SHOT_TIME_IN_RANGE` je zgłosi, a
 *    `clipBox` i tak przypina klips do krawędzi osi czasu, więc zostaje
 *    chwytalny i da się usuwać ujęcia, aż się zmieszczą. Zlepienie kilku
 *    ujęć na jednej klatce — to, co robił szew z poprzedniej wersji — nie
 *    daje żadnej z tych trzech rzeczy: ujęcia o zerowej długości nie widać,
 *    nie da się jej złapać i nie da się jej usunąć osobno od sąsiadki.
 */
export function normalizeShots(shots: Shot[], durationMs: number): Shot[] {
  const lastFrame = frameIndexOf(durationMs) - MIN_SHOT_FRAMES
  const ordered = [...shots].sort((a, b) => a.startMs - b.startMs)
  const count = ordered.length
  if (count === 0) return []

  let previousFrame = 0
  const frames = ordered.map((shot, index) => {
    if (index === 0) return 0
    const wanted = frameIndexOf(snapToFrame(shot.startMs))
    const frame = Math.max(previousFrame + 1, wanted)
    previousFrame = frame
    return frame
  })

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

  return ordered.map((shot, index) => ({ ...shot, index, startMs: msOfFrameIndex(frames[index] ?? 0) }))
}
