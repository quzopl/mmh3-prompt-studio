import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createScale } from '../../src/timeline/scale.js'
import { CameraTrack } from '../../src/timeline/CameraTrack.js'
import { SfxTrack } from '../../src/timeline/SfxTrack.js'
import { useTimelineShortcuts } from '../../src/timeline/useTimelineShortcuts.js'
import { useProject } from '../../src/store/projectStore.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { baseProject, emptyShot } from './fixtures.js'

const scale = createScale(8000, 800, 1)

/** Dwa ujęcia — jak w innych testach ścieżek, żeby playhead na 5000 ms trafiał w drugie. */
const twoShots = () => baseProject([emptyShot('a', 0, 0), emptyShot('b', 1, 4000)])

/**
 * Skrót Delete żyje w `useTimelineShortcuts` (nasłuch na `window`), nie w
 * samej ścieżce — bez tego uchwytu klawisz nie miałby kto go obsłużyć,
 * dokładnie jak w `shortcuts.test.tsx`.
 */
function Harness({ children }: { children: React.ReactNode }) {
  useTimelineShortcuts()
  return <>{children}</>
}

/** Stub `set/releasePointerCapture` — jsdom ich nie zna (patrz `pointer.ts`). */
const grab = (name: RegExp) => {
  const element = screen.getByRole('button', { name })
  element.setPointerCapture = () => {}
  element.releasePointerCapture = () => {}
  return element
}

beforeEach(() => {
  useSelection.setState({ selected: [] })
  usePlayhead.setState({ ms: 5000, playing: false })
  useProject.getState().load('test', twoShots())
})

describe('tworzenie i usuwanie na CameraTrack', () => {
  it('przycisk dodaje klip na playheadzie, Delete go usuwa jednym wpisem historii razem z dodaniem', async () => {
    const user = userEvent.setup()
    render(<Harness><CameraTrack scale={scale} /></Harness>)

    expect(screen.queryByRole('button', { name: /^Ruch kamery/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /dodaj ruch kamery/i }))

    const clip = grab(/^Ruch kamery/i)
    expect(clip).toBeInTheDocument()
    expect(useProject.getState().past).toHaveLength(1)

    await user.click(clip)
    expect(useSelection.getState().selected).toHaveLength(1)

    await user.keyboard('{Delete}')
    expect(screen.queryByRole('button', { name: /^Ruch kamery/i })).not.toBeInTheDocument()
    expect(useProject.getState().past).toHaveLength(2)
    expect(useSelection.getState().selected).toEqual([])
  })
})

describe('tworzenie i usuwanie na SfxTrack', () => {
  it('przycisk dodaje klip na playheadzie, Delete go usuwa jednym wpisem historii razem z dodaniem', async () => {
    const user = userEvent.setup()
    render(<Harness><SfxTrack scale={scale} /></Harness>)

    expect(screen.queryByRole('button', { name: /^Dźwięk:/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /dodaj dźwięk/i }))

    const clip = grab(/^Dźwięk:/i)
    expect(clip).toBeInTheDocument()
    expect(useProject.getState().past).toHaveLength(1)

    await user.click(clip)
    expect(useSelection.getState().selected).toHaveLength(1)

    await user.keyboard('{Delete}')
    expect(screen.queryByRole('button', { name: /^Dźwięk:/i })).not.toBeInTheDocument()
    expect(useProject.getState().past).toHaveLength(2)
    expect(useSelection.getState().selected).toEqual([])
  })
})
