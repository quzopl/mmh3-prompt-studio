import { describe, it, expect } from 'vitest'
import {
  renderSubjectDefinitions, renderSummary, renderRetention, emitRef,
} from '../../src/compile/emitRef.js'
import type { Project } from '../../src/model/types.js'

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'p', mode: 'REF',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'The target video uses a realistic multi-camera sitcom style with warm indoor lighting.',
  assets: [],
  labels: [
    { id: 'sub1', kind: 'subject', index: 1, assetIds: [], role: '', standalone: true,
      definition: 'is the coffee-shop environment in <Picture 1>.' },
    { id: 'aud1', kind: 'audio', index: 1, assetIds: [], role: '', standalone: true,
      definition: 'is the voice-timbre reference for <Subject 3> (S1).' },
  ],
  speakers: [],
  shots: [{
    id: 's1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the shot cuts to',
    composition: '', body: [{ kind: 'text', text: 'A medium shot establishes the room.' }],
    cameraMoves: [], dialogue: [], screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
  }],
  audio: { overallSoundscape: 'Soft indoor room tone.', nonDiegeticMusic: 'N/A' },
  ref: {
    taskTypes: ['reference generation', 'audio reference'],
    summaryText: 'The target video shows a scene.',
    retention: [
      { id: 'r1', labelId: 'sub1', scope: 'appears in [Shot 1]', marker: 'fully_preserved',
        note: 'the brick wall is retained.' },
      { id: 'r2', labelId: 'aud1', scope: '', marker: 'reference',
        note: 'its vocal timbre guides the delivery.' },
    ],
  },
}

describe('renderSubjectDefinitions', () => {
  it('dokleja etykietę przed treścią definicji, każda w osobnej linii', () => {
    expect(renderSubjectDefinitions(project)).toBe(
      '<Subject 1> is the coffee-shop environment in <Picture 1>.\n' +
      '<Audio 1> is the voice-timbre reference for <Subject 3> (S1).',
    )
  })

  it('pomija etykiety niesamodzielne', () => {
    const p = { ...project, labels: [{ ...project.labels[0]!, standalone: false }] }
    expect(renderSubjectDefinitions(p)).toBe('')
  })
})

describe('renderSummary', () => {
  it('łączy typy zadania przez spację-plus-spację w nawiasie kwadratowym', () => {
    expect(renderSummary(project))
      .toBe('[reference generation + audio reference] The target video shows a scene.')
  })
})

describe('renderRetention', () => {
  it('renderuje wpis z zakresem i bez zakresu', () => {
    expect(renderRetention(project)).toBe(
      '<Subject 1> (appears in [Shot 1]): fully_preserved - the brick wall is retained.\n' +
      '<Audio 1>: reference - its vocal timbre guides the delivery.',
    )
  })
})

describe('emitRef', () => {
  it('składa sześć sekcji w kolejności, każda z nagłówkiem w osobnej linii', () => {
    const out = emitRef(project)
    const headers = out.split('\n').filter(l => /^[a-z_]+:$/.test(l))
    expect(headers).toEqual([
      'subject_definitions:', 'summary:', 'retention_analysis:',
      'detailed_description:', 'overall_soundscape:', 'non_diegetic_music:',
    ])
  })

  it('umieszcza zdanie o stylu przed pierwszym ujęciem', () => {
    expect(emitRef(project)).toContain(
      'detailed_description:\n' +
      'The target video uses a realistic multi-camera sitcom style with warm indoor lighting.\n' +
      '[Shot 1] A medium shot establishes the room.',
    )
  })

  it('nie powtarza stylu wewnątrz ujęcia', () => {
    expect(emitRef(project)).not.toContain('[Shot 1] The target video uses')
  })

  it('każde ujęcie zaczyna nową linię', () => {
    const p: Project = {
      ...project,
      shots: [
        project.shots[0]!,
        { ...project.shots[0]!, id: 's2', index: 1, startMs: 3000,
          body: [{ kind: 'text', text: 'a close-up.' }] },
      ],
    }
    expect(emitRef(p)).toContain(
      '[Shot 1] A medium shot establishes the room.\n[Shot 2] At 00:03.000, the shot cuts to a close-up.',
    )
  })
})
