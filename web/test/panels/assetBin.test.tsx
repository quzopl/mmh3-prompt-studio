import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@mmh3/shared'
import { AssetBin } from '../../src/panels/AssetBin.js'
import { useProject } from '../../src/store/projectStore.js'
import { useLang } from '../../src/i18n/useT.js'

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'REF',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Sitcom', assets: [
    { id: 'asset-1', kind: 'image', path: 'assets/asset-1.png', fileName: 'kadr.png' },
    { id: 'asset-2', kind: 'audio', path: 'assets/asset-2.wav', fileName: 'glos.wav' },
  ],
  labels: [], speakers: [],
  shots: [{
    id: 'shot-1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
    composition: '', body: [], cameraMoves: [], dialogue: [],
    screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
  }],
  audio: { overallSoundscape: 'Room tone.', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useProject.getState().load('test', project)
})

describe('AssetBin', () => {
  it('wypisuje assety z nazwami plików', () => {
    render(<AssetBin slug="test" />)
    expect(screen.getByText('kadr.png')).toBeInTheDocument()
    expect(screen.getByText('glos.wav')).toBeInTheDocument()
  })

  it('tworzy etykietę obrazu z kolejnym numerem', async () => {
    render(<AssetBin slug="test" />)
    await userEvent.click(screen.getAllByRole('button', { name: /utwórz etykietę/i })[0]!)
    const labels = useProject.getState().project!.labels
    expect(labels).toHaveLength(1)
    expect(labels[0]!.kind).toBe('picture')
    expect(labels[0]!.index).toBe(1)
  })

  it('numeruje etykiety niezależnie w każdej kategorii', async () => {
    render(<AssetBin slug="test" />)
    const buttons = screen.getAllByRole('button', { name: /utwórz etykietę/i })
    await userEvent.click(buttons[0]!)
    await userEvent.click(buttons[1]!)
    const labels = useProject.getState().project!.labels
    expect(labels.find(l => l.kind === 'picture')!.index).toBe(1)
    expect(labels.find(l => l.kind === 'audio')!.index).toBe(1)
  })

  it('dodaje mówcę z kolejnym kodem', async () => {
    render(<AssetBin slug="test" />)
    await userEvent.click(screen.getByRole('button', { name: /dodaj mówcę/i }))
    await userEvent.click(screen.getByRole('button', { name: /dodaj mówcę/i }))
    const speakers = useProject.getState().project!.speakers
    expect(speakers.map(s => s.code)).toEqual(['S1', 'S2'])
  })
})
