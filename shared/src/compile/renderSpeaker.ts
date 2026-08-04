import type { Segment, Speaker } from '../model/types.js'

type SpeakerSegment = Extract<Segment, { kind: 'speaker' }>

export function renderSpeakerSegment(seg: SpeakerSegment, speakers: Speaker[]): string {
  const speaker = speakers.find(s => s.id === seg.speakerId)
  if (!speaker) throw new Error(`Brak mówcy o id ${seg.speakerId}`)
  const ids = `(${speaker.code})`
  if (seg.form === 'idOnly') return ids
  const descriptor = seg.descriptor
    ?? (seg.form === 'full' ? speaker.fullDescriptor : speaker.shortDescriptor)
  return `${descriptor} ${ids}`
}

/** Złożone ID dla grupy mówiącej jednocześnie: (S1,S2). */
export function renderSpeakerGroup(codes: string[]): string {
  return `(${codes.join(',')})`
}
