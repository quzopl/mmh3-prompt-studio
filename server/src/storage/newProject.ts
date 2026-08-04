import type { Mode, Project } from '@mmh3/shared'

/**
 * Świeży projekt z jednym pustym ujęciem. Ujęcie pierwsze zawsze zaczyna się
 * w zerze i nie dostaje timestampu — wymaga tego guide.
 */
export function newProject(name: string, mode: Mode, id: string): Project {
  return {
    schemaVersion: 1,
    id,
    name,
    mode,
    video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
    style: '',
    assets: [],
    labels: [],
    speakers: [],
    shots: [{
      id: 'shot-1',
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
    }],
    audio: { overallSoundscape: '', nonDiegeticMusic: 'N/A' },
    ref: { taskTypes: [], summaryText: '', retention: [] },
  }
}
