import type { Project, Shot } from '../model/types.js'
import { formatShotTime } from '../time/format.js'
import { TRANSITION_PHRASES } from '../vocab/cutPhrases.js'
import { renderCameraMove } from './renderCamera.js'
import { renderSpeakerSegment } from './renderSpeaker.js'
import { renderDialogue } from './renderDialogue.js'
import { renderLabelSegment } from './renderLabel.js'

export function renderSegments(shot: Shot, project: Project): string {
  return shot.body.map(seg => {
    switch (seg.kind) {
      case 'text':
        return seg.text
      case 'camera': {
        const move = shot.cameraMoves.find(m => m.id === seg.moveId)
        if (!move) throw new Error(`Segment kamery wskazuje nieistniejący ruch: ${seg.moveId}`)
        return renderCameraMove(move)
      }
      case 'speaker':
        return renderSpeakerSegment(seg, project.speakers)
      case 'dialogue': {
        const event = shot.dialogue.find(d => d.id === seg.eventId)
        if (!event) throw new Error(`Segment dialogu wskazuje nieistniejące zdarzenie: ${seg.eventId}`)
        return renderDialogue(event)
      }
      case 'label':
        return renderLabelSegment(seg, project.labels, project.speakers)
      case 'screenText': {
        const st = shot.screenText.find(t => t.id === seg.id)
        if (!st) throw new Error(`Segment tekstu ekranowego wskazuje nieistniejący wpis: ${seg.id}`)
        return `"${st.text}"`
      }
    }
  }).join('')
}

/**
 * Nagłówek ujęcia zgodny z guide: [Shot 1] nigdy nie dostaje timestampu,
 * kolejne ujęcia zaczynają się od czasu cięcia i frazy przejścia.
 */
export function renderShot(
  shot: Shot,
  project: Project,
  opts: { includeStyle: boolean },
): string {
  const number = shot.index + 1
  const transition = shot.cutType === 'cut'
    ? shot.cutPhrase
    : TRANSITION_PHRASES[shot.cutType]
  const head = shot.index === 0
    ? `[Shot ${number}] `
    : `[Shot ${number}] At ${formatShotTime(shot.startMs)}, ${transition} `
  const stylePrefix = shot.index === 0 && opts.includeStyle && project.style
    ? `${project.style}, `
    : ''
  return `${head}${stylePrefix}${renderSegments(shot, project)}`
}
