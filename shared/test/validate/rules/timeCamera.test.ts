import { describe, it, expect } from 'vitest'
import { timeRules } from '../../../src/validate/rules/time.js'
import { cameraRules } from '../../../src/validate/rules/camera.js'
import { validateWith } from '../../../src/validate/validate.js'
import { compile } from '../../../src/compile/compile.js'
import { t2vaProject } from '../../golden/fixtures/base.js'
import type { Project } from '../../../src/model/types.js'

const rules = [...timeRules, ...cameraRules]

/**
 * Część przypadków celowo psuje model tak, że kompilacja rzuca wyjątek
 * (segment wskazujący nieistniejący obiekt, nieznany typ ruchu). Walidator
 * ma wtedy nadal działać, więc kompilujemy defensywnie.
 */
const safeCompile = (p: Project) => {
  try {
    return compile(p)
  } catch {
    return { text: '', tokens: [] }
  }
}

const run = (p: Project) => validateWith(rules, p, safeCompile(p)).map(d => d.ruleId)

describe('reguły czasu i kamery', () => {
  it('nie zgłasza nic dla poprawnego projektu złotego', () => {
    expect(run(t2vaProject)).toEqual([])
  })

  it('DURATION_RANGE — długość poniżej 4 s', () => {
    expect(run({ ...t2vaProject, video: { ...t2vaProject.video, durationMs: 3000 } }))
      .toContain('DURATION_RANGE')
  })

  it('DURATION_RANGE — długość powyżej 15 s', () => {
    expect(run({ ...t2vaProject, video: { ...t2vaProject.video, durationMs: 16000 } }))
      .toContain('DURATION_RANGE')
  })

  it('SHOT1_NO_TIMESTAMP — pierwsze ujęcie nie zaczyna się od zera', () => {
    const shots = [...t2vaProject.shots]
    shots[0] = { ...shots[0]!, startMs: 500 }
    expect(run({ ...t2vaProject, shots })).toContain('SHOT1_NO_TIMESTAMP')
  })

  it('SHOT_TIME_MONOTONIC — czasy cięć nie rosną', () => {
    const shots = [...t2vaProject.shots]
    shots[1] = { ...shots[1]!, startMs: 0 }
    expect(run({ ...t2vaProject, shots })).toContain('SHOT_TIME_MONOTONIC')
  })

  it('SHOT_TIME_IN_RANGE — cięcie poza długością wideo', () => {
    const shots = [...t2vaProject.shots]
    shots[1] = { ...shots[1]!, startMs: 9000 }
    expect(run({ ...t2vaProject, shots })).toContain('SHOT_TIME_IN_RANGE')
  })

  it('SHOT_INDEX_SEQUENTIAL — dziura w numeracji ujęć', () => {
    const shots = [...t2vaProject.shots]
    shots[1] = { ...shots[1]!, index: 4 }
    expect(run({ ...t2vaProject, shots })).toContain('SHOT_INDEX_SEQUENTIAL')
  })

  it('SHOT_INDEX_SEQUENTIAL — powtórzony numer ujęcia', () => {
    const shots = [...t2vaProject.shots]
    shots[1] = { ...shots[1]!, index: 0 }
    expect(run({ ...t2vaProject, shots })).toContain('SHOT_INDEX_SEQUENTIAL')
  })

  it('FRAME_SNAP — czas nie leży na granicy klatki', () => {
    const shots = [...t2vaProject.shots]
    shots[1] = { ...shots[1]!, startMs: 5010 }
    expect(run({ ...t2vaProject, shots })).toContain('FRAME_SNAP')
  })

  it('CAM_VOCAB — typ ruchu spoza słownika', () => {
    const shots = [...t2vaProject.shots]
    shots[0] = {
      ...shots[0]!,
      cameraMoves: [{ ...shots[0]!.cameraMoves[0]!, type: 'barrel-roll' as never }],
    }
    expect(run({ ...t2vaProject, shots })).toContain('CAM_VOCAB')
  })

  it('CAM_IN_SHOT_BOUNDS — ruch wychodzi poza ujęcie', () => {
    const shots = [...t2vaProject.shots]
    shots[0] = {
      ...shots[0]!,
      cameraMoves: [{ ...shots[0]!.cameraMoves[0]!, endMs: 7000 }],
    }
    expect(run({ ...t2vaProject, shots })).toContain('CAM_IN_SHOT_BOUNDS')
  })

  it('CAM_REDUNDANT_MODIFIER — jawnie wpisana wartość domyślna', () => {
    const shots = [...t2vaProject.shots]
    shots[0] = {
      ...shots[0]!,
      cameraMoves: [{ ...shots[0]!.cameraMoves[0]!, customPhrase: 'The camera pushes in with medium amplitude' }],
    }
    expect(run({ ...t2vaProject, shots })).toContain('CAM_REDUNDANT_MODIFIER')
  })

  it('BODY_REFS_COMPLETE — ruch kamery nieprzywołany w body', () => {
    const shots = [...t2vaProject.shots]
    shots[0] = {
      ...shots[0]!,
      body: shots[0]!.body.filter(s => s.kind !== 'camera'),
    }
    expect(run({ ...t2vaProject, shots })).toContain('BODY_REFS_COMPLETE')
  })

  it('BODY_REFS_COMPLETE — segment wskazuje nieistniejący obiekt', () => {
    const shots = [...t2vaProject.shots]
    shots[1] = { ...shots[1]!, body: [{ kind: 'dialogue', eventId: 'brak' }] }
    expect(run({ ...t2vaProject, shots })).toContain('BODY_REFS_COMPLETE')
  })

  it('TRANSITION_EXPLICIT — przejście inne niż cięcie', () => {
    const shots = [...t2vaProject.shots]
    shots[1] = { ...shots[1]!, cutType: 'cross-dissolve' }
    expect(run({ ...t2vaProject, shots })).toContain('TRANSITION_EXPLICIT')
  })

  it('CUT_SHOULD_BE_MOVE — sąsiednie ujęcia różnią się tylko planem', () => {
    const shots = [...t2vaProject.shots]
    shots[0] = { ...shots[0]!, composition: 'medium shot of the counter' }
    shots[1] = { ...shots[1]!, composition: 'close-up shot of the counter' }
    expect(run({ ...t2vaProject, shots })).toContain('CUT_SHOULD_BE_MOVE')
  })
})
