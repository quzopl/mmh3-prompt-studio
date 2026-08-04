import type { Label, Project, Shot, Speaker } from '../../../src/model/types.js'

const subject = (id: string, index: number, definition: string): Label =>
  ({ id, kind: 'subject', index, assetIds: [], definition, role: '', standalone: true })

const labels: Label[] = [
  subject('sub1', 1, 'is the coffee-shop environment in <Picture 1>, featuring an exposed brick wall, an orange tufted sofa with patterned pillows, a neon sign, and a wooden coffee table.'),
  subject('sub2', 2, 'is the fluffy white Samoyed in <Picture 2>, <Picture 3>, and <Picture 4>, with thick white fur, pointed ears, a dark nose, and a curved tail.'),
  subject('sub3', 3, 'is the young blonde woman in <Video 1>, with long blonde hair and a light-pink button-down shirt with rolled-up sleeves.'),
  subject('sub4', 4, 'is the young man in <Video 2>, with short wavy brown hair and a dark-grey hoodie with drawstrings.'),
  { id: 'aud1', kind: 'audio', index: 1, assetIds: [], standalone: true, role: '',
    definition: 'is the voice-timbre reference for <Subject 3> (S1), containing a spoken English vocal layer.' },
]

const speakers: Speaker[] = [
  { id: 'sp1', code: 'S1', characterType: 'young woman', age: 'young', gender: 'female',
    pitch: 'clear', timbre: 'youthful', rate: 'natural', accent: 'neutral', onScreen: true,
    fullDescriptor: 'the young blonde woman', shortDescriptor: 'the blonde woman' },
  { id: 'sp2', code: 'S2', characterType: 'young man', age: 'young', gender: 'male',
    pitch: 'casual', timbre: 'warm', rate: 'easy', accent: 'neutral', onScreen: true,
    fullDescriptor: 'the young man', shortDescriptor: 'the young man' },
]

const emptyShot = (over: Partial<Shot>): Shot => ({
  id: 'x', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the shot cuts to',
  composition: '', body: [], cameraMoves: [], dialogue: [], screenText: [],
  diegeticSfx: [], labelRefs: [], anchors: [], ...over,
})

const shot1: Shot = emptyShot({
  id: 's1', index: 0, startMs: 0, composition: 'medium',
  dialogue: [{
    id: 'd1', speakerIds: ['sp1'], verb: 'exclaims with light annoyance', punctuation: ',',
    language: 'English', text: 'Hey! Watch your dog!', voiceover: false,
    sceneTransBefore: false, sceneTransAfter: false, cutoff: false, startMs: 1500, endMs: 3000,
  }],
  body: [
    { kind: 'text', text: 'A medium shot establishes ' },
    { kind: 'label', labelId: 'sub1', bracketed: true },
    { kind: 'text', text: ', the coffee shop with its exposed brick wall, orange tufted sofa, patterned pillows, neon sign, and wooden coffee table. ' },
    { kind: 'label', labelId: 'sub3', speakerId: 'sp1', bracketed: true },
    { kind: 'text', text: ', the young woman with long blonde hair and a light-pink button-down shirt with rolled-up sleeves, sits on the sofa holding a chocolate-chip cookie. From the left, ' },
    { kind: 'label', labelId: 'sub4', bracketed: true },
    { kind: 'text', text: ', the young man with short wavy brown hair and a dark-grey hoodie with drawstrings, enters holding the leash of ' },
    { kind: 'label', labelId: 'sub2', bracketed: true },
    { kind: 'text', text: ', the thick-furred white Samoyed with pointed ears, a dark nose, and a curved tail. The dog lunges toward the cookie and pulls the leash taut. ' },
    { kind: 'label', labelId: 'sub3', speakerId: 'sp1', bracketed: true },
    { kind: 'text', text: ' jerks her hand back and, using the clear youthful voice timbre referenced from <Audio 1>, ' },
    { kind: 'dialogue', eventId: 'd1' },
    { kind: 'text', text: ' She closes her lips and guards the cookie while ' },
    { kind: 'label', labelId: 'sub4', bracketed: true },
    { kind: 'text', text: ' pulls the dog back.' },
  ],
})

const shot2: Shot = emptyShot({
  id: 's2', index: 1, startMs: 3000, composition: 'close-up',
  dialogue: [{
    id: 'd2', speakerIds: ['sp2'],
    verb: 'says in a casual young male voice with a playful tone and an easy conversational pace',
    punctuation: ',', language: 'English', text: 'He just likes cookies more than me.',
    voiceover: false, sceneTransBefore: false, sceneTransAfter: false, cutoff: false,
    startMs: 3200, endMs: 5000,
  }],
  body: [
    { kind: 'text', text: 'a close-up of ' },
    { kind: 'label', labelId: 'sub4', speakerId: 'sp2', bracketed: true },
    { kind: 'text', text: ', the young man in the dark-grey hoodie from Shot 1, sitting beside ' },
    { kind: 'label', labelId: 'sub3', bracketed: true },
    { kind: 'text', text: ' on the sofa and holding ' },
    { kind: 'label', labelId: 'sub2', bracketed: true },
    { kind: 'text', text: ' securely in his arms. ' },
    { kind: 'label', labelId: 'sub4', speakerId: 'sp2', bracketed: true },
    { kind: 'text', text: ' ' },
    { kind: 'dialogue', eventId: 'd2' },
    { kind: 'text', text: ' He closes his mouth into an apologetic smile and strokes the dog\'s thick white fur.' },
  ],
})

const shot3: Shot = emptyShot({
  id: 's3', index: 2, startMs: 5000, composition: 'close-up',
  dialogue: [{
    id: 'd3', speakerIds: ['sp1'],
    verb: 'replies in the same clear youthful voice referenced from <Audio 1> with an amused cadence',
    punctuation: ',', language: 'English', text: 'Well, he has good taste at least.',
    voiceover: false, sceneTransBefore: false, sceneTransAfter: false, cutoff: false,
    startMs: 5200, endMs: 7000,
  }],
  body: [
    { kind: 'text', text: 'a close-up of ' },
    { kind: 'label', labelId: 'sub3', speakerId: 'sp1', bracketed: true },
    { kind: 'text', text: ', the blonde woman in the light-pink shirt from Shot 1. Her annoyance softens as she looks toward the Samoyed. ' },
    { kind: 'label', labelId: 'sub3', speakerId: 'sp1', bracketed: true },
    { kind: 'text', text: ' ' },
    { kind: 'dialogue', eventId: 'd3' },
    { kind: 'text', text: ' She smiles and raises the cookie in a small toast-like gesture. A classic canned audience laugh begins immediately after the line and continues through the final frame.' },
  ],
})

export const refProject: Project = {
  schemaVersion: 1, id: 'golden-ref', name: 'golden-ref', mode: 'REF',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'The target video uses a realistic multi-camera sitcom style with warm indoor lighting.',
  assets: [], labels, speakers,
  shots: [shot1, shot2, shot3],
  audio: {
    overallSoundscape: 'Soft indoor coffee-shop room tone continues throughout the scene.',
    nonDiegeticMusic: 'N/A',
  },
  ref: {
    taskTypes: ['reference generation', 'audio reference'],
    summaryText: 'The target video shows <Subject 3> eating a cookie in <Subject 1>. <Subject 4> enters with <Subject 2>, which lunges toward the cookie. The three-shot exchange uses <Audio 1> as the voice-timbre reference for <Subject 3> and ends with a canned audience laugh.',
    retention: [
      { id: 'r1', labelId: 'sub1', scope: 'appears in [Shot 1], [Shot 2], [Shot 3]',
        marker: 'fully_preserved',
        note: 'the exposed brick wall, orange tufted sofa, patterned pillows, neon sign, and wooden coffee table are retained.' },
      { id: 'r2', labelId: 'sub2', scope: 'appears in [Shot 1], [Shot 2]',
        marker: 'fully_preserved',
        note: "the Samoyed's thick white fur, pointed ears, dark nose, and curved tail are retained." },
      { id: 'r3', labelId: 'sub3', scope: 'appears in [Shot 1], [Shot 2], [Shot 3]',
        marker: 'fully_preserved',
        note: "the blonde woman's identity, long hair, and light-pink shirt are retained." },
      { id: 'r4', labelId: 'sub4', scope: 'appears in [Shot 1], [Shot 2]',
        marker: 'fully_preserved',
        note: "the young man's short wavy brown hair and dark-grey hoodie are retained." },
      { id: 'r5', labelId: 'aud1', scope: '', marker: 'reference',
        note: 'its vocal timbre guides the dialogue delivery of <Subject 3> without copying the original signal.' },
    ],
  },
}
