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

/**
 * Uchwyty krawędzi są `role="separator"` (patrz `ShotTrack`), a sam klip
 * `role="button"` — stąd rola jako osobny parametr zamiast zgadywania po
 * nazwie. Stub `set/releasePointerCapture` potrzebny wszędzie, gdzie element
 * niesie `onPointerDown`: jsdom nie zna tych metod (patrz `pointer.ts`).
 */
const grab = (role: 'button' | 'separator', name: RegExp) => {
  const element = screen.getByRole(role, { name })
  element.setPointerCapture = () => {}
  element.releasePointerCapture = () => {}
  return element
}

const moveOf = (id: string) =>
  useProject.getState().project?.shots.flatMap(shot => shot.cameraMoves).find(move => move.id === id)

describe('CameraTrack', () => {
  it('rysuje po jednym klipie na ruch kamery', () => {
    render(<CameraTrack scale={scale} />)
    // Zakotwiczone na początku etykiety („Ruch kamery ...") — bez tego pasowałby
    // też przycisk dodawania z zadania 14 („Dodaj ruch kamery na playheadzie"),
    // który zawiera tę samą frazę jako podciąg.
    expect(screen.getAllByRole('button', { name: /^ruch kamery/i })).toHaveLength(2)
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
    const clip = grab('button', /ruch kamery push-in/i)
    await user.click(clip)
    expect(useSelection.getState().selected).toEqual([{ kind: 'camera', id: 'm1' }])
  })

  it('kliknięcie z Shiftem dokłada do zaznaczenia zamiast je zastępować', async () => {
    // Trzymanie Shift między osobnymi wywołaniami wymaga jednej instancji
    // `userEvent` — bezpośrednie API modułu tworzyłoby nową sesję przy każdym
    // wywołaniu i gubiłoby stan modyfikatora (patrz `shotTrack.test.tsx`).
    const user = userEvent.setup()
    render(<CameraTrack scale={scale} />)
    await user.click(grab('button', /ruch kamery push-in/i))
    await user.keyboard('{Shift>}')
    await user.click(grab('button', /ruch kamery pan-left/i))
    await user.keyboard('{/Shift}')
    expect(useSelection.getState().selected).toEqual([
      { kind: 'camera', id: 'm1' },
      { kind: 'camera', id: 'm2' },
    ])
  })

  it('dwa ruchy tego samego typu w jednym ujęciu dostają różne etykiety', () => {
    // `projectWithCamera` ma po jednym ruchu na ujęcie — dokładamy drugi
    // `push-in` do ujęcia 'a', żeby sprawdzić rozróżnienie samym typem i
    // numerem ujęcia (oba miałyby wtedy identyczny tekst bez numeru ruchu).
    useProject.getState().apply(current => ({
      ...current,
      shots: current.shots.map(shot => shot.id === 'a'
        ? { ...shot, cameraMoves: [...shot.cameraMoves, { id: 'm3', type: 'push-in' as const, startMs: 4500, endMs: 5500 }] }
        : shot),
    }))
    render(<CameraTrack scale={scale} />)
    const labels = screen.getAllByRole('button', { name: /ruch kamery push-in/i })
      .map(element => element.getAttribute('aria-label'))
    expect(labels).toHaveLength(2)
    expect(new Set(labels).size).toBe(2)
  })

  it('uchwyty krawędzi są separatorami bez fokusu klawiaturą, nie przyciskami', () => {
    // `ShotTrack`: uchwyt granicy to `role="separator"` bez `tabIndex` —
    // opisany dla drzewa dostępności, ale nieosiągalny klawiaturą, która i
    // tak nic by z nim nie zrobiła (zmiana rozmiaru klawiaturą nie istnieje
    // nigdzie w tej maszynerii klipów, nie tylko tutaj). Wcześniej uchwyty
    // były prawdziwymi `<button>`: Tab je osiągał, a Enter/Spacja odpalały
    // `click`, który wypływał do kontenera i zaznaczał klip zamiast czegokolwiek
    // robić z krawędzią — obietnica bez pokrycia.
    render(<CameraTrack scale={scale} />)
    const handle = grab('separator', /przesuń koniec ruchu push-in/i)
    expect(handle).not.toHaveAttribute('tabindex')
    expect(screen.queryByRole('button', { name: /przesuń koniec ruchu push-in/i })).not.toBeInTheDocument()
  })

  it('przeciągnięcie krawędzi końcowej wydłuża ruch', () => {
    render(<CameraTrack scale={scale} />)
    const handle = grab('separator', /przesuń koniec ruchu push-in/i)
    firePointer(handle, 'pointerdown', 400)
    firePointer(handle, 'pointermove', 600)
    firePointer(handle, 'pointerup', 600)
    expect(moveOf('m1')?.endMs).toBe(6000)
  })

  it('ruch nie wychodzi poza ujęcie, do którego należy', () => {
    render(<CameraTrack scale={scale} />)
    const handle = grab('separator', /przesuń koniec ruchu push-in/i)
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
    const handle = grab('separator', /przesuń koniec ruchu push-in/i)
    firePointer(handle, 'pointerdown', 400)
    firePointer(handle, 'pointermove', 500)
    firePointer(handle, 'pointermove', 600)
    firePointer(handle, 'pointerup', 600)
    expect(useProject.getState().past.length).toBe(before + 1)
  })
})
