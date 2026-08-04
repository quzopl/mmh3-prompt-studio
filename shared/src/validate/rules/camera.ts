import type { Project, Shot } from '../../model/types.js'
import { CAMERA_MOTIONS } from '../../vocab/camera.js'
import { defineRule, makeDiagnostic, type Diagnostic, type Rule } from '../types.js'

const KNOWN_TYPES = new Set(CAMERA_MOTIONS.map(m => m.type))

/** Słowa oznaczające wielkość planu — używane przez CUT_SHOULD_BE_MOVE. */
const SHOT_SIZE_WORDS = [
  'extreme close-up', 'close-up', 'medium-wide', 'medium', 'wide', 'full', 'long', 'close',
]

const stripShotSize = (composition: string): string => {
  let out = composition.toLowerCase()
  for (const word of SHOT_SIZE_WORDS) out = out.replaceAll(word, '')
  return out.replace(/\s+/g, ' ').trim()
}

const shotSizeOf = (composition: string): string | null =>
  SHOT_SIZE_WORDS.find(word => composition.toLowerCase().includes(word)) ?? null

const shotEnd = (project: Project, shot: Shot): number => {
  const next = project.shots.find(s => s.index === shot.index + 1)
  return next ? next.startMs : project.video.durationMs
}

const camVocab = defineRule({
  id: 'CAM_VOCAB',
  severity: 'error',
  guideRef: 'guide_base §4.3',
  run: ({ project }) => project.shots.flatMap(shot =>
    shot.cameraMoves
      .filter(move => !KNOWN_TYPES.has(move.type))
      .map(move => makeDiagnostic(
        camVocab,
        { kind: 'camera', id: move.id },
        `Typ ruchu kamery "${move.type}" nie występuje w słowniku guide'a.`,
        `Camera motion type "${move.type}" is not in the guide vocabulary.`,
      )),
  ),
})

const camInShotBounds = defineRule({
  id: 'CAM_IN_SHOT_BOUNDS',
  severity: 'warning',
  guideRef: 'guide_base §4.3',
  run: ({ project }) => project.shots.flatMap(shot => {
    const end = shotEnd(project, shot)
    return shot.cameraMoves
      .filter(move => move.startMs < shot.startMs || move.endMs > end)
      .map(move => makeDiagnostic(
        camInShotBounds,
        { kind: 'camera', id: move.id },
        `Ruch kamery wykracza poza granice ujęcia ${shot.index + 1}.`,
        `The camera move extends beyond the bounds of shot ${shot.index + 1}.`,
      ))
  }),
})

const camRedundantModifier = defineRule({
  id: 'CAM_REDUNDANT_MODIFIER',
  severity: 'warning',
  guideRef: 'guide_base §4.3',
  run: ({ project }) => project.shots.flatMap(shot =>
    shot.cameraMoves
      .filter(move => /medium amplitude|normal speed/i.test(
        `${move.customPhrase ?? ''} ${move.target ?? ''}`,
      ))
      .map(move => makeDiagnostic(
        camRedundantModifier,
        { kind: 'camera', id: move.id },
        'Średnia amplituda i normalna prędkość powinny być pominięte, nie zapisane wprost.',
        'Medium amplitude and normal speed should be omitted, not written out.',
      )),
  ),
})

const bodyRefsComplete = defineRule({
  id: 'BODY_REFS_COMPLETE',
  severity: 'error',
  guideRef: 'guide_base §4.3, §4.4',
  run: ({ project }) => project.shots.flatMap(shot => {
    const out: Diagnostic[] = []
    const usedMoves = shot.body.filter(s => s.kind === 'camera').map(s => s.moveId)
    const usedDialogue = shot.body.filter(s => s.kind === 'dialogue').map(s => s.eventId)

    for (const move of shot.cameraMoves) {
      const count = usedMoves.filter(id => id === move.id).length
      if (count !== 1) {
        out.push(makeDiagnostic(
          bodyRefsComplete,
          { kind: 'camera', id: move.id },
          `Ruch kamery jest przywołany w treści ujęcia ${count} raz(y) zamiast dokładnie raz.`,
          `The camera move is referenced ${count} time(s) in the shot body instead of exactly once.`,
        ))
      }
    }

    for (const event of shot.dialogue) {
      const count = usedDialogue.filter(id => id === event.id).length
      if (count !== 1) {
        out.push(makeDiagnostic(
          bodyRefsComplete,
          { kind: 'dialogue', id: event.id },
          `Kwestia dialogowa jest przywołana w treści ujęcia ${count} raz(y) zamiast dokładnie raz.`,
          `The dialogue event is referenced ${count} time(s) in the shot body instead of exactly once.`,
        ))
      }
    }

    for (const id of usedMoves) {
      if (!shot.cameraMoves.some(m => m.id === id)) {
        out.push(makeDiagnostic(
          bodyRefsComplete, { kind: 'shot', id: shot.id },
          `Segment wskazuje nieistniejący ruch kamery: ${id}.`,
          `A segment points to a missing camera move: ${id}.`,
        ))
      }
    }
    for (const id of usedDialogue) {
      if (!shot.dialogue.some(d => d.id === id)) {
        out.push(makeDiagnostic(
          bodyRefsComplete, { kind: 'shot', id: shot.id },
          `Segment wskazuje nieistniejącą kwestię dialogową: ${id}.`,
          `A segment points to a missing dialogue event: ${id}.`,
        ))
      }
    }

    return out
  }),
})

const cutShouldBeMove = defineRule({
  id: 'CUT_SHOULD_BE_MOVE',
  severity: 'hint',
  guideRef: 'guide_base §4.2',
  run: ({ project }) => {
    const shots = [...project.shots].sort((a, b) => a.index - b.index)
    return shots.flatMap((shot, i) => {
      const prev = shots[i - 1]
      if (!prev || !shot.composition || !prev.composition) return []
      const context = stripShotSize(prev.composition)
      // Sam plan bez opisu treści kadru ("medium-wide" vs "close-up") nie
      // wystarcza do orzeczenia, że ujęcia pokazują to samo.
      if (!context) return []
      const sameContext = context === stripShotSize(shot.composition)
      const differentSize = shotSizeOf(prev.composition) !== shotSizeOf(shot.composition)
      if (!sameContext || !differentSize) return []
      return [makeDiagnostic(
        cutShouldBeMove,
        { kind: 'shot', id: shot.id },
        'Ujęcia różnią się tylko wielkością planu — guide zaleca wtedy ruch kamery zamiast cięcia.',
        'These shots differ only in shot size — the guide prefers camera motion over a cut here.',
      )]
    })
  },
})

const transitionExplicit = defineRule({
  id: 'TRANSITION_EXPLICIT',
  severity: 'hint',
  guideRef: 'guide_base §4.2',
  run: ({ project }) => project.shots
    .filter(shot => shot.index > 0 && shot.cutType !== 'cut')
    .map(shot => makeDiagnostic(
      transitionExplicit,
      { kind: 'shot', id: shot.id },
      `Przejście "${shot.cutType}" guide dopuszcza tylko na wyraźne życzenie — domyślne jest zwykłe cięcie.`,
      `The "${shot.cutType}" transition is allowed only when explicitly requested — a plain cut is the default.`,
    )),
})

export const cameraRules: Rule[] = [
  camVocab, camInShotBounds, camRedundantModifier, bodyRefsComplete,
  cutShouldBeMove, transitionExplicit,
]
