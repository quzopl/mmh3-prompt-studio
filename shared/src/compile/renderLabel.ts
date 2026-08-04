import type { Label, LabelKind, Segment, Speaker } from '../model/types.js'

const KIND_NAME: Record<LabelKind, string> = {
  subject: 'Subject',
  picture: 'Picture',
  video: 'Video',
  audio: 'Audio',
}

export function labelText(label: Label, bracketed: boolean): string {
  const core = `${KIND_NAME[label.kind]} ${label.index}`
  return bracketed ? `<${core}>` : core
}

type LabelSegment = Extract<Segment, { kind: 'label' }>

export function renderLabelSegment(
  seg: LabelSegment,
  labels: Label[],
  speakers: Speaker[],
): string {
  const label = labels.find(l => l.id === seg.labelId)
  if (!label) throw new Error(`Brak etykiety o id ${seg.labelId}`)
  const base = labelText(label, seg.bracketed)
  if (!seg.speakerId) return base
  const speaker = speakers.find(s => s.id === seg.speakerId)
  if (!speaker) throw new Error(`Brak mówcy o id ${seg.speakerId}`)
  return `${base} (${speaker.code})`
}
