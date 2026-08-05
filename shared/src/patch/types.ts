import type { Shot } from '../model/types.js'

/**
 * Łatka do modelu domeny: LLM nigdy nie pisze tekstu wyjściowego bezpośrednio,
 * tylko zwraca listę tych operacji, z których użytkownik przyjmuje albo
 * odrzuca każdą osobno. `replaceShots` jest celowo gruba (patrz komentarz przy
 * definicji) — pozostałe są drobne, bo tam wybiórcze przyjmowanie ma sens.
 *
 * Celowo nie ma operacji dopisującej/usuwającej pojedynczy segment `body`:
 * gdyby była, model mógłby wprowadzić obiekt bez segmentu albo segment bez
 * obiektu. `replaceShots` niesie ujęcia w całości, więc obie strony
 * (segmenty i obiekty, które opisują) przychodzą razem.
 *
 * `setLabelField` i `setRetentionText` doszły w zadaniu 15 (fix round 1) —
 * pierwsza wersja tego zadania zamykała unię na czterech ówczesnych zadaniach
 * językowych (zadanie 4: „Cztery zadania językowe potrzebują dokładnie tylu
 * rodzajów"). Piąte zadanie (redakcja całego projektu) potrzebuje dwóch
 * kolejnych — i TYLKO tych dwóch: `Label.definition`/`Label.role` i
 * `RetentionEntry.note`/`ref.summaryText` rzeczywiście trafiają do
 * skompilowanego promptu (`emitRef`, WYŁĄCZNIE w trybie REF — zob.
 * `shared/src/compile/emitRef.ts`). `Shot.composition` i
 * `DiegeticSfx.description` NIE mają tu odpowiednika mimo bycia prozą —
 * żadne z nich nie trafia do żadnego skompilowanego promptu w żadnym trybie
 * (sprawdzone wprost: `composition`/`diegeticSfx` nie występują nigdzie w
 * `shared/src/compile/*.ts`) — dopisanie dla nich operacji tłumaczyłoby
 * tekst do promptu, którego nikt nie zobaczy.
 */
export type PatchOp =
  | { kind: 'replaceShots'; id: string; label: string; shots: Shot[] }
  | { kind: 'setShotText'; id: string; label: string; shotId: string; segmentIndex: number; text: string }
  | { kind: 'setAudio'; id: string; label: string; field: 'overallSoundscape' | 'nonDiegeticMusic'; text: string }
  | { kind: 'setStyle'; id: string; label: string; text: string }
  | { kind: 'setSpeakerDescriptor'; id: string; label: string; speakerId: string; field: 'fullDescriptor' | 'shortDescriptor'; text: string }
  | { kind: 'setLabelField'; id: string; label: string; labelId: string; field: 'definition' | 'role'; text: string }
  | {
      kind: 'setRetentionText'
      id: string
      label: string
      /**
       * `ref.summaryText` jest polem SINGLETONOWYM (jedno na projekt, jak
       * `style`) — `{ kind: 'summary' }` go adresuje bez identyfikatora.
       * `RetentionEntry.note` jest polem PER-WPIS (jak opis mówcy) —
       * `{ kind: 'entry'; entryId }` wskazuje konkretny wpis. Jeden rodzaj
       * operacji dla obu, bo oba pola razem tworzą treść jednej sekcji
       * promptu REF (`retention_analysis`) i dostały wspólną kategorię w
       * rozstrzygnięciu zadania 15.
       */
      scope: { kind: 'summary' } | { kind: 'entry'; entryId: string }
      text: string
    }

export interface ProjectPatch {
  ops: PatchOp[]
}
