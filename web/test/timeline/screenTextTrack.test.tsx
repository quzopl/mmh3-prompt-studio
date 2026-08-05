import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createScale } from '../../src/timeline/scale.js'
import { ScreenTextTrack } from '../../src/timeline/ScreenTextTrack.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { baseProject, emptyShot } from './fixtures.js'

const scale = createScale(8000, 800, 1)

const projectWithText = () => baseProject([
  { ...emptyShot('a', 0, 0), screenText: [{ id: 't1', text: 'OTWARTE' }] },
  emptyShot('b', 1, 4000),
])

beforeEach(() => {
  useSelection.setState({ selected: [] })
  useProject.getState().load('test', projectWithText())
})

describe('ScreenTextTrack', () => {
  it('rysuje klip tylko dla ujęcia, które ma tekst', () => {
    render(<ScreenTextTrack scale={scale} />)
    expect(screen.getAllByRole('button', { name: /tekst na ekranie w ujęciu/i })).toHaveLength(1)
  })

  it('klip pokrywa całą rozpiętość swojego ujęcia', () => {
    render(<ScreenTextTrack scale={scale} />)
    const clip = screen.getByRole('button', { name: /tekst na ekranie w ujęciu 1/i })
    expect(clip.style.left).toBe('0px')
    expect(clip.style.width).toBe('400px')
  })

  it('kliknięcie zaznacza tekst, a nie ujęcie', async () => {
    const user = userEvent.setup()
    render(<ScreenTextTrack scale={scale} />)
    await user.click(screen.getByRole('button', { name: /tekst na ekranie w ujęciu 1/i }))
    expect(useSelection.getState().selected).toEqual([{ kind: 'screenText', id: 't1' }])
  })

  it('kliknięcie z Shiftem dokłada do zaznaczenia zamiast je zastępować', async () => {
    // Ta sama konwencja co w `CameraTrack`/`DialogueTracks` — Shift+klik musi
    // działać identycznie na każdej ścieżce klipów, bo późniejsze kasowanie
    // wielu zaznaczonych obiektów naraz zakłada spójne zachowanie wszędzie.
    useProject.getState().apply(current => ({
      ...current,
      shots: current.shots.map(shot =>
        shot.id === 'b' ? { ...shot, screenText: [{ id: 't2', text: 'ZAMKNIĘTE' }] } : shot),
    }))
    const user = userEvent.setup()
    render(<ScreenTextTrack scale={scale} />)
    await user.click(screen.getByRole('button', { name: /tekst na ekranie w ujęciu 1/i }))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('button', { name: /tekst na ekranie w ujęciu 2/i }))
    await user.keyboard('{/Shift}')
    expect(useSelection.getState().selected).toEqual([
      { kind: 'screenText', id: 't1' },
      { kind: 'screenText', id: 't2' },
    ])
  })

  it('dwa teksty w tym samym ujęciu dostają różne etykiety i nie zasłaniają się nawzajem', () => {
    // Bez rozróżnienia numerem pozycji oba klipy pokrywałyby dokładnie ten sam
    // prostokąt (ten sam czas ujęcia) i byłyby nierozróżnialne dla czytnika
    // ekranu — a bez rozsunięcia w pionie drugi klip byłby niedostępny myszą,
    // bo leżałby dokładnie pod pierwszym.
    useProject.getState().apply(current => ({
      ...current,
      shots: current.shots.map(shot =>
        shot.id === 'a'
          ? { ...shot, screenText: [{ id: 't1', text: 'OTWARTE' }, { id: 't1b', text: 'OTWARTE' }] }
          : shot),
    }))
    render(<ScreenTextTrack scale={scale} />)
    const clips = screen.getAllByRole('button', { name: /tekst na ekranie w ujęciu 1/i })
    expect(clips).toHaveLength(2)
    expect(clips[0]?.getAttribute('aria-label')).not.toBe(clips[1]?.getAttribute('aria-label'))
    expect(clips[0]?.style.top).not.toBe(clips[1]?.style.top)
  })
})
