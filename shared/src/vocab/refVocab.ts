import type { AudioMarker, RefTaskType, VisualMarker } from '../model/types.js'

export const REF_TASK_TYPES: readonly RefTaskType[] = [
  'keyframe completion',
  'reference generation',
  'video editing',
  'video continuation',
  'audio reuse',
  'audio reference',
]

export const VISUAL_MARKERS: readonly VisualMarker[] = [
  'fully_preserved', 'partially_preserved', 'attribute_transfer', 'weak_reference',
]

export const AUDIO_MARKERS: readonly AudioMarker[] = [
  'fully_copy', 'partially_copy', 'reference', 'weak_reference',
]

/** Zdanie otwierające summary dla zadań montażowych. */
export const VIDEO_EDIT_SUMMARY_OPENING = 'The target video is an edited version of <Video 1>.'

const LABEL_TOKEN_PATTERN = /<(?:Subject|Picture|Video|Audio) \d+>/g

/**
 * Wszystkie tokeny etykiet (`<Subject 1>`, `<Picture 2>`, `<Video 1>`,
 * `<Audio 3>`) występujące w tekście, w kolejności wystąpienia i z
 * powtórzeniami — dokładnie ten kształt, który `labelText(label, true)`
 * (`compile/renderLabel.ts`) wypisuje do promptu.
 *
 * Jedna definicja: pyta nią reguła `REF_NO_NEW_LABELS_IN_SUMMARY`
 * (`validate/rules/ref.ts`) i pyta nią zadanie tłumaczące cały projekt
 * (`server/src/llm/tasks/translateAll.ts`), które musi odrzucić odpowiedź
 * modelu gubiącą albo zmyślającą token, ZANIM ta odpowiedź zapali reguły
 * czytające te tokeny (recenzja końcowa gałęzi, punkt 2). Dwie kopie wzorca
 * rozjechałyby się przy pierwszym rozszerzeniu słownika rodzajów etykiet.
 */
export function labelTokensIn(text: string): string[] {
  return text.match(LABEL_TOKEN_PATTERN) ?? []
}
