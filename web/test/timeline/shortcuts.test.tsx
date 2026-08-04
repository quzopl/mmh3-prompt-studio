import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@mmh3/shared'
import { useTimelineShortcuts } from '../../src/timeline/useTimelineShortcuts.js'
import { useProject } from '../../src/store/projectStore.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { useSelection } from '../../src/store/selectionStore.js'

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

function Harness() {
  useTimelineShortcuts()
  return <input aria-label="pole tekstowe" />
}

beforeEach(() => {
  usePlayhead.setState({ ms: 0, playing: false })
  useSelection.setState({ selected: [] })
  useProject.getState().load('test', project)
})

describe('useTimelineShortcuts', () => {
  it('spacja przełącza odtwarzanie', async () => {
    render(<Harness />)
    await userEvent.keyboard(' ')
    expect(usePlayhead.getState().playing).toBe(true)
  })

  it('strzałki przesuwają o klatkę, z Shiftem o sekundę', async () => {
    render(<Harness />)
    await userEvent.keyboard('{ArrowRight}')
    expect(usePlayhead.getState().ms).toBe(42)
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
    expect(usePlayhead.getState().ms).toBe(1042)
  })

  it('Home i End skaczą na końce', async () => {
    render(<Harness />)
    await userEvent.keyboard('{End}')
    expect(usePlayhead.getState().ms).toBe(8000)
    await userEvent.keyboard('{Home}')
    expect(usePlayhead.getState().ms).toBe(0)
  })

  it('S dzieli ujęcie na playheadzie', async () => {
    usePlayhead.setState({ ms: 2000, playing: false })
    render(<Harness />)
    await userEvent.keyboard('s')
    expect(useProject.getState().project!.shots).toHaveLength(3)
  })

  it('Delete usuwa zaznaczone ujęcie', async () => {
    useSelection.getState().select({ kind: 'shot', id: 'a' })
    render(<Harness />)
    await userEvent.keyboard('{Delete}')
    expect(useProject.getState().project!.shots.map(s => s.id)).toEqual(['b'])
  })

  it('Ctrl+Z cofa, Ctrl+Shift+Z ponawia', async () => {
    usePlayhead.setState({ ms: 2000, playing: false })
    render(<Harness />)
    await userEvent.keyboard('s')
    await userEvent.keyboard('{Control>}z{/Control}')
    expect(useProject.getState().project!.shots).toHaveLength(2)
    await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    expect(useProject.getState().project!.shots).toHaveLength(3)
  })

  it('nie reaguje, gdy użytkownik pisze w polu tekstowym', async () => {
    render(<Harness />)
    const field = document.querySelector('input')!
    field.focus()
    await userEvent.keyboard('s')
    expect(useProject.getState().project!.shots).toHaveLength(2)
    expect(field).toHaveValue('s')
  })
})
