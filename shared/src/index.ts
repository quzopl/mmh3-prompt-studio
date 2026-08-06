export const VERSION = '0.1.0'

export * from './model/types.js'
export * from './model/refs.js'
export * from './model/schema.js'
export * from './model/repairIds.js'
export * from './time/frames.js'
export * from './time/format.js'
export * from './time/shotOrder.js'
export * from './vocab/camera.js'
export * from './vocab/continuity.js'
export * from './vocab/cutPhrases.js'
export * from './vocab/refVocab.js'
export * from './vocab/moodWords.js'
export * from './compile/compile.js'
export * from './compile/describeSpeaker.js'
export * from './validate/types.js'
export * from './validate/validate.js'
export * from './validate/registry.js'
export * from './api.js'
export * from './patch/types.js'
export * from './patch/apply.js'
export * from './patch/describe.js'
// Wybiórczy eksport z pliku reguły, nie `export *` całego `validate/rules/*`
// (te pliki rejestrują się do `allRules()` przez efekt uboczny, patrz
// `validate/rules/index.ts`, i nie są pomyślane jako publiczne API modułu
// walidatora poza samą listą reguł). `WORDS_PER_SECOND` i `FIT_TOLERANCE` są
// wyjątkiem: tempo mowy i tolerancja, którymi `SPEECH_FITS` liczy dopasowanie
// kwestii do okna, muszą być tymi samymi liczbami, z których korzysta oś
// czasu (`web/src/timeline/speech.ts` — `DEFAULT_WORDS_PER_MINUTE`,
// `fitsClip`) — inaczej dwa miejsca liczące „czy kwestia się mieści" tym
// samym pytaniem dawałyby dwie różne odpowiedzi.
export { WORDS_PER_SECOND, FIT_TOLERANCE } from './validate/rules/speech.js'
// Ten sam wyjątek: `containsDialogueMarkup` jest pytaniem reguły
// `DIALOGUE_D_TAG_PURE` (`validate/rules/speech.ts`), a zadanie językowe
// tworzące kwestie dialogowe (`server/src/llm/tasks/dialogueText.ts`) musi
// odrzucić dokładnie ten sam tekst w schemacie odpowiedzi modelu — inaczej
// zwykła odpowiedź modelu („<d>Wait for me</d>") zapala BŁĄD na projekcie,
// który go nie miał, i blokuje eksport.
export { containsDialogueMarkup } from './validate/rules/speech.js'
// Jw. dla pierwszej połowy `SOUNDSCAPE_NO_DIALOGUE`
// (`validate/rules/audio.ts`) i wspólnej straży pól audio
// (`server/src/llm/tasks/audioFieldText.ts`).
export { containsDialogueBlock } from './validate/rules/audio.js'
// Ten sam wyjątek co wyżej: `countSentences` liczy zdania dla
// `SOUNDSCAPE_SENTENCES`/`MUSIC_SENTENCES` (`validate/rules/audio.ts`), a
// zadanie audio po stronie serwera (`server/src/llm/tasks/audio.ts`, fix
// round 1/5 zadania 11) musi liczyć zdania TĄ SAMĄ funkcją, żeby odrzucić w
// schemacie odpowiedź modelu, zanim złamie regułę, którą i tak zaraz zobaczy
// walidator — dwie kopie tego samego liczenia rozjechałyby się tak samo, jak
// ostrzega komentarz przy `WORDS_PER_SECOND`.
export { countSentences } from './validate/rules/audio.js'
