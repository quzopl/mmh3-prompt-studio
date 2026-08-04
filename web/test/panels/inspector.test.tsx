import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@mmh3/shared'
import { Inspector } from '../../src/panels/Inspector.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useLang } from '../../src/i18n/useT.js'

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: '', assets: [], labels: [], speakers: [],
  shots: [{
    id: 'shot-1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
    composition: '', body: [], cameraMoves: [], dialogue: [],
    screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
  }],
  audio: { overallSoundscape: '', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useSelection.setState({ selected: null })
  useProject.getState().load('test', project)
})

describe('Inspector', () => {
  it('bez zaznaczenia pokazuje pola projektu', () => {
    render(<Inspector />)
    expect(screen.getByLabelText(/styl wizualny/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/długość wideo/i)).toBeInTheDocument()
  })

  it('zmiana stylu przelicza prompt', async () => {
    render(<Inspector />)
    await userEvent.type(screen.getByLabelText(/styl wizualny/i), 'Live-action')
    expect(useProject.getState().prompt).toContain('Live-action')
  })

  it('po zaznaczeniu ujęcia pokazuje jego pola', () => {
    useSelection.setState({ selected: { kind: 'shot', id: 'shot-1' } })
    render(<Inspector />)
    expect(screen.getByLabelText(/kompozycja/i)).toBeInTheDocument()
  })

  it('zmiana czasu cięcia trafia do modelu', async () => {
    useProject.getState().apply(p => ({
      ...p,
      shots: [...p.shots, { ...p.shots[0]!, id: 'shot-2', index: 1, startMs: 4000 }],
    }))
    useSelection.setState({ selected: { kind: 'shot', id: 'shot-2' } })
    render(<Inspector />)
    const field = screen.getByLabelText(/czas cięcia/i)
    await userEvent.clear(field)
    await userEvent.type(field, '5000')
    expect(useProject.getState().project!.shots[1]!.startMs).toBe(5000)
  })

  it('pokazuje komunikat, gdy zaznaczony obiekt zniknął', () => {
    useSelection.setState({ selected: { kind: 'shot', id: 'nie-ma' } })
    render(<Inspector />)
    expect(screen.getByRole('region', { name: /inspektor/i })).toBeInTheDocument()
  })
})
