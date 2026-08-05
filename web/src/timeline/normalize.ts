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
 * Dwa przebiegi, nie jedno ograniczenie. Pierwsza wersja tej funkcji liczyła
 * `Math.min(lastFrame, Math.max(previousFrame + 1, wanted))` w jednym kroku —
 * ale to każe klatce spełnić naraz dwa żądania, które przy stłoczeniu ujęć
 * przy końcu materiału nie dają się pogodzić: „bądź co najmniej o jedną
 * klatkę dalej niż poprzednia” i „nie przekrocz ostatniej klatki”. Gdy
 * miejsce się kończy, zewnętrzny `min` zawsze rozstrzyga na korzyść sufitu, więc
 * każde kolejne ujęcie po wyczerpaniu miejsca lądowało na tej samej, ostatniej
 * klatce — dokładnie ten defekt, przed którym rozsuwanie miało chronić.
 *
 * Dlatego osobno: przebieg w przód ustala rosnące, unikalne numery klatek bez
 * żadnego górnego ograniczenia (któraś może wypaść poza `durationMs`), a
 * przebieg wstecz ściąga ogon z powrotem do wnętrza materiału, idąc od
 * ostatniego ujęcia do drugiego i pilnując, żeby każde było o co najmniej
 * jedną klatkę przed następnym. Gdyby ściąganie miało zepchnąć ujęcie poniżej
 * klatki 1 — czyli miejsca fizycznie nie starcza na tyle ujęć, ile ich jest
 * (przy 24 kl/s najkrótszy dozwolony materiał mieści 96 klatek, więc trzeba by
 * mieć więcej ujęć niż klatek) — przerywamy i zostawiamy resztę tam, gdzie
 * postawił ją przebieg w przód. Ujęcie poza `durationMs` to złe wyjście, ale
 * naprawialne: `SHOT_TIME_IN_RANGE` je zgłosi, a `clipBox` i tak przypina
 * klips do krawędzi osi czasu, więc zostaje chwytalny i da się usuwać ujęcia,
 * aż się zmieszczą. Zlepienie kilku ujęć na jednej klatce dałoby model,
 * którego nie da się już naprawić żadnym gestem.
 */
export function normalizeShots(shots: Shot[], durationMs: number): Shot[] {
  const lastFrame = frameIndexOf(durationMs) - MIN_SHOT_FRAMES
  const ordered = [...shots].sort((a, b) => a.startMs - b.startMs)
  if (ordered.length === 0) return []

  let previousFrame = 0
  const frames = ordered.map((shot, index) => {
    if (index === 0) return 0
    const wanted = frameIndexOf(snapToFrame(shot.startMs))
    const frame = Math.max(previousFrame + 1, wanted)
    previousFrame = frame
    return frame
  })

  let bound = lastFrame
  for (let index = frames.length - 1; index >= 1; index -= 1) {
    const frame = frames[index] ?? 0
    const candidate = Math.min(frame, bound)
    if (candidate < 1) break
    frames[index] = candidate
    bound = candidate - 1
  }

  return ordered.map((shot, index) => ({ ...shot, index, startMs: msOfFrameIndex(frames[index] ?? 0) }))
}
