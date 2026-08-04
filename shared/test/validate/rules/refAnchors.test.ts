import { describe, it, expect } from 'vitest'
import { refRules } from '../../../src/validate/rules/ref.js'
import { anchorRules } from '../../../src/validate/rules/anchors.js'
import { validateWith } from '../../../src/validate/validate.js'
import { compile } from '../../../src/compile/compile.js'
import { refProject } from '../../golden/fixtures/ref.js'
import { t2vaProject, i2vaProject, fl2vaProject, l2vaProject } from '../../golden/fixtures/base.js'
import type { Project } from '../../../src/model/types.js'

/**
 * Część przypadków celowo psuje model tak, że kompilacja rzuca wyjątek
 * (segment wskazujący usuniętą etykietę). Walidator ma wtedy nadal działać,
 * więc kompilujemy defensywnie — dokładnie jak w testach reguł czasu i kamery.
 */
const safeCompile = (p: Project) => {
  try {
    return compile(p)
  } catch {
    return { text: '', tokens: [] }
  }
}

const runRef = (p: Project) => validateWith(refRules, p, safeCompile(p)).map(d => d.ruleId)
const runAnchors = (p: Project) => validateWith(anchorRules, p, safeCompile(p)).map(d => d.ruleId)

describe('reguły trybu REF', () => {
  it('złoty przykład zgłasza wyłącznie ostrzeżenie o liczbie słów', () => {
    expect(runRef(refProject)).toEqual(['REF_WORD_COUNT'])
  })

  it('REF_RETENTION_COMPLETE — brak wpisu dla etykiety', () => {
    const retention = refProject.ref.retention.slice(0, 4)
    expect(runRef({ ...refProject, ref: { ...refProject.ref, retention } }))
      .toContain('REF_RETENTION_COMPLETE')
  })

  it('REF_LABEL_DEFINED — segment ujęcia wskazuje niezdefiniowaną etykietę', () => {
    const labels = refProject.labels.filter(l => l.id !== 'sub2')
    const retention = refProject.ref.retention.filter(r => r.labelId !== 'sub2')
    expect(runRef({ ...refProject, labels, ref: { ...refProject.ref, retention } }))
      .toContain('REF_LABEL_DEFINED')
  })

  it('REF_MARKER_VOCAB — marker wizualny przy etykiecie audio', () => {
    const retention = refProject.ref.retention.map(r =>
      r.labelId === 'aud1' ? { ...r, marker: 'fully_preserved' as const } : r)
    expect(runRef({ ...refProject, ref: { ...refProject.ref, retention } }))
      .toContain('REF_MARKER_VOCAB')
  })

  it('REF_NO_SPEAKER_IN_RETENTION — identyfikator mówcy w retention_analysis', () => {
    const retention = refProject.ref.retention.map(r =>
      r.id === 'r5' ? { ...r, note: 'the voice of <Subject 3> (S1) is referenced.' } : r)
    expect(runRef({ ...refProject, ref: { ...refProject.ref, retention } }))
      .toContain('REF_NO_SPEAKER_IN_RETENTION')
  })

  it('REF_TASK_TYPES — powtórzony typ zadania', () => {
    const taskTypes = ['reference generation', 'reference generation'] as const
    expect(runRef({ ...refProject, ref: { ...refProject.ref, taskTypes: [...taskTypes] } }))
      .toContain('REF_TASK_TYPES')
  })

  it('REF_TASK_TYPES — pusta lista typów', () => {
    expect(runRef({ ...refProject, ref: { ...refProject.ref, taskTypes: [] } }))
      .toContain('REF_TASK_TYPES')
  })

  it('REF_ASSET_LIMITS — więcej niż dziewięć obrazów', () => {
    const assets = Array.from({ length: 10 }, (_, i) => ({
      id: `a${i}`, kind: 'image' as const, path: `/tmp/a${i}.png`, fileName: `a${i}.png`,
    }))
    expect(runRef({ ...refProject, assets })).toContain('REF_ASSET_LIMITS')
  })

  it('REF_VIDEO_EDIT_OPENING — montaż wideo bez wymaganego otwarcia summary', () => {
    const ref = { ...refProject.ref, taskTypes: ['video editing' as const] }
    expect(runRef({ ...refProject, ref })).toContain('REF_VIDEO_EDIT_OPENING')
  })

  it('REF_VIDEO_EDIT_OPENING — poprawne otwarcie nie zgłasza nic', () => {
    const ref = {
      ...refProject.ref,
      taskTypes: ['video editing' as const],
      summaryText: `The target video is an edited version of <Video 1>. ${refProject.ref.summaryText}`,
    }
    expect(runRef({ ...refProject, ref })).not.toContain('REF_VIDEO_EDIT_OPENING')
  })

  it('STYLE_REQUIRED — brak zdania o stylu w trybie REF', () => {
    expect(runRef({ ...refProject, style: '' })).toContain('STYLE_REQUIRED')
  })

  it('STYLE_REQUIRED — tryb bazowy bez stylu', () => {
    expect(runRef({ ...t2vaProject, style: '' })).toContain('STYLE_REQUIRED')
  })

  it('REF_NO_NEW_LABELS_IN_SUMMARY — etykieta niezdefiniowana', () => {
    const summaryText = `${refProject.ref.summaryText} It also uses <Subject 9>.`
    expect(runRef({ ...refProject, ref: { ...refProject.ref, summaryText } }))
      .toContain('REF_NO_NEW_LABELS_IN_SUMMARY')
  })

  it('REF_LABEL_USED — etykieta zdefiniowana, ale nigdzie nieużyta', () => {
    const labels = [...refProject.labels, {
      id: 'vid9', kind: 'video' as const, index: 9, assetIds: [], standalone: true,
      role: '', definition: 'is an unused source video.',
    }]
    const retention = [...refProject.ref.retention, {
      id: 'r9', labelId: 'vid9', scope: '', marker: 'weak_reference' as const, note: 'nieużyte.',
    }]
    expect(runRef({ ...refProject, labels, ref: { ...refProject.ref, retention } }))
      .toContain('REF_LABEL_USED')
  })

  it('reguły REF milczą w trybach bazowych', () => {
    expect(runRef(t2vaProject)).toEqual([])
  })

  it('REF_WORD_COUNT jest wskazówką, nie ostrzeżeniem', () => {
    const diagnostics = validateWith(refRules, refProject, compile(refProject))
    const found = diagnostics.find(d => d.ruleId === 'REF_WORD_COUNT')
    expect(found).toBeDefined()
    expect(found!.severity).toBe('hint')
  })
})

describe('reguły kotwic', () => {
  it('nie zgłaszają nic dla poprawnych projektów złotych', () => {
    expect(runAnchors(t2vaProject)).toEqual([])
    expect(runAnchors(i2vaProject)).toEqual([])
    expect(runAnchors(fl2vaProject)).toEqual([])
    expect(runAnchors(l2vaProject)).toEqual([])
  })

  it('ANCHOR_REQUIRED — I2VA bez etykiety obrazu', () => {
    expect(runAnchors({ ...i2vaProject, labels: [] })).toContain('ANCHOR_REQUIRED')
  })

  it('ANCHOR_REQUIRED — FL2VA z jednym obrazem', () => {
    expect(runAnchors({ ...fl2vaProject, labels: [fl2vaProject.labels[0]!] }))
      .toContain('ANCHOR_REQUIRED')
  })

  it('ANCHOR_REQUIRED — FL2VA bez kotwicy końcowej', () => {
    const shots = fl2vaProject.shots.map(s => ({ ...s, anchors: ['picture-first' as const] }))
    expect(runAnchors({ ...fl2vaProject, shots })).toContain('ANCHOR_REQUIRED')
  })

  it('ANCHOR_REQUIRED — FL2VA z obiema kotwicami w jednym ujęciu przechodzi', () => {
    expect(runAnchors(fl2vaProject)).toEqual([])
  })

  it('FL2VA_PREFER_SINGLE_SHOT — dwa ujęcia', () => {
    const shots = [
      fl2vaProject.shots[0]!,
      { ...fl2vaProject.shots[0]!, id: 's2', index: 1, startMs: 4000, body: [{ kind: 'text' as const, text: 'more.' }], cameraMoves: [] },
    ]
    expect(runAnchors({ ...fl2vaProject, shots })).toContain('FL2VA_PREFER_SINGLE_SHOT')
  })

  it('L2VA_ANCHOR_LAST_SHOT — kotwica nie w ostatnim ujęciu', () => {
    const shots = [
      l2vaProject.shots[0]!,
      { ...l2vaProject.shots[0]!, id: 's2', index: 1, startMs: 3000, anchors: [], body: [{ kind: 'text' as const, text: 'more.' }], cameraMoves: [] },
    ]
    expect(runAnchors({ ...l2vaProject, shots })).toContain('L2VA_ANCHOR_LAST_SHOT')
  })
})
