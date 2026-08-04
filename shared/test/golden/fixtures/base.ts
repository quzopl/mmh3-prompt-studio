import type { Label, Project, Shot, Speaker } from '../../../src/model/types.js'

const emptyProject = (over: Partial<Project>): Project => ({
  schemaVersion: 1, id: 'golden', name: 'golden', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic',
  assets: [], labels: [], speakers: [], shots: [],
  audio: { overallSoundscape: '', nonDiegeticMusic: '' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
  ...over,
})

const emptyShot = (over: Partial<Shot>): Shot => ({
  id: 's1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
  composition: '', body: [], cameraMoves: [], dialogue: [], screenText: [],
  diegeticSfx: [], labelRefs: [], anchors: [], ...over,
})

const picture1: Label = {
  id: 'pic1', kind: 'picture', index: 1, assetIds: [],
  definition: '', role: '', standalone: true,
}

// ─── Case 1: T2VA ────────────────────────────────────────────────────────────

const baker: Speaker = {
  id: 'sp1', code: 'S1', characterType: 'baker', age: 'middle-aged', gender: 'male',
  pitch: 'low', timbre: 'slightly raspy', rate: 'calm', accent: 'neutral', onScreen: true,
  fullDescriptor: 'the middle-aged baker with a calm, slightly raspy voice',
  shortDescriptor: 'the baker',
}

export const t2vaProject: Project = emptyProject({
  mode: 'T2VA',
  speakers: [baker],
  shots: [
    emptyShot({
      id: 's1', index: 0, startMs: 0, composition: 'medium-wide',
      cameraMoves: [{ id: 'c1', type: 'push-in', amplitude: 'small', speed: 'slow', startMs: 0, endMs: 5000 }],
      dialogue: [{
        id: 'd1', speakerIds: ['sp1'], verb: 'says', punctuation: ':', language: 'English',
        text: 'First batch of the morning.', voiceover: false,
        sceneTransBefore: false, sceneTransAfter: false, cutoff: false,
        startMs: 3000, endMs: 5000,
      }],
      body: [
        { kind: 'text', text: 'a medium-wide shot frames a baker opening the shutters of a small street bakery before sunrise. ' },
        { kind: 'camera', moveId: 'c1' },
        { kind: 'text', text: ' as ' },
        { kind: 'speaker', speakerIds: ['sp1'], form: 'full' },
        { kind: 'text', text: ' places a fresh loaf on the wooden counter and ' },
        { kind: 'dialogue', eventId: 'd1' },
      ],
    }),
    emptyShot({
      id: 's2', index: 1, startMs: 5000, composition: 'close-up',
      body: [{ kind: 'text', text: "a close-up of steam rising from the sliced bread while the baker's final words carry over from the previous shot." }],
    }),
  ],
  audio: {
    overallSoundscape: 'Wooden shutters scrape open over a quiet street as trays clink softly inside the bakery. The doorbell rings once, followed by light footsteps and the crisp sound of bread being sliced.',
    nonDiegeticMusic: 'A soft acoustic-guitar pattern at a moderate tempo, joined by sparse upright-bass notes and a gentle fade at the end.',
  },
})

// ─── Case 2: I2VA ────────────────────────────────────────────────────────────

const youngWoman: Speaker = {
  id: 'sp1', code: 'S1', characterType: 'young woman', age: 'young', gender: 'female',
  pitch: 'quiet', timbre: 'breathy', rate: 'measured', accent: 'neutral', onScreen: true,
  fullDescriptor: 'the quiet, breathy young woman',
  shortDescriptor: 'the young woman',
}

export const i2vaProject: Project = emptyProject({
  mode: 'I2VA',
  labels: [picture1],
  speakers: [youngWoman],
  shots: [
    emptyShot({
      cameraMoves: [{ id: 'c1', type: 'truck-right', amplitude: 'small', speed: 'slow', startMs: 0, endMs: 4000 }],
      dialogue: [{
        id: 'd1', speakerIds: ['sp1'], verb: 'says', punctuation: ':', language: 'English',
        text: 'I get off at the next station.', voiceover: false,
        sceneTransBefore: false, sceneTransAfter: false, cutoff: false,
        startMs: 4000, endMs: 6000,
      }],
      anchors: ['picture-first'],
      body: [
        { kind: 'text', text: 'the young woman shown in ' },
        { kind: 'label', labelId: 'pic1', bracketed: true },
        { kind: 'text', text: ' remains beside the rain-covered train window, preserving her appearance, clothing, seat position, and the carriage layout. ' },
        { kind: 'camera', moveId: 'c1' },
        { kind: 'text', text: ' as she lifts her gaze from the folded letter toward the passing city lights. Her reflection moves across the glass while ' },
        { kind: 'speaker', speakerIds: ['sp1'], form: 'full' },
        { kind: 'text', text: ' ' },
        { kind: 'dialogue', eventId: 'd1' },
        { kind: 'text', text: ' She folds the letter along its existing crease.' },
      ],
    }),
  ],
  audio: {
    overallSoundscape: 'The train wheels produce a steady metallic rhythm beneath a low ventilation hum. Rain ticks against the window while paper rustles softly in her hands.',
    nonDiegeticMusic: 'Sustained cello notes at a slow tempo with widely spaced piano tones, gradually decreasing in volume.',
  },
})

// ─── Case 3: FL2VA ───────────────────────────────────────────────────────────

const picture2: Label = { ...picture1, id: 'pic2', index: 2 }

export const fl2vaProject: Project = emptyProject({
  mode: 'FL2VA',
  labels: [picture1, picture2],
  shots: [
    emptyShot({
      cameraMoves: [{ id: 'c1', type: 'pull-out', amplitude: 'small', speed: 'slow', startMs: 0, endMs: 8000 }],
      anchors: ['picture-first', 'picture-last'],
      body: [
        { kind: 'text', text: 'a rain-soaked cyclist begins in the position and framing established by ' },
        { kind: 'label', labelId: 'pic1', bracketed: false },
        { kind: 'text', text: ', holding a closed black umbrella beside a silver bicycle. ' },
        { kind: 'camera', moveId: 'c1' },
        { kind: 'text', text: ' as she releases the bicycle handle, raises the umbrella above her shoulder, and presses the runner upward until the canopy opens. Water rolls from the expanding fabric while she steps beneath it, rotates the handle into the final angle, and settles into the pose, spacing, and composition established by ' },
        { kind: 'label', labelId: 'pic2', bracketed: false },
        { kind: 'text', text: ' at the end of the shot.' },
      ],
    }),
  ],
  audio: {
    overallSoundscape: 'Rain falls steadily on the pavement, followed by the metallic click of the umbrella runner and the soft snap of the canopy opening. Water drips from the bicycle frame as distant traffic passes.',
    nonDiegeticMusic: 'N/A',
  },
})

// ─── Case 4: L2VA ────────────────────────────────────────────────────────────

export const l2vaProject: Project = emptyProject({
  mode: 'L2VA',
  video: { durationMs: 6000, fps: 24, aspect: '16:9', resolution: '768p' },
  labels: [picture1],
  shots: [
    emptyShot({
      cameraMoves: [{ id: 'c1', type: 'push-in', amplitude: 'small', speed: 'slow', startMs: 0, endMs: 6000 }],
      anchors: ['picture-last'],
      body: [
        { kind: 'text', text: 'a close shot begins with an intact drinking glass near the edge of a dark wooden table, while the same hand and sleeve visible in ' },
        { kind: 'label', labelId: 'pic1', bracketed: true },
        { kind: 'text', text: ' approach from the right. ' },
        { kind: 'camera', moveId: 'c1' },
        { kind: 'text', text: ' as the fingertips strike the rim. The glass tips, falls, and hits the floor with a sharp impact; cracks spread through it as fragments slide outward. Toward the end, the moving pieces lose momentum and settle into the exact broken arrangement, hand position, camera angle, lighting, and final composition established by ' },
        { kind: 'label', labelId: 'pic1', bracketed: true },
        { kind: 'text', text: '.' },
      ],
    }),
  ],
  audio: {
    overallSoundscape: 'Fingertips tap the glass before it scrapes across the tabletop, falls, and breaks with a sharp crash. Small fragments scatter and gradually stop sliding across the floor.',
    nonDiegeticMusic: 'A low electronic pulse at a slow tempo, ending immediately after the glass breaks.',
  },
})
