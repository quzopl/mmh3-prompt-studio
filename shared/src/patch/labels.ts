/**
 * Zamknięta lista identyfikatorów etykiet operacji. Każdy z nich jest KLUCZEM
 * tłumaczenia, który interfejs zamienia na zdanie w języku użytkownika
 * (`web/src/i18n/dict.ts`, `PatchReview.tsx`).
 *
 * Lista mieszka w `shared`, bo ma dwóch konsumentów po dwóch stronach granicy
 * pakietów: zadania serwera, które te etykiety PRODUKUJĄ, i słownik interfejsu,
 * który musi mieć tłumaczenie każdej z nich. Trzyma je razem test
 * `web/test/i18n.test.tsx` — bez niego nowa etykieta bez wpisu w słowniku
 * pokazałaby użytkownikowi surowy klucz („patchLabel.chatField") zamiast zdania,
 * i nikt by tego nie zauważył do pierwszego zrzutu ekranu.
 */
export const PATCH_LABEL_IDS = [
  'patchLabel.structure',
  'patchLabel.structureSkipped',
  'patchLabel.audioSoundscape',
  'patchLabel.audioMusic',
  'patchLabel.redactStyle',
  'patchLabel.redactSoundscape',
  'patchLabel.redactMusic',
  'patchLabel.redactSpeakerFull',
  'patchLabel.redactSpeakerShort',
  'patchLabel.redactShotText',
  'patchLabel.chatField',
  'patchLabel.translateLabelDefinition',
  'patchLabel.translateLabelRole',
  'patchLabel.translateRefSummary',
  'patchLabel.translateRetentionNote',
] as const

export type PatchLabelId = typeof PATCH_LABEL_IDS[number]
