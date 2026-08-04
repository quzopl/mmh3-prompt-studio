import type { Project } from '../model/types.js'
import type { ObjectRef, Token } from '../model/refs.js'
import { renderCameraMove } from './renderCamera.js'
import { renderDialogue } from './renderDialogue.js'
import { renderSpeakerSegment } from './renderSpeaker.js'
import { renderLabelSegment } from './renderLabel.js'
import { refSectionOffsets } from './emitRef.js'

/**
 * Lokalizuje wyrenderowane fragmenty w gotowym tekście, skanując w przód.
 * Emitery produkują fragmenty w tej samej kolejności, w jakiej je tu odwiedzamy,
 * więc pojedynczy przesuwający się kursor wystarcza. Fragment, którego nie da się
 * znaleźć, jest pomijany — mapa tokenów jest pomocą nawigacyjną, nie źródłem prawdy.
 */
export function buildTokens(project: Project, text: string): Token[] {
  const tokens: Token[] = []
  // W trybie REF etykiety ujęć pojawiają się także wcześniej, w retention_analysis.
  // Start liczymy z długości sekcji, a nie z wyszukiwania tekstu, żeby treść
  // wpisana przez użytkownika nie mogła przesunąć kotwicy.
  let cursor = 0
  if (project.mode === 'REF') {
    const detailed = refSectionOffsets(project).find(s => s.name === 'detailed_description')
    if (detailed) cursor = detailed.start
  }

  const locate = (fragment: string, ref: ObjectRef): void => {
    if (!fragment) return
    const start = text.indexOf(fragment, cursor)
    if (start === -1) return
    tokens.push({ start, end: start + fragment.length, ref })
    cursor = start + fragment.length
  }

  for (const shot of [...project.shots].sort((a, b) => a.index - b.index)) {
    locate(`[Shot ${shot.index + 1}]`, { kind: 'shot', id: shot.id })

    for (const seg of shot.body) {
      switch (seg.kind) {
        case 'camera': {
          const move = shot.cameraMoves.find(m => m.id === seg.moveId)
          if (move) locate(renderCameraMove(move), { kind: 'camera', id: move.id })
          break
        }
        case 'dialogue': {
          const event = shot.dialogue.find(d => d.id === seg.eventId)
          if (event) locate(renderDialogue(event), { kind: 'dialogue', id: event.id })
          break
        }
        case 'speaker':
          // Grupa mówiąca jednocześnie renderuje się jako jeden fragment;
          // token wskazuje pierwszego mówcę z grupy.
          locate(renderSpeakerSegment(seg, project.speakers), { kind: 'speaker', id: seg.speakerIds[0]! })
          break
        case 'label':
          locate(renderLabelSegment(seg, project.labels, project.speakers), { kind: 'label', id: seg.labelId })
          break
        case 'screenText': {
          const st = shot.screenText.find(t => t.id === seg.id)
          if (st) locate(`"${st.text}"`, { kind: 'screenText', id: st.id })
          break
        }
        case 'text':
          break
      }
    }
  }

  return tokens
}
