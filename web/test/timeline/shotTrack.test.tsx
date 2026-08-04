import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@mmh3/shared'
import { ShotTrack } from '../../src/timeline/ShotTrack.js'
import { createScale } from '../../src/timeline/scale.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useLang } from '../../src/i18n/useT.js'

const shot = (id: string, index: number, startMs: number) => ({
  id, index, startMs, cutType: 'cut' as const, cutPhrase: 'the camera cuts to' as const,
  composition: '', body: [], cameraMoves: [], dialogue: [],
  screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
})

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic', assets: [], labels: [], speakers: [],
  shots: [shot('a', 0, 0), shot('b', 1, 3000)],
  audio: { overallSoundscape: 'Rain.', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useSelection.setState({ selected: [] })
  useProject.getState().load('test', project)
})

describe('ShotTrack', () => {
  it('rysuje klip na każde ujęcie', () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    expect(screen.getAllByRole('button', { name: /ujęcie \d/i })).toHaveLength(2)
  })

  it('szerokość klipu odpowiada jego rozpiętości', () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    const first = screen.getByRole('button', { name: /ujęcie 1/i })
    expect(first.style.left).toBe('0px')
    expect(first.style.width).toBe('300px')
  })

  it('ujęcie z czasem cięcia poza długością wideo zostaje przypięte do krawędzi', () => {
    useProject.getState().apply(p => ({
      ...p,
      shots: p.shots.map(s => s.id === 'b' ? { ...s, startMs: 12000 } : s),
    }))
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    const second = screen.getByRole('button', { name: /ujęcie 2/i })
    expect(Number.parseFloat(second.style.left)).toBeLessThanOrEqual(800)
    expect(Number.parseFloat(second.style.width)).toBeGreaterThanOrEqual(8)
  })

  it('kliknięcie zaznacza ujęcie', async () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    await userEvent.click(screen.getByRole('button', { name: /ujęcie 2/i }))
    expect(useSelection.getState().selected).toEqual([{ kind: 'shot', id: 'b' }])
  })

  it('kliknięcie z Shiftem dokłada do zaznaczenia', async () => {
    // Trzymanie Shift między osobnymi wywołaniami wymaga jednej instancji
    // userEvent — bezpośrednie API modułu (`userEvent.click(...)`) tworzy
    // nową sesję przy każdym wywołaniu i gubi stan modyfikatora.
    const user = userEvent.setup()
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    await user.click(screen.getByRole('button', { name: /ujęcie 1/i }))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('button', { name: /ujęcie 2/i }))
    await user.keyboard('{/Shift}')
    expect(useSelection.getState().selected).toHaveLength(2)
  })

  it('zaznaczony klip jest oznaczony dla czytnika ekranu', async () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    await userEvent.click(screen.getByRole('button', { name: /ujęcie 1/i }))
    expect(screen.getByRole('button', { name: /ujęcie 1/i })).toHaveAttribute('aria-pressed', 'true')
  })
})
