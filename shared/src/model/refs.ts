export type ObjectRefKind =
  | 'project' | 'shot' | 'camera' | 'dialogue' | 'speaker'
  | 'label' | 'screenText' | 'sfx' | 'audio' | 'retention'

export interface ObjectRef {
  kind: ObjectRefKind
  id: string
}

export interface Token {
  start: number
  end: number
  ref: ObjectRef
}
