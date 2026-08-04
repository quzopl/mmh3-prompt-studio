import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@mmh3/shared'
import { ShotList } from '../../src/panels/ShotList.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useLang } from '../../src/i18n/useT.js'

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic', assets: [], labels: [], speakers: [],
  shots: [{
    id: 'shot-1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
    composition: '', body: [{ kind: 'text', text: 'a shot.' }], cameraMoves: [], dialogue: [],
    screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
  }],
  audio: { overallSoundscape: 'Rain.', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useSelection.setState({ selected: null })
  useProject.getState().load('test', project)
})

describe('ShotList', () => {
  it('wypisuje ujęcia', () => {
    render(<ShotList />)
    expect(screen.getByRole('button', { name: /ujęcie 1/i })).toBeInTheDocument()
  })

  it('dodaje ujęcie z czasem cięcia w środku pozostałego zakresu', async () => {
    render(<ShotList />)
    await userEvent.click(screen.getByRole('button', { name: /dodaj ujęcie/i }))
    const shots = useProject.getState().project!.shots
    expect(shots).toHaveLength(2)
    expect(shots[1]!.index).toBe(1)
    expect(shots[1]!.startMs).toBeGreaterThan(0)
    expect(shots[1]!.startMs).toBeLessThan(8000)
  })

  it('zaznacza ujęcie po kliknięciu', async () => {
    render(<ShotList />)
    await userEvent.click(screen.getByRole('button', { name: /ujęcie 1/i }))
    expect(useSelection.getState().selected).toEqual({ kind: 'shot', id: 'shot-1' })
  })

  it('usuwa ujęcie i przenumerowuje pozostałe', async () => {
    render(<ShotList />)
    await userEvent.click(screen.getByRole('button', { name: /dodaj ujęcie/i }))
    await userEvent.click(screen.getAllByRole('button', { name: /usuń ujęcie/i })[0]!)
    const shots = useProject.getState().project!.shots
    expect(shots).toHaveLength(1)
    expect(shots[0]!.index).toBe(0)
    expect(shots[0]!.startMs).toBe(0)
  })

  it('nie pozwala usunąć ostatniego ujęcia', async () => {
    render(<ShotList />)
    const remove = screen.getByRole('button', { name: /usuń ujęcie/i })
    expect(remove).toBeDisabled()
  })
})
