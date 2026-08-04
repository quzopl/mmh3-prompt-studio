import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgramMonitor } from '../../src/panels/ProgramMonitor.js'
import { useProject } from '../../src/store/projectStore.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { useLang } from '../../src/i18n/useT.js'

const shot = (id: string, index: number, startMs: number) => ({
  id, index, startMs, cutType: 'cut' as const, cutPhrase: 'the camera cuts to' as const,
  composition: index === 0 ? 'medium-wide' : 'close-up',
  body: [{ kind: 'text' as const, text: index === 0 ? 'a bakery at dawn.' : 'steam over bread.' }],
  cameraMoves: [], dialogue: [], screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
})

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  usePlayhead.setState({ ms: 0, playing: false })
  useProject.getState().load('test', {
    schemaVersion: 1, id: 'p', name: 'Test', mode: 'T2VA',
    video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
    style: 'Live-action, cinematic', assets: [], labels: [], speakers: [],
    shots: [shot('a', 0, 0), shot('b', 1, 4000)],
    audio: { overallSoundscape: 'Rain.', nonDiegeticMusic: 'N/A' },
    ref: { taskTypes: [], summaryText: '', retention: [] },
  })
})

describe('ProgramMonitor', () => {
  it('pokazuje ujęcie spod playheada', () => {
    render(<ProgramMonitor />)
    expect(screen.getByText(/ujęcie 1/i)).toBeInTheDocument()
    expect(screen.getByText(/a bakery at dawn/)).toBeInTheDocument()
  })

  it('przełącza ujęcie razem z playheadem', () => {
    usePlayhead.setState({ ms: 5000, playing: false })
    render(<ProgramMonitor />)
    expect(screen.getByText(/ujęcie 2/i)).toBeInTheDocument()
    expect(screen.getByText(/steam over bread/)).toBeInTheDocument()
  })

  it('pokazuje kompozycję ujęcia', () => {
    render(<ProgramMonitor />)
    expect(screen.getByText('medium-wide')).toBeInTheDocument()
  })

  it('mówi wprost, gdy nie ma nad czym stać', () => {
    useProject.getState().apply(p => ({ ...p, shots: [] }))
    render(<ProgramMonitor />)
    expect(screen.getByText(/nie stoi nad żadnym ujęciem/i)).toBeInTheDocument()
  })
})
