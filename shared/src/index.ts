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
