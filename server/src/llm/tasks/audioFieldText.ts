import { z } from 'zod'
import { containsDialogueBlock, countSentences } from '@mmh3/shared'

/**
 * Reguła „co wolno tekstowi przeznaczonemu na jedno z dwóch pól audio
 * projektu" — jedna definicja, którą stosuje KAŻDE zadanie językowe zdolne
 * wyprodukować tekst dla `overallSoundscape`/`nonDiegeticMusic`, nie tylko
 * zadanie „Podpowiedź audio" (`audio.ts`).
 *
 * Pilnowane są DWIE reguły kształtu, bo dokładnie tyle ich jest po stronie
 * walidatora dla tych pól i obie mają dotkliwość BŁĘDU:
 * 1. liczba zdań (`SOUNDSCAPE_SENTENCES` 1–4, `MUSIC_SENTENCES` 1–3),
 * 2. brak bloku dialogowego `<d>` — pierwsza połowa `SOUNDSCAPE_NO_DIALOGUE`
 *    (recenzja końcowa gałęzi, punkt 3: ten moduł deklarował w swoim własnym
 *    opisie, że JEST regułą dla tekstu do pól audio, a sprawdzał wyłącznie
 *    liczbę zdań; recenzent odtworzył `<d>` przez wszystkie trzy drzwi —
 *    zadanie audio, redakcję z celem audio i tłumaczenie całego projektu).
 * DRUGA połowa `SOUNDSCAPE_NO_DIALOGUE` (dosłowne powtórzenie istniejącej
 * kwestii w pejzażu) tu NIE stoi: to reguła TREŚCI, nie kształtu, a
 * rozstrzygnięcie zadania 11 mówi wprost, że treść zostaje po stronie
 * walidatora — zapalona reguła na ekranie przeglądu jest wtedy uczciwą
 * informacją zwrotną, nie usterką (patrz punkt 22
 * `docs/superpowers/specs/2026-08-04-uwagi-do-planu-2.md`).
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
  // Blok dialogowy sprawdzany PRZED liczbą zdań i przed furtką dla pustego
  // pola/`N/A` — `<d>` jest niedopuszczalne niezależnie od tego, ile zdań
  // wokół niego stoi, więc żadna inna gałąź nie ma prawa go przepuścić.
  if (containsDialogueBlock(text)) return false
  const trimmed = text.trim()
  if (trimmed === '' || isNA(trimmed)) return true
  const count = countSentences(trimmed)
  return count >= rule.min && count <= rule.max
}

export function audioFieldTextMessage(rule: AudioFieldTextRule, text: string): string {
  if (containsDialogueBlock(text)) {
    return `"${rule.field}" must not contain a "<d>" dialogue block — spoken dialogue `
      + 'belongs to the shot it is spoken in, never to an audio field. Describe the '
      + 'sound, do not quote the words.'
  }
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
