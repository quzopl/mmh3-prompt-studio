import type { Segment, Speaker } from '../model/types.js'

type SpeakerSegment = Extract<Segment, { kind: 'speaker' }>

export function renderSpeakerSegment(seg: SpeakerSegment, speakers: Speaker[]): string {
  const resolved = seg.speakerIds.map(id => {
    const speaker = speakers.find(s => s.id === id)
    if (!speaker) throw new Error(`Brak mówcy o id ${id}`)
    return speaker
  })
  const first = resolved[0]!
  const ids = renderSpeakerGroup(resolved.map(s => s.code))
  if (seg.form === 'idOnly') return ids
  const descriptor = seg.descriptor
    ?? (seg.form === 'full' ? first.fullDescriptor : first.shortDescriptor)
  return `${descriptor} ${ids}`
}

/** Złożone ID dla grupy mówiącej jednocześnie: (S1,S2). */
export function renderSpeakerGroup(codes: string[]): string {
  return `(${codes.join(',')})`
}
