import { WORDS_PER_SECOND } from '@mmh3/shared'

/**
 * Tempo mowy w słowach na minutę, od którego zaczyna suwak — użytkownik może
 * je zmienić, próbując szybszej albo wolniejszej wypowiedzi. Wartość
 * początkowa liczy się WPROST z `WORDS_PER_SECOND` (`shared/src/validate/
 * rules/speech.ts`), którym reguła walidatora `SPEECH_FITS` szacuje, czy
 * kwestia mieści się w swoim oknie — nie z osobno wymyślonej liczby. Dwa
 * miejsca liczące „czy kwestia się mieści" tym samym pytaniem muszą
 * zaczynać od tej samej odpowiedzi: przy osobnych stałych (tu kiedyś 150,
 * w walidatorze 2.7 słowa/s czyli 162/min) cień na osi czasu potrafił
 * pokazywać komfortowe dopasowanie dokładnie wtedy, gdy walidator już
 * zgłaszał błąd — żadna z dwóch liczb nie była przez to zła osobno, tylko
 * niespójna z drugą.
 */
export const DEFAULT_WORDS_PER_MINUTE = WORDS_PER_SECOND * 60

/** Najniższe tempo, jakie ma sens — poniżej wynik uciekłby w nieskończoność. */
const MIN_WORDS_PER_MINUTE = 40

export function countWords(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  return trimmed.split(/\s+/).length
}

/**
 * Ile kwestia potrwa, jeśli wypowiedzieć ją w podanym tempie. Służy wyłącznie
 * do pokazania, czy zmieści się w klipie — nie zapisuje się do modelu, bo
 * `<d>` idzie do promptu verbatim i długość klipu jest decyzją użytkownika.
 */
export function naturalDurationMs(text: string, wordsPerMinute: number): number {
  const words = countWords(text)
  if (words === 0) return 0
  const rate = Math.max(MIN_WORDS_PER_MINUTE, wordsPerMinute)
  return Math.round((words / rate) * 60000)
}
