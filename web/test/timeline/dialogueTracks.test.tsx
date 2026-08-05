import { describe, expect, it, beforeEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createScale } from '../../src/timeline/scale.js'
import { DialogueTracks } from '../../src/timeline/DialogueTracks.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { firePointer } from './pointer.js'
import { projectWithDialogue, speaker, line, emptyShot } from './fixtures.js'

const scale = createScale(8000, 800, 1)

beforeEach(() => {
  useSelection.setState({ selected: [] })
  useProject.getState().load('test', projectWithDialogue())
})

const eventOf = (id: string) =>
  useProject.getState().project?.shots.flatMap(shot => shot.dialogue).find(event => event.id === id)

/**
 * Uchwyty krawędzi i sam klip niosą `onPointerDown` — jsdom nie zna
 * `set/releasePointerCapture` (patrz `pointer.ts`), więc bez stubu gest
 * rzuciłby nieprzechwyconym wyjątkiem.
 */
const grab = (name: RegExp) => {
  const element = screen.getByRole('button', { name })
  element.setPointerCapture = () => {}
  element.releasePointerCapture = () => {}
  return element
}

describe('DialogueTracks', () => {
  it('daje każdemu mówcy własny pas', () => {
    render(<DialogueTracks scale={scale} />)
    expect(screen.getByLabelText(/dialog S1/i)).toBeTruthy()
    expect(screen.getByLabelText(/dialog S2/i)).toBeTruthy()
  })

  it('kwestia trafia do pasa swojego mówcy, a nie cudzego', () => {
    render(<DialogueTracks scale={scale} />)
    const laneOne = screen.getByLabelText(/dialog S1/i)
    const laneTwo = screen.getByLabelText(/dialog S2/i)
    // S1 ma własną kwestię (d1) i wspólną z S2 (d3, patrz test niżej), ale nie
    // kwestię należącą wyłącznie do S2 (d2) — i odwrotnie.
    expect(within(laneOne).queryByRole('button', { name: /wiem/i })).not.toBeInTheDocument()
    expect(within(laneTwo).queryByRole('button', { name: /nadchodzi/i })).not.toBeInTheDocument()
  })

  it('kwestia dwóch mówców pojawia się w obu pasach', () => {
    render(<DialogueTracks scale={scale} />)
    const clips = screen.getAllByRole('button', { name: /kwestia .*razem/i })
    expect(clips).toHaveLength(2)
  })

  /**
   * Recenzja końcowa, znalezisko 1: pas zbiorczy „Dialog bez mówcy" nie mógł
   * legalnie nic pomieścić (`DialogueEventSchema` wymaga `speakerIds.min(1)`),
   * więc zniknął. Jedyny pas spoza listy mówców, jaki został, to pusty pas
   * ZASTĘPCZY dla projektu, który nie ma jeszcze żadnego mówcy — istnieje
   * wyłącznie po to, żeby wiersz treści miał wysokość swojego nagłówka w
   * `TrackStack`, i nigdy nie pokazuje klipu.
   */
  it('projekt bez mówców dostaje jeden pusty pas zastępczy', () => {
    useProject.getState().load('test', {
      ...projectWithDialogue(),
      speakers: [],
      shots: [emptyShot('a', 0, 0)],
    })
    render(<DialogueTracks scale={scale} />)
    const lane = screen.getByLabelText(/brak mówców/i)
    expect(within(lane).queryAllByRole('button')).toHaveLength(0)
  })

  it('poza stanem pustym nie ma żadnego pasa spoza listy mówców', () => {
    const { container } = render(<DialogueTracks scale={scale} />)
    expect(container.querySelectorAll('[data-track^="dialogue-"]')).toHaveLength(2)
    expect(screen.queryByLabelText(/bez mówcy/i)).not.toBeInTheDocument()
  })

  it('pas mówcy bez żadnej kwestii nadal istnieje', () => {
    useProject.getState().apply(current => ({
      ...current,
      speakers: [...current.speakers, speaker('s3', 'S3')],
    }))
    render(<DialogueTracks scale={scale} />)
    const lane = screen.getByLabelText(/dialog S3/i)
    expect(within(lane).queryAllByRole('button')).toHaveLength(0)
  })

  it('dwie kwestie tego samego mówcy o tym samym tekście w jednym ujęciu dostają różne etykiety', () => {
    // Sam mówca i tekst nie rozróżniają dwóch kwestii, tak jak typ i ujęcie nie
    // rozróżniały dwóch ruchów kamery (patrz `CameraTrack`) — etykieta musi
    // więc nieść coś jeszcze, np. numer kwestii w obrębie ujęcia.
    useProject.getState().apply(current => ({
      ...current,
      shots: current.shots.map(shot => shot.id === 'a'
        ? { ...shot, dialogue: [...shot.dialogue, line('d5', ['s1'], 'Nadchodzi', 7000, 7500)] }
        : shot),
    }))
    render(<DialogueTracks scale={scale} />)
    const labels = screen.getAllByRole('button', { name: /nadchodzi/i })
      .map(element => element.getAttribute('aria-label'))
    expect(labels).toHaveLength(2)
    expect(new Set(labels).size).toBe(2)
  })

  it('kliknięcie klipu zaznacza kwestię', async () => {
    const user = userEvent.setup()
    render(<DialogueTracks scale={scale} />)
    await user.click(grab(/nadchodzi/i))
    expect(useSelection.getState().selected).toEqual([{ kind: 'dialogue', id: 'd1' }])
  })

  it('kliknięcie z Shiftem dokłada do zaznaczenia zamiast je zastępować', async () => {
    const user = userEvent.setup()
    render(<DialogueTracks scale={scale} />)
    await user.click(grab(/nadchodzi/i))
    await user.keyboard('{Shift>}')
    await user.click(grab(/wiem/i))
    await user.keyboard('{/Shift}')
    expect(useSelection.getState().selected).toEqual([
      { kind: 'dialogue', id: 'd1' },
      { kind: 'dialogue', id: 'd2' },
    ])
  })

  it('uchwyty krawędzi są separatorami bez fokusu klawiaturą, nie przyciskami', () => {
    render(<DialogueTracks scale={scale} />)
    // Zakotwiczone na końcu: etykieta d3 to „...kwestii S1, S2" i bez `$`
    // pasowałaby też pod ten wzorzec jako prefiks, psując jednoznaczność.
    const handle = screen.getByRole('separator', { name: /przesuń koniec kwestii s1$/i })
    expect(handle).not.toHaveAttribute('tabindex')
    expect(screen.queryByRole('button', { name: /przesuń koniec kwestii s1$/i })).not.toBeInTheDocument()
  })

  it('przeciągnięcie klipu przesuwa kwestię w czasie', () => {
    render(<DialogueTracks scale={scale} />)
    const lane = screen.getByLabelText(/dialog S1/i)
    const clip = within(lane).getByRole('button', { name: /nadchodzi/i })
    clip.setPointerCapture = () => {}
    clip.releasePointerCapture = () => {}
    firePointer(clip, 'pointerdown', 100)
    firePointer(clip, 'pointermove', 300)
    firePointer(clip, 'pointerup', 300)
    expect(eventOf('d1')?.startMs).toBe(3000)
  })

  it('kwestia może przekroczyć granicę cięcia — przeciąganie nie jest ograniczone do własnego ujęcia', () => {
    // Dwa ujęcia: 'a' od 0 do 3000ms, 'b' od 3000ms do końca (8000ms). Kwestia
    // d1 (1000–2000ms) należy do 'a'; przesunięcie jej za 3000ms musi się udać,
    // bo model dopuszcza kwestię rozciągniętą na dwa ujęcia (późniejsze zadanie
    // planu dokłada na to `<scenetrans>`) — ograniczenie gestu do własnego
    // ujęcia, jak w `CameraTrack`, zamknęłoby tę furtkę bez potrzeby.
    useProject.getState().apply(current => ({
      ...current,
      shots: [...current.shots, { ...emptyShot('b', 1, 3000), dialogue: [] }],
    }))
    render(<DialogueTracks scale={scale} />)
    const lane = screen.getByLabelText(/dialog S1/i)
    const clip = within(lane).getByRole('button', { name: /nadchodzi/i })
    clip.setPointerCapture = () => {}
    clip.releasePointerCapture = () => {}
    firePointer(clip, 'pointerdown', 100)
    firePointer(clip, 'pointermove', 500)
    firePointer(clip, 'pointerup', 500)
    expect(eventOf('d1')?.startMs).toBe(5000)
  })

  it('dwa osobne przeciągnięcia tej samej wspólnej kwestii — raz w pasie S1, raz w pasie S2 — dają dwa wpisy historii i zgodny wynik', () => {
    // Klucz sklejania historii pochodzi z identyfikatora kwestii, nie z pasa —
    // dlatego dwa PEŁNE gesty (dwa niezależne pointerdown→pointerup) na tym
    // samym obiekcie, nawet zaczęte w dwóch różnych pasach, zostają dwoma
    // osobnymi wpisami cofania, a końcowy stan jest spójny (to jedna kwestia,
    // nie dwie rozjeżdżające się kopie).
    render(<DialogueTracks scale={scale} />)
    const before = useProject.getState().past.length

    const laneOne = screen.getByLabelText(/dialog S1/i)
    const clipInLaneOne = within(laneOne).getByRole('button', { name: /razem/i })
    clipInLaneOne.setPointerCapture = () => {}
    clipInLaneOne.releasePointerCapture = () => {}
    // Cały pierwszy gest w `act`, żeby React zdążył przerenderować pas S2
    // zanim złapiemy tam jego klip — bez tego drugi `pointerdown` trafiłby w
    // uchwyt zdarzenia sprzed pierwszego gestu, z nieaktualnym `startMs`
    // zamkniętym w domknięciu (sprawdzone: bez `act` ten test daje 4500, nie
    // 5000 — nie dlatego, że komponent czyta nieaktualny stan, tylko dlatego,
    // że test nie odczekał na przerenderowanie między dwoma NIEZALEŻNYMI
    // gestami, co w prawdziwym użyciu dzieli co najmniej jedna klatka).
    act(() => {
      firePointer(clipInLaneOne, 'pointerdown', 400)
      firePointer(clipInLaneOne, 'pointermove', 450)
      firePointer(clipInLaneOne, 'pointerup', 450)
    })

    const laneTwo = screen.getByLabelText(/dialog S2/i)
    const clipInLaneTwo = within(laneTwo).getByRole('button', { name: /razem/i })
    clipInLaneTwo.setPointerCapture = () => {}
    clipInLaneTwo.releasePointerCapture = () => {}
    firePointer(clipInLaneTwo, 'pointerdown', 450)
    firePointer(clipInLaneTwo, 'pointermove', 500)
    firePointer(clipInLaneTwo, 'pointerup', 500)

    expect(useProject.getState().past.length).toBe(before + 2)
    expect(eventOf('d3')?.startMs).toBe(5000)
  })

  it('cały gest to jeden wpis historii cofania', () => {
    render(<DialogueTracks scale={scale} />)
    const before = useProject.getState().past.length
    const lane = screen.getByLabelText(/dialog S1/i)
    const clip = within(lane).getByRole('button', { name: /nadchodzi/i })
    clip.setPointerCapture = () => {}
    clip.releasePointerCapture = () => {}
    firePointer(clip, 'pointerdown', 100)
    firePointer(clip, 'pointermove', 200)
    firePointer(clip, 'pointermove', 300)
    firePointer(clip, 'pointerup', 300)
    expect(useProject.getState().past.length).toBe(before + 1)
  })
})
