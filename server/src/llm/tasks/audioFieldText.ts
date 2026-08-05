import { z } from 'zod'
import { countSentences } from '@mmh3/shared'

/**
 * Reguła „ile zdań wolno tekstowi przeznaczonemu na jedno z dwóch pól audio
 * projektu" — jedna definicja, którą stosuje KAŻDE zadanie językowe zdolne
 * wyprodukować tekst dla `overallSoundscape`/`nonDiegeticMusic`, nie tylko
 * zadanie „Podpowiedź audio" (`audio.ts`).
 *
 * Fix round 2/5, zadanie 11, punkt 2: fix round 1 dodał to pilnowanie
 * WYŁĄCZNIE do `AudioSchema` w `audio.ts` — ale `redact.ts` (redakcja
 * pojedynczego pola) i `translateAll.ts` (redakcja całego projektu) też
 * potrafią wyprodukować operację `setAudio` dla TYCH SAMYCH dwóch pól, przez
 * ten sam ogólny `english: z.string()` bez żadnego ograniczenia — identyczna
 * luka, w tym samym polu, przez inne drzwi. Recenzent: „unless it validates,
 * it has the same hole." Zamiast powtarzać refinement w trzech schematach —
 * jedna definicja tutaj, którą wszystkie trzy zadania importują. Czwarte
 * zadanie, które kiedyś dojdzie i też będzie umiało pisać do tych pól,
 * dziedziczy tę strażnicę zamiast musieć odkrywać usterkę od nowa.
 *
 * Wartości `min`/`max` odpowiadają regułom walidatora
 * (`shared/src/validate/rules/audio.ts` — `SOUNDSCAPE_SENTENCES`:
 * 1–4, `MUSIC_SENTENCES`: 1–3). Puste pole i `"N/A"` są zawsze dopuszczalne —
 * to samo legalne „brak propozycji"/„świadoma cisza", które dopuszcza reguła
 * walidatora (`isNA` tam i tutaj to ta sama definicja: dokładny, przycięty
 * ciąg `"N/A"`).
 */
export interface AudioFieldTextRule {
  field: 'overallSoundscape' | 'nonDiegeticMusic'
  min: number
  max: number
}

export const SOUNDSCAPE_TEXT_RULE: AudioFieldTextRule = { field: 'overallSoundscape', min: 1, max: 4 }
export const MUSIC_TEXT_RULE: AudioFieldTextRule = { field: 'nonDiegeticMusic', min: 1, max: 3 }

/** Mapa `id` używanego przez `translateAll.ts` (`collectTranslatableFields`,
 * format `audio:${field}`) na regułę tego pola — jeden słownik, żeby wołający
 * nie musiał sam odtwarzać tego formatu identyfikatora. */
export const AUDIO_FIELD_RULE_BY_ID: Record<string, AudioFieldTextRule> = {
  'audio:overallSoundscape': SOUNDSCAPE_TEXT_RULE,
  'audio:nonDiegeticMusic': MUSIC_TEXT_RULE,
}

const isNA = (text: string): boolean => text.trim() === 'N/A'

export function audioFieldTextOk(rule: AudioFieldTextRule, text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '' || isNA(trimmed)) return true
  const count = countSentences(trimmed)
  return count >= rule.min && count <= rule.max
}

export function audioFieldTextMessage(rule: AudioFieldTextRule, text: string): string {
  return `"${rule.field}" must be ${rule.min} to ${rule.max} sentences (found ${countSentences(text.trim())}) `
    + '— return an empty string if it does not apply.'
}

/**
 * Schemat Zoda dla POJEDYNCZEGO ciągu przeznaczonego na jedno pole audio —
 * używany bezpośrednio tam, gdzie odpowiedź modelu niesie WYŁĄCZNIE ten jeden
 * ciąg i cel jest znany z góry, zanim model odpowie (`audio.ts`: zawsze oba
 * pola naraz; `redact.ts`: cel wybrany przez użytkownika przed wysłaniem
 * zapytania). `translateAll.ts` NIE używa tej funkcji wprost — tam jeden
 * schemat obejmuje WIELE pól o różnych celach naraz, więc pilnowanie leci
 * przez `AUDIO_FIELD_RULE_BY_ID` w `superRefine` na całej tablicy (zob.
 * `TranslateAllSchema`).
 */
export function audioFieldTextSchema(rule: AudioFieldTextRule): z.ZodType<string> {
  return z.string().refine(
    text => audioFieldTextOk(rule, text),
    text => ({ message: audioFieldTextMessage(rule, text) }),
  )
}
