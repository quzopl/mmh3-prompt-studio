import { z } from 'zod'
import { containsDialogueMarkup } from '@mmh3/shared'

/**
 * Reguła „co wolno tekstowi przeznaczonemu na `DialogueEvent.text`" — jedna
 * definicja, którą stosuje KAŻDE zadanie językowe zdolne wyprodukować kwestię
 * dialogową. Dziś jest takie jedno („struktura ujęć", `structure.ts`), i
 * dokładnie dlatego ta reguła stoi w osobnym module, a nie w nim: to ten sam
 * układ, co przy `audioFieldText.ts` (pola audio, fix round 2/5 zadania 11) —
 * zadanie dopisane kiedyś dziedziczy strażnicę zamiast odkrywać usterkę od
 * nowa.
 *
 * Recenzja końcowa gałęzi, punkt 1 (krytyczny): `structure.ts` wkładał
 * `input.line` do `DialogueEvent.text` NIETKNIĘTE, a jego schemat nie miał
 * żadnego refinementu. Odpowiedź modelu w postaci `"<d>Wait for me</d>"` albo
 * `"[English] Wait for me"` — nawyk tym silniejszy, że otaczający format
 * używa dokładnie tego znacznika — zapala `DIALOGUE_D_TAG_PURE`
 * (dotkliwość BŁĄD, `shared/src/validate/rules/speech.ts`) na projekcie,
 * który tej diagnostyki nie miał, i `isExportReady` odmawia eksportu projektu
 * eksportowalnego chwilę wcześniej. Cztery z pięciu zadań językowych traktują
 * treść kwestii jako nietykalną i każde z osobna tłumaczy, dlaczego nie da
 * się jej dosięgnąć — `structure` jako jedyne ją TWORZY.
 *
 * Pytanie („czy tekst niesie znacznik `<d>` albo tag języka") jest TĄ SAMĄ
 * funkcją, której używa reguła walidatora — `containsDialogueMarkup`,
 * eksportowana z `@mmh3/shared` dokładnie w tym celu (patrz komentarz przy
 * eksporcie w `shared/src/index.ts`). Druga kopia wzorca rozjechałaby się z
 * regułą przy pierwszej jej zmianie, a wtedy schemat znów przepuszczałby
 * tekst, który walidator odrzuca.
 */
export function dialogueTextOk(text: string): boolean {
  return !containsDialogueMarkup(text)
}

export function dialogueTextMessage(): string {
  return 'Dialogue text must carry the spoken words only — no "<d>" tags and no '
    + '"[Language]" marker; the compiler adds both itself.'
}

/**
 * Schemat Zoda dla pojedynczego ciągu przeznaczonego na `DialogueEvent.text`.
 * `min(1)` jest częścią tej samej reguły, nie dodatkiem wołającego: kwestia
 * bez ani jednego znaku nie jest kwestią, a `structureToPatch` i tak tworzy
 * `DialogueEvent` tylko wtedy, gdy model podał `line` (pole opcjonalne —
 * `.optional()` nakłada wołający, bo to on decyduje, czy kwestia w ogóle
 * musi być).
 */
export function dialogueTextSchema(): z.ZodType<string> {
  return z.string().min(1).refine(dialogueTextOk, () => ({ message: dialogueTextMessage() }))
}
