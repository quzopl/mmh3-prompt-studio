import type { Shot } from '../model/types.js'

/**
 * Łatka do modelu domeny: LLM nigdy nie pisze tekstu wyjściowego bezpośrednio,
 * tylko zwraca listę tych operacji, z których użytkownik przyjmuje albo
 * odrzuca każdą osobno. `replaceShots` jest celowo gruba (patrz komentarz przy
 * definicji) — pozostałe cztery są drobne, bo tam wybiórcze przyjmowanie ma
 * sens.
 *
 * Celowo nie ma operacji dopisującej/usuwającej pojedynczy segment `body`:
 * gdyby była, model mógłby wprowadzić obiekt bez segmentu albo segment bez
 * obiektu. `replaceShots` niesie ujęcia w całości, więc obie strony
 * (segmenty i obiekty, które opisują) przychodzą razem.
 */
export type PatchOp =
  | { kind: 'replaceShots'; id: string; label: string; shots: Shot[] }
  | { kind: 'setShotText'; id: string; label: string; shotId: string; segmentIndex: number; text: string }
  | { kind: 'setAudio'; id: string; label: string; field: 'overallSoundscape' | 'nonDiegeticMusic'; text: string }
  | { kind: 'setStyle'; id: string; label: string; text: string }
  | { kind: 'setSpeakerDescriptor'; id: string; label: string; speakerId: string; field: 'fullDescriptor' | 'shortDescriptor'; text: string }

export interface ProjectPatch {
  ops: PatchOp[]
}
