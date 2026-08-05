import type { Project } from '@mmh3/shared'

/**
 * Kompletny, poprawny projekt do testów magazynu — potrzebny wszędzie tam,
 * gdzie test ręcznie pisze `project.json` na dysk i musi mieć od czego
 * odjąć/zduplikować rzeczywisty obiekt, a nie pusty szkielet.
 */
export function newProject(): Project {
  return {
    schemaVersion: 1,
    id: 'p1',
    name: 'Testowy projekt',
    mode: 'T2VA',
    video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
    style: 'Live-action, cinematic',
    assets: [],
    labels: [],
    speakers: [],
    shots: [
      {
        id: 's1',
        index: 0,
        startMs: 0,
        cutType: 'cut',
        cutPhrase: 'the camera cuts to',
        composition: '',
        body: [],
        cameraMoves: [],
        dialogue: [],
        screenText: [],
        diegeticSfx: [],
        labelRefs: [],
        anchors: [],
      },
    ],
    audio: { overallSoundscape: '', nonDiegeticMusic: 'N/A' },
    ref: { taskTypes: [], summaryText: '', retention: [] },
  }
}
