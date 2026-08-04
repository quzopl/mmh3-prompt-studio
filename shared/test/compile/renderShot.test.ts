import { describe, it, expect } from 'vitest'
import { renderShot } from '../../src/compile/renderShot.js'
import type { Project, Shot } from '../../src/model/types.js'

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'p', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic',
  assets: [], labels: [],
  speakers: [{
    id: 'sp1', code: 'S1', characterType: 'baker', age: 'middle-aged', gender: 'male',
    pitch: '', timbre: '', rate: '', accent: '', onScreen: true,
    fullDescriptor: 'the middle-aged baker with a calm, slightly raspy voice',
    shortDescriptor: 'the baker',
  }],
  shots: [],
  audio: { overallSoundscape: '', nonDiegeticMusic: '' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

const shot1: Shot = {
  id: 's1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
  composition: 'medium-wide',
  body: [
    { kind: 'text', text: 'a medium-wide shot frames a baker opening the shutters of a small street bakery before sunrise. ' },
    { kind: 'camera', moveId: 'c1' },
    { kind: 'text', text: ' as ' },
    { kind: 'speaker', speakerIds: ['sp1'], form: 'full' },
    { kind: 'text', text: ' places a fresh loaf on the wooden counter and ' },
    { kind: 'dialogue', eventId: 'd1' },
  ],
  cameraMoves: [{ id: 'c1', type: 'push-in', amplitude: 'small', speed: 'slow', startMs: 0, endMs: 4000 }],
  dialogue: [{
    id: 'd1', speakerIds: ['sp1'], verb: 'says', punctuation: ':', language: 'English',
    text: 'First batch of the morning.', voiceover: false,
    sceneTransBefore: false, sceneTransAfter: false, cutoff: false, startMs: 2000, endMs: 4000,
  }],
  screenText: [], diegeticSfx: [], labelRefs: [], anchor: 'none',
}

const shot2: Shot = {
  id: 's2', index: 1, startMs: 5000, cutType: 'cut', cutPhrase: 'the camera cuts to',
  composition: 'close-up',
  body: [{ kind: 'text', text: "a close-up of steam rising from the sliced bread while the baker's final words carry over from the previous shot." }],
  cameraMoves: [], dialogue: [], screenText: [], diegeticSfx: [], labelRefs: [], anchor: 'none',
}

describe('renderShot', () => {
  it('składa pierwsze ujęcie ze stylem i bez timestampu', () => {
    expect(renderShot(shot1, project, { includeStyle: true })).toBe(
      '[Shot 1] Live-action, cinematic, a medium-wide shot frames a baker opening the shutters of a small street bakery before sunrise. ' +
      'The camera pushes in with small amplitude at slow speed as the middle-aged baker with a calm, slightly raspy voice (S1) ' +
      'places a fresh loaf on the wooden counter and says: <d>[English] First batch of the morning.</d>',
    )
  })

  it('pomija styl, gdy tryb umieszcza go osobno', () => {
    expect(renderShot(shot1, project, { includeStyle: false }))
      .toContain('[Shot 1] a medium-wide shot frames')
  })

  it('składa kolejne ujęcie z timestampem i frazą cięcia', () => {
    expect(renderShot(shot2, project, { includeStyle: false })).toBe(
      "[Shot 2] At 00:05.000, the camera cuts to a close-up of steam rising from the sliced bread while the baker's final words carry over from the previous shot.",
    )
  })

  it('rzuca wyjątek przy segmencie wskazującym nieistniejący ruch', () => {
    const broken: Shot = { ...shot2, body: [{ kind: 'camera', moveId: 'brak' }] }
    expect(() => renderShot(broken, project, { includeStyle: false })).toThrow(/brak/)
  })
})
