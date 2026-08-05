import { FIT_TOLERANCE, WORDS_PER_SECOND } from '@mmh3/shared'

/**
 * Tempo mowy w słowach na minutę, od którego zaczyna suwak — użytkownik może
 * je zmienić, próbując szybszej albo wolniejszej wypowiedzi. Wartość
 * początkowa liczy się WPROST z `WORDS_PER_SECOND` (`shared/src/validate/
 * rules/speech.ts`), którym reguła walidatora `SPEECH_FITS` szacuje, czy
 * kwestia mieści się w swoim oknie — nie z osobno wymyślonej liczby, żeby
 * obie strony (plakietka na osi czasu i walidator) startowały z tej samej
 * stawki. Sama zgodność stawki nie wystarcza do zgodnych werdyktów — patrz
 * `fitsClip` niżej, gdzie druga połowa tego samego problemu (tolerancja)
 * dostaje tę samą naprawę.
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

/**
 * Czy kwestia mieści się w swoim oknie — z tą samą tolerancją, którą
 * `SPEECH_FITS` (`shared/src/validate/rules/speech.ts`) stosuje przed
 * zgłoszeniem problemu: kwestia może przekroczyć okno o połowę
 * (`FIT_TOLERANCE`), zanim to naprawdę się liczy. Bez tego zgodna stawka
 * słów na minutę (patrz `DEFAULT_WORDS_PER_MINUTE` wyżej) by nie
 * wystarczyła: plakietka porównująca `naturalMs <= actualMs` bez tolerancji
 * zapalałaby się przy najmniejszym przekroczeniu, podczas gdy walidator
 * milczy aż do półtorakrotności okna — trzysłowowa kwestia w oknie
 * 800–1100 ms pokazywałaby „nie mieści się", choć `SPEECH_FITS` nic by nie
 * zgłosił. Sam cień (szerokość rysowana w `DialogueTracks`) zostaje przy
 * dokładnej długości naturalnej, bez tolerancji — to uczciwy obraz słów;
 * tolerancja należy do OSĄDU, czy ostrzec, nie do rysunku.
 */
export function fitsClip(naturalMs: number, actualMs: number): boolean {
  return naturalMs <= actualMs * FIT_TOLERANCE
}
