export const FPS = 24 as const
export const MIN_DURATION_MS = 4000
export const MAX_DURATION_MS = 15000

export type Mode = 'T2VA' | 'I2VA' | 'FL2VA' | 'L2VA' | 'REF'
export type Aspect = '16:9' | '4:3' | '1:1' | '9:16'

export type CameraMotion =
  | 'zoom-in' | 'zoom-out'
  | 'push-in' | 'pull-out'
  | 'pan-left' | 'pan-right'
  | 'truck-left' | 'truck-right'
  | 'tilt-up' | 'tilt-down'
  | 'pedestal-up' | 'pedestal-down'
  | 'arc' | 'tracking' | 'static'
  | 'shake-slightly' | 'shake-strongly'
  | 'pov' | 'roll-cw' | 'roll-ccw'

export type Amplitude = 'small' | 'large'
export type Speed = 'slow' | 'fast'

export interface CameraMove {
  id: string
  type: CameraMotion
  amplitude?: Amplitude
  speed?: Speed
  /** Dopełnienie frazy, np. "toward the folded letter in her hands". */
  target?: string
  /** Pełne nadpisanie frazy, gdy proza wymaga innego brzmienia. */
  customPhrase?: string
  startMs: number
  endMs: number
}

export interface Speaker {
  id: string
  /** Renderowane ID bez nawiasów, np. "S1". */
  code: string
  characterType: string
  age: string
  gender: string
  pitch: string
  timbre: string
  rate: string
  accent: string
  onScreen: boolean
  /** Domyślny opis przy pierwszym wystąpieniu. */
  fullDescriptor: string
  /** Domyślny opis przy kolejnych wystąpieniach. */
  shortDescriptor: string
}

export interface DialogueEvent {
  id: string
  speakerIds: string[]
  /** Czasownik z określeniem sposobu podania, np. "says", "exclaims with light annoyance". */
  verb: string
  /** Znak oddzielający czasownik od bloku <d>. */
  punctuation: ':' | ','
  language: string
  /** Treść verbatim. Nigdy nie modyfikowana przez kod. */
  text: string
  voiceover: boolean
  /** Zdanie o zamkniętych ustach, wymagane po bloku <d> voiceoveru. */
  lipsClause?: string
  sceneTransBefore: boolean
  sceneTransAfter: boolean
  continuityPhrase?: string
  cutoff: boolean
  startMs: number
  endMs: number
}

export interface ScreenText {
  id: string
  text: string
}

export interface DiegeticSfx {
  id: string
  description: string
  startMs: number
  endMs: number
}

export type LabelKind = 'subject' | 'picture' | 'video' | 'audio'

export interface Label {
  id: string
  kind: LabelKind
  index: number
  assetIds: string[]
  definition: string
  role: string
  standalone: boolean
}

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'camera'; moveId: string }
  | { kind: 'speaker'; speakerIds: string[]; descriptor?: string; form: 'full' | 'short' | 'idOnly' }
  | { kind: 'dialogue'; eventId: string }
  | { kind: 'label'; labelId: string; speakerId?: string; bracketed: boolean }
  | { kind: 'screenText'; id: string }

export type CutType = 'cut' | 'cross-dissolve' | 'fade' | 'wipe'

export type CutPhrase =
  | 'the camera cuts to'
  | 'the shot cuts to'
  | 'the shot transitions to'
  | 'the shot changes to'
  | 'the shot switches to'

export type Anchor = 'picture-first' | 'picture-last' | 'keyframe'

export interface Shot {
  id: string
  index: number
  startMs: number
  cutType: CutType
  cutPhrase: CutPhrase
  composition: string
  body: Segment[]
  cameraMoves: CameraMove[]
  dialogue: DialogueEvent[]
  screenText: ScreenText[]
  diegeticSfx: DiegeticSfx[]
  labelRefs: string[]
  /**
   * Kotwice klatek referencyjnych tego ujęcia. Tryb FL2VA w swoim głównym
   * przypadku to jedno ujęcie zakotwiczone jednocześnie na pierwszej
   * i ostatniej klatce, czego pojedyncza wartość nie wyrażała.
   */
  anchors: Anchor[]
}

export interface Asset {
  id: string
  kind: 'image' | 'video' | 'audio'
  path: string
  fileName: string
}

export type RefTaskType =
  | 'keyframe completion'
  | 'reference generation'
  | 'video editing'
  | 'video continuation'
  | 'audio reuse'
  | 'audio reference'

export type VisualMarker =
  | 'fully_preserved' | 'partially_preserved' | 'attribute_transfer' | 'weak_reference'

export type AudioMarker =
  | 'fully_copy' | 'partially_copy' | 'reference' | 'weak_reference'

export interface RetentionEntry {
  id: string
  labelId: string
  /** Treść nawiasu, np. "appears in [Shot 1], [Shot 3]". Pusty ciąg = bez nawiasu. */
  scope: string
  marker: VisualMarker | AudioMarker
  note: string
}

export interface Project {
  schemaVersion: 1
  id: string
  name: string
  mode: Mode
  video: { durationMs: number; fps: typeof FPS; aspect: Aspect; resolution: string }
  style: string
  assets: Asset[]
  labels: Label[]
  speakers: Speaker[]
  shots: Shot[]
  audio: { overallSoundscape: string; nonDiegeticMusic: string }
  ref: { taskTypes: RefTaskType[]; summaryText: string; retention: RetentionEntry[] }
}
