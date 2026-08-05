import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createScale } from '../../src/timeline/scale.js'
import { CameraTrack } from '../../src/timeline/CameraTrack.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { firePointer } from './pointer.js'
import { projectWithCamera } from './fixtures.js'

const scale = createScale(8000, 800, 1)

beforeEach(() => {
  useSelection.setState({ selected: [] })
  useProject.getState().load('test', projectWithCamera())
})

const grab = (name: RegExp) => {
  const element = screen.getByRole('button', { name })
  element.setPointerCapture = () => {}
  element.releasePointerCapture = () => {}
  return element
}

const moveOf = (id: string) =>
  useProject.getState().project?.shots.flatMap(shot => shot.cameraMoves).find(move => move.id === id)

describe('CameraTrack', () => {
  it('rysuje po jednym klipie na ruch kamery', () => {
    render(<CameraTrack scale={scale} />)
    expect(screen.getAllByRole('button', { name: /ruch kamery/i })).toHaveLength(2)
  })

  it('klip stoi tam, gdzie ruch zaczyna się w czasie', () => {
    render(<CameraTrack scale={scale} />)
    const clip = screen.getByRole('button', { name: /ruch kamery push-in/i })
    expect(clip.style.left).toBe('100px')
    expect(clip.style.width).toBe('300px')
  })

  it('kliknięcie klipu zaznacza ruch', async () => {
    const user = userEvent.setup()
    render(<CameraTrack scale={scale} />)
    // Klip niesie `onPointerDown` (chwyt 'move') na tym samym elemencie co
    // `onClick` — `userEvent.click` po drodze wysyła `pointerdown`, a jsdom
    // nie zna `setPointerCapture` (patrz `grab` wyżej), więc bez stubu ten
    // sam klik rzuciłby nieprzechwyconym wyjątkiem w środku sekwencji zdarzeń.
    const clip = grab(/ruch kamery push-in/i)
    await user.click(clip)
    expect(useSelection.getState().selected).toEqual([{ kind: 'camera', id: 'm1' }])
  })

  it('przeciągnięcie krawędzi końcowej wydłuża ruch', () => {
    render(<CameraTrack scale={scale} />)
    const handle = grab(/przesuń koniec ruchu push-in/i)
    firePointer(handle, 'pointerdown', 400)
    firePointer(handle, 'pointermove', 600)
    firePointer(handle, 'pointerup', 600)
    expect(moveOf('m1')?.endMs).toBe(6000)
  })

  it('ruch nie wychodzi poza ujęcie, do którego należy', () => {
    render(<CameraTrack scale={scale} />)
    const handle = grab(/przesuń koniec ruchu push-in/i)
    firePointer(handle, 'pointerdown', 400)
    // 790px = 7900ms na tej skali — dalej niż koniec ujęcia (6000ms), ale
    // wciąż wewnątrz całego materiału (8000ms). Gdyby ograniczenia gestu
    // brały się z całego materiału zamiast z ujęcia, nic by tego nie
    // zatrzymało i `endMs` wylądowałby w okolicach 7900ms — wyraźnie za
    // granicą 6000ms sprawdzaną niżej, więc test jest czerwony bez `bounds`
    // liczonego z rozpiętości ujęcia (sprawdzone przez tymczasowe usunięcie
    // ograniczenia z `CameraTrack.tsx` przed napisaniem tego komentarza).
    firePointer(handle, 'pointermove', 790)
    firePointer(handle, 'pointerup', 790)
    const shotEnd = 6000
    expect(moveOf('m1')?.endMs).toBeLessThanOrEqual(shotEnd)
    // Sama górna granica nie wystarcza jako dowód — klip mógłby zostać nie
    // ruszony z jakiegoś innego powodu (np. zepsuty `read`) i też przejść to
    // porównanie. Wymuszamy, że gest faktycznie coś przesunął, zanim
    // ograniczenie ujęcia go zatrzymało.
    expect(moveOf('m1')?.endMs).toBeGreaterThan(4000)
  })

  it('cały gest to jeden wpis historii cofania', () => {
    render(<CameraTrack scale={scale} />)
    const before = useProject.getState().past.length
    const handle = grab(/przesuń koniec ruchu push-in/i)
    firePointer(handle, 'pointerdown', 400)
    firePointer(handle, 'pointermove', 500)
    firePointer(handle, 'pointermove', 600)
    firePointer(handle, 'pointerup', 600)
    expect(useProject.getState().past.length).toBe(before + 1)
  })
})
