/**
 * Tempo mowy w słowach na minutę. Sto pięćdziesiąt to spokojna narracja —
 * wartość poglądowa, od której zaczyna suwak, a nie prawda o modelu.
 */
export const DEFAULT_WORDS_PER_MINUTE = 150

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
