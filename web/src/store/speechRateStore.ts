import { create } from 'zustand'
import { DEFAULT_WORDS_PER_MINUTE } from '../timeline/speech.js'

/**
 * Tempo mowy jest ustawieniem widoku, nie częścią projektu. `Speaker.rate`
 * niesie prozę do promptu („measured pace"), a nie liczbę, i dokładanie tam
 * pola liczbowego zmieniałoby schemat po to, żeby zasilić podpowiedź na
 * ekranie. Wartość nie przeżywa przeładowania strony i tak ma być.
 */
interface SpeechRateState {
  wordsPerMinute: number
  setWordsPerMinute: (value: number) => void
}

export const useSpeechRate = create<SpeechRateState>(set => ({
  wordsPerMinute: DEFAULT_WORDS_PER_MINUTE,
  setWordsPerMinute: value => set({ wordsPerMinute: value }),
}))
