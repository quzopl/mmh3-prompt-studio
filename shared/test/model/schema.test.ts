import { describe, it, expect } from 'vitest'
import { parseProject, ProjectSchema } from '../../src/model/schema.js'
import type { Project } from '../../src/model/types.js'

const minimal: Project = {
  schemaVersion: 1,
  id: 'p1',
  name: 'Test',
  mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic',
  assets: [],
  labels: [],
  speakers: [],
  shots: [],
  audio: { overallSoundscape: 'N/A', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

describe('ProjectSchema', () => {
  it('przyjmuje minimalny poprawny projekt', () => {
    expect(() => parseProject(minimal)).not.toThrow()
  })

  it('odrzuca nieznany tryb', () => {
    const bad = { ...minimal, mode: 'X2VA' }
    expect(ProjectSchema.safeParse(bad).success).toBe(false)
  })

  it('odrzuca fps inne niż 24', () => {
    const bad = { ...minimal, video: { ...minimal.video, fps: 30 } }
    expect(ProjectSchema.safeParse(bad).success).toBe(false)
  })

  it('odrzuca nieznany typ ruchu kamery', () => {
    const bad = {
      ...minimal,
      shots: [
        {
          id: 's1', index: 0, startMs: 0, cutType: 'cut',
          cutPhrase: 'the camera cuts to', composition: '', body: [],
          cameraMoves: [{ id: 'c1', type: 'barrel-roll', startMs: 0, endMs: 1000 }],
          dialogue: [], screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
        },
      ],
    }
    expect(ProjectSchema.safeParse(bad).success).toBe(false)
  })

  it('odrzuca segment wskazujący nieznany rodzaj', () => {
    const bad = {
      ...minimal,
      shots: [
        {
          id: 's1', index: 0, startMs: 0, cutType: 'cut',
          cutPhrase: 'the camera cuts to', composition: '',
          body: [{ kind: 'sparkle' }],
          cameraMoves: [], dialogue: [], screenText: [], diegeticSfx: [],
          labelRefs: [], anchors: [],
        },
      ],
    }
    expect(ProjectSchema.safeParse(bad).success).toBe(false)
  })

  it('odrzuca ścieżkę assetu wychodzącą poza katalog projektu', () => {
    const bad = {
      ...minimal,
      assets: [{ id: 'a1', kind: 'image', path: '../../../etc/passwd', fileName: 'x.png' }],
    }
    expect(ProjectSchema.safeParse(bad).success).toBe(false)
  })

  it('przyjmuje ścieżkę w postaci, jaką generuje serwer', () => {
    const good = {
      ...minimal,
      assets: [{ id: 'a1', kind: 'image', path: 'assets/asset-1.img', fileName: 'x.png' }],
    }
    expect(ProjectSchema.safeParse(good).success).toBe(true)
  })
})
