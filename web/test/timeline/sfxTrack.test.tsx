import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createScale } from '../../src/timeline/scale.js'
import { SfxTrack } from '../../src/timeline/SfxTrack.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { firePointer } from './pointer.js'
import { baseProject, emptyShot } from './fixtures.js'

const scale = createScale(8000, 800, 1)

const projectWithSfx = () => baseProject([
  { ...emptyShot('a', 0, 0), diegeticSfx: [{ id: 'x1', description: 'krok', startMs: 1000, endMs: 2000 }] },
])

beforeEach(() => {
  useSelection.setState({ selected: [] })
  useProject.getState().load('test', projectWithSfx())
})

const sfxOf = (id: string) =>
  useProject.getState().project?.shots.flatMap(shot => shot.diegeticSfx).find(sfx => sfx.id === id)

/**
 * Stub `set/releasePointerCapture` potrzebny wszędzie, gdzie element niesie
 * `onPointerDown` — jsdom tych metod nie zna (patrz `pointer.ts`).
 */
const grab = (name: RegExp) => {
  const element = screen.getByRole('button', { name })
  element.setPointerCapture = () => {}
  element.releasePointerCapture = () => {}
  return element
}

describe('SfxTrack', () => {
  it('rysuje klip dźwięku tam, gdzie zaczyna się w czasie', () => {
    render(<SfxTrack scale={scale} />)
    const clip = screen.getByRole('button', { name: /dźwięk: krok/i })
    expect(clip.style.left).toBe('100px')
    expect(clip.style.width).toBe('100px')
  })

  it('przeciągnięcie przesuwa dźwięk w czasie', () => {
    render(<SfxTrack scale={scale} />)
    const clip = grab(/dźwięk: krok/i)
    firePointer(clip, 'pointerdown', 100)
    firePointer(clip, 'pointermove', 400)
    firePointer(clip, 'pointerup', 400)
    expect(sfxOf('x1')?.startMs).toBe(4000)
  })

  it('dźwięk może sięgać poza swoje ujęcie, ale nie poza materiał', () => {
    render(<SfxTrack scale={scale} />)
    const clip = grab(/dźwięk: krok/i)
    firePointer(clip, 'pointerdown', 100)
    firePointer(clip, 'pointermove', 795)
    firePointer(clip, 'pointerup', 795)
    expect(sfxOf('x1')?.endMs).toBeLessThanOrEqual(8000)
  })

  it('kliknięcie zaznacza dźwięk', async () => {
    const user = userEvent.setup()
    render(<SfxTrack scale={scale} />)
    await user.click(grab(/dźwięk: krok/i))
    expect(useSelection.getState().selected).toEqual([{ kind: 'sfx', id: 'x1' }])
  })

  it('kliknięcie z Shiftem dokłada do zaznaczenia zamiast je zastępować', async () => {
    useProject.getState().apply(current => ({
      ...current,
      shots: current.shots.map(shot =>
        shot.id === 'a'
          ? { ...shot, diegeticSfx: [...shot.diegeticSfx, { id: 'x2', description: 'trzask', startMs: 3000, endMs: 3500 }] }
          : shot),
    }))
    const user = userEvent.setup()
    render(<SfxTrack scale={scale} />)
    await user.click(grab(/dźwięk: krok/i))
    await user.keyboard('{Shift>}')
    await user.click(grab(/dźwięk: trzask/i))
    await user.keyboard('{/Shift}')
    expect(useSelection.getState().selected).toEqual([
      { kind: 'sfx', id: 'x1' },
      { kind: 'sfx', id: 'x2' },
    ])
  })
})
