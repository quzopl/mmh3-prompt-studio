import type { CameraMove, DialogueEvent, Project, Shot, Speaker } from '@mmh3/shared'

/**
 * Pomocnik do budowy ujęć w testach ścieżek. Świadomie osobny od inline'owych
 * budowniczych w `shotTrack.test.tsx` i innych plikach sprzed tego zadania —
 * ich przepisanie na ten helper wykraczałoby poza zakres tej zmiany (nie ma
 * ich na liście plików zadania) i ryzykowałoby zepsucie testów niezwiązanych
 * z torem kamery. Nowe testy torów budowanych na wspólnym kliencie powinny
 * sięgać po ten plik zamiast dokładać kolejną kopię.
 */
export const emptyShot = (id: string, index: number, startMs: number): Shot => ({
  id, index, startMs,
  cutType: 'cut', cutPhrase: 'the camera cuts to', composition: '',
  body: [], cameraMoves: [], dialogue: [], screenText: [], diegeticSfx: [],
  labelRefs: [], anchors: [],
})

export const baseProject = (shots: Shot[]): Project => ({
  schemaVersion: 1, id: 'p1', name: 'test', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '1920x1080' },
  style: '', assets: [], labels: [], speakers: [], shots,
  audio: { overallSoundscape: '', nonDiegeticMusic: '' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
})

const move = (id: string, type: CameraMove['type'], startMs: number, endMs: number): CameraMove =>
  ({ id, type, startMs, endMs })

export const projectWithCamera = (): Project => baseProject([
  { ...emptyShot('a', 0, 0), cameraMoves: [move('m1', 'push-in', 1000, 4000)] },
  { ...emptyShot('b', 1, 6000), cameraMoves: [move('m2', 'pan-left', 6000, 7000)] },
])

/** Eksportowane, żeby testy pasów dialogów mogły dokładać własnych mówców i kwestie bez kopiowania tego kształtu. */
export const speaker = (id: string, code: string): Speaker => ({
  id, code, characterType: 'woman', age: 'in her thirties', gender: 'female',
  pitch: 'medium', timbre: 'warm', rate: 'measured', accent: 'neutral',
  onScreen: true, fullDescriptor: 'a woman', shortDescriptor: 'the woman',
})

/** Jak wyżej — eksportowane dla tych samych powodów. */
export const line = (id: string, speakerIds: string[], text: string, startMs: number, endMs: number): DialogueEvent => ({
  id, speakerIds, verb: 'says', punctuation: ':', language: 'English', text,
  voiceover: false, sceneTransBefore: false, sceneTransAfter: false, cutoff: false,
  startMs, endMs,
})

export const projectWithDialogue = (): Project => ({
  ...baseProject([
    {
      ...emptyShot('a', 0, 0),
      dialogue: [
        line('d1', ['s1'], 'Nadchodzi', 1000, 2000),
        line('d2', ['s2'], 'Wiem', 2500, 3500),
        line('d3', ['s1', 's2'], 'razem', 4000, 5000),
        line('d4', [], 'narracja', 6000, 7000),
      ],
    },
  ]),
  speakers: [speaker('s1', 'S1'), speaker('s2', 'S2')],
})
