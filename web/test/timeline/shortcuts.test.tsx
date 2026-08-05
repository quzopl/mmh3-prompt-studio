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

  /**
   * Runda 1 recenzji, bug drobny: `kind: 'audio'` (pas pejzażu dźwiękowego,
   * `AudioBedTracks.tsx`) to rodzaj zaznaczenia, którego ani `removeShots`,
   * ani `removeSelected` (createOnTrack.ts) nie ruszają. Przed tym zadaniem
   * taki przypadek w ogóle nie łapał się w warunek `ids.length === 0` i
   * klawisz leciał dalej bez efektu; wersja bez strażnika `DELETABLE_KINDS`
   * w `useTimelineShortcuts.ts` i tak woła `handled()` (konsumuje klawisz) i
   * czyści całe zaznaczenie, mimo że w projekcie nic się nie zmienia — to i
   * historia, i zaznaczenie w niewłaściwym stanie na sytuację „nic nie robię".
   */
  it('Delete z zaznaczonym tylko pasem dźwiękowym nie konsumuje klawisza ani nie czyści zaznaczenia', async () => {
    useSelection.getState().select({ kind: 'audio', id: 'overallSoundscape' })
    render(<Harness />)
    const before = useProject.getState().past.length
    await userEvent.keyboard('{Delete}')
    expect(useProject.getState().past.length).toBe(before)
    expect(useSelection.getState().selected).toEqual([{ kind: 'audio', id: 'overallSoundscape' }])
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

  it('spacja i End odwołują domyślną akcję przeglądarki nawet przy autopowtórzeniu', () => {
    render(<Harness />)
    const spaceRepeat = new KeyboardEvent('keydown', {
      key: ' ', repeat: true, bubbles: true, cancelable: true,
    })
    window.dispatchEvent(spaceRepeat)
    expect(spaceRepeat.defaultPrevented).toBe(true)

    const endRepeat = new KeyboardEvent('keydown', {
      key: 'End', repeat: true, bubbles: true, cancelable: true,
    })
    window.dispatchEvent(endRepeat)
    expect(endRepeat.defaultPrevented).toBe(true)
  })

  it('strzałka też odwołuje domyślną akcję przy autopowtórzeniu', () => {
    render(<Harness />)
    const arrowRepeat = new KeyboardEvent('keydown', {
      key: 'ArrowRight', repeat: true, bubbles: true, cancelable: true,
    })
    window.dispatchEvent(arrowRepeat)
    expect(arrowRepeat.defaultPrevented).toBe(true)
  })

  it('trzy naciśnięcia S na istniejącym cięciu nie zostawiają śladu w historii', async () => {
    usePlayhead.setState({ ms: 4000, playing: false }) // 'b' już zaczyna się w tym miejscu
    render(<Harness />)
    await userEvent.keyboard('sss')
    expect(useProject.getState().project!.shots).toHaveLength(2)
    expect(useProject.getState().past).toHaveLength(0)
  })
})
