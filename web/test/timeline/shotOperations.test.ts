import { describe, it, expect } from 'vitest'
import type { Project } from '@mmh3/shared'
import { removeShots, splitAtMs } from '../../src/timeline/shotOperations.js'

const shot = (id: string, index: number, startMs: number) => ({
  id, index, startMs, cutType: 'cut' as const, cutPhrase: 'the camera cuts to' as const,
  composition: '', body: [], cameraMoves: [], dialogue: [],
  screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
})

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: '', assets: [], labels: [], speakers: [],
  shots: [shot('a', 0, 0), shot('b', 1, 4000)],
  audio: { overallSoundscape: '', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

describe('splitAtMs', () => {
  it('wstawia ujęcie i przenumerowuje pozostałe', () => {
    const out = splitAtMs(project, 2000)
    expect(out.shots.map(s => [s.index, s.startMs])).toEqual([[0, 0], [1, 2000], [2, 4000]])
  })

  it('nadaje nowemu ujęciu unikalny identyfikator', () => {
    const out = splitAtMs(project, 2000)
    expect(new Set(out.shots.map(s => s.id)).size).toBe(3)
  })

  it('nie dzieli na istniejącym cięciu', () => {
    expect(splitAtMs(project, 4000).shots).toHaveLength(2)
  })

  it('nie dzieli w zerze ani na końcu wideo', () => {
    expect(splitAtMs(project, 0).shots).toHaveLength(2)
    expect(splitAtMs(project, 8000).shots).toHaveLength(2)
  })

  it('nie tworzy ujęcia krótszego niż dozwolone', () => {
    expect(splitAtMs(project, 20).shots).toHaveLength(2)
    expect(splitAtMs(project, 3990).shots).toHaveLength(2)
  })
})

describe('removeShots', () => {
  it('usuwa wskazane ujęcia i przenumerowuje resztę', () => {
    const out = removeShots(project, ['a'])
    expect(out.shots.map(s => [s.id, s.index, s.startMs])).toEqual([['b', 0, 0]])
  })

  it('nigdy nie usuwa ostatniego ujęcia', () => {
    expect(removeShots(project, ['a', 'b']).shots).toHaveLength(1)
  })

  it('pusta lista nic nie zmienia', () => {
    expect(removeShots(project, []).shots).toHaveLength(2)
  })
})
