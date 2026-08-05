import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createScale } from '../../src/timeline/scale.js'
import { TrackStack } from '../../src/timeline/TrackStack.jsx'
import { useProject } from '../../src/store/projectStore.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { baseProject, emptyShot, projectWithDialogue } from './fixtures.js'

const scale = createScale(8000, 800, 1)

beforeEach(() => {
  usePlayhead.setState({ ms: 0, playing: false })
  useProject.getState().load('test', baseProject([emptyShot('a', 0, 0)]))
})

describe('TrackStack', () => {
  it('pokazuje nagłówek każdej widocznej ścieżki', () => {
    render(<TrackStack scale={scale} />)
    for (const name of [/^ujęcia$/i, /^kamera$/i, /^tekst na ekranie$/i, /^sfx$/i, /^pejzaż dźwiękowy$/i, /^muzyka$/i]) {
      expect(screen.getByText(name)).toBeTruthy()
    }
  })

  it('nie pokazuje referencji poza trybem REF', () => {
    render(<TrackStack scale={scale} />)
    expect(screen.queryByText(/^referencje$/i)).toBeNull()
  })

  it('pokazuje referencje w trybie REF', () => {
    useProject.getState().load('test', { ...baseProject([emptyShot('a', 0, 0)]), mode: 'REF' })
    render(<TrackStack scale={scale} />)
    expect(screen.getByText(/^referencje$/i)).toBeTruthy()
  })

  it('zwinięcie ścieżki chowa jej klipy, ale zostawia nagłówek', async () => {
    const user = userEvent.setup()
    render(<TrackStack scale={scale} />)
    await user.click(screen.getByRole('button', { name: /zwiń ścieżkę kamera/i }))
    expect(screen.getByText(/^kamera$/i)).toBeTruthy()
    expect(screen.queryByLabelText(/^kamera$/i)).toBeNull()
  })

  it('zwinięcie i rozwinięcie wraca do stanu wyjściowego', async () => {
    const user = userEvent.setup()
    render(<TrackStack scale={scale} />)
    await user.click(screen.getByRole('button', { name: /zwiń ścieżkę kamera/i }))
    await user.click(screen.getByRole('button', { name: /rozwiń ścieżkę kamera/i }))
    expect(screen.getByLabelText(/^kamera$/i)).toBeTruthy()
  })

  it('nagłówki nie przewijają się razem z klipami', () => {
    const { container } = render(<TrackStack scale={scale} />)
    const scroller = container.querySelector('[data-scroller]')
    const headers = container.querySelector('[data-headers]')
    expect(scroller).not.toBeNull()
    expect(headers).not.toBeNull()
    expect(scroller?.contains(headers ?? null)).toBe(false)
  })

  /**
   * Problem zgłoszony w treści zadania: nagłówek dialogów to JEDEN wiersz
   * ("Dialogi"), ale `DialogueTracks` rysuje jeden pas NA MÓWCĘ plus pas
   * zbiorczy — więc jego wysokość musi rosnąć wraz z liczbą pasów. Test
   * dowodzi, że liczba pasów w nagłówku (`data-rows`) pochodzi z TEJ SAMEJ
   * funkcji (`dialogueLaneCount`), którą `DialogueTracks` używa do
   * wyrenderowania pasów — licząc faktyczne `[data-track^="dialogue-"]` w
   * DOM-ie, nie powtarzając wzoru „liczba mówców + 1" osobno w teście, bo to
   * właśnie dwa niezależne przeliczenia tej samej rzeczy miałyby się rozjechać.
   */
  it('nagłówek dialogów ma tyle wierszy, ile pasów faktycznie rysuje DialogueTracks', () => {
    useProject.getState().load('test', projectWithDialogue())
    const { container } = render(<TrackStack scale={scale} />)
    const lanes = container.querySelectorAll('[data-track^="dialogue-"]')
    const header = container.querySelector('[data-header-row="dialogue"]')
    expect(lanes.length).toBeGreaterThan(1)
    expect(header?.getAttribute('data-rows')).toBe(String(lanes.length))
  })

  /**
   * Ten sam problem po stronie referencji: `ReferencesTrack` rysuje jeden
   * wiersz NA ETYKIETĘ (`references-*`), a `timeline.trackReferences` ma być
   * wspólnym tytułem tej grupy, nie etykietą pojedynczego wiersza (patrz
   * treść zadania). Liczba wierszy nagłówka musi więc iść za faktyczną
   * liczbą etykiet, nie za stałą.
   */
  it('nagłówek referencji ma tyle wierszy, ile etykiet rysuje ReferencesTrack', () => {
    useProject.getState().load('test', {
      ...baseProject([{ ...emptyShot('a', 0, 0), labelRefs: [] }]),
      mode: 'REF',
      labels: [
        { id: 'l1', kind: 'subject', index: 1, assetIds: [], definition: '', role: '', standalone: false },
        { id: 'l2', kind: 'picture', index: 1, assetIds: [], definition: '', role: '', standalone: false },
      ],
    })
    const { container } = render(<TrackStack scale={scale} />)
    const rowsInDom = container.querySelectorAll('[data-track^="references-"]')
    const header = container.querySelector('[data-header-row="references"]')
    expect(rowsInDom).toHaveLength(2)
    expect(header?.getAttribute('data-rows')).toBe('2')
  })

  /** Grupa referencji musi mieć widoczny nagłówek nawet bez ani jednej etykiety — inaczej znika z kolumny. */
  it('nagłówek referencji istnieje nawet bez żadnej etykiety', () => {
    useProject.getState().load('test', { ...baseProject([emptyShot('a', 0, 0)]), mode: 'REF' })
    const { container } = render(<TrackStack scale={scale} />)
    expect(screen.getByText(/^referencje$/i)).toBeTruthy()
    expect(container.querySelector('[data-header-row="references"]')?.getAttribute('data-rows')).toBe('1')
  })

  /** Wysokość nagłówka tekstu na ekranie musi rosnąć razem z ScreenTextTrack, z tego samego wzoru. */
  it('nagłówek tekstu na ekranie rośnie razem z liczbą tekstów w ujęciu', () => {
    useProject.getState().load('test', baseProject([
      { ...emptyShot('a', 0, 0), screenText: [{ id: 't1', text: 'A' }, { id: 't2', text: 'B' }] },
    ]))
    const { container } = render(<TrackStack scale={scale} />)
    const header = container.querySelector('[data-header-row="screenText"]')
    expect(header?.getAttribute('data-rows')).toBe('2')
  })

  /**
   * Pejzaż i muzyka to DWA osobne rodzaje ścieżek (patrz treść zadania: „...
   * soundscape, music, ...”), nie jeden wpis z dwoma wierszami — mają więc
   * niezależne zwijanie. Dowód: zwinięcie pejzażu chowa TYLKO jego klip.
   */
  it('pejzaż i muzyka zwijają się niezależnie', async () => {
    const user = userEvent.setup()
    useProject.getState().load('test', {
      ...baseProject([emptyShot('a', 0, 0)]),
      audio: { overallSoundscape: 'deszcz o szyby', nonDiegeticMusic: 'motyw smyczkowy' },
    })
    render(<TrackStack scale={scale} />)
    await user.click(screen.getByRole('button', { name: /zwiń ścieżkę pejzaż dźwiękowy/i }))
    expect(screen.queryByText('deszcz o szyby')).toBeNull()
    expect(screen.getByText('motyw smyczkowy')).toBeTruthy()
  })

  /**
   * Przyciski dodawania z rogów ścieżek (CameraTrack/DialogueTracks/
   * ScreenTextTrack/SfxTrack) przenoszą się do nagłówka — dowód, że kamera
   * wciąż potrafi dostać nowy obiekt, tym razem z kolumny nagłówków.
   */
  it('przycisk dodawania w nagłówku kamery nadal tworzy ruch na playheadzie', async () => {
    const user = userEvent.setup()
    usePlayhead.setState({ ms: 0, playing: false })
    render(<TrackStack scale={scale} />)
    await user.click(screen.getByRole('button', { name: /dodaj ruch kamery/i }))
    expect(useProject.getState().project?.shots[0]?.cameraMoves).toHaveLength(1)
  })

  /** Playhead i linijka mają przecinać CAŁY stos i przewijać się razem z klipami, nie z nagłówkami. */
  it('umieszcza linijkę i playhead w obszarze przewijanym, nie w kolumnie nagłówków', () => {
    const { container } = render(
      <TrackStack
        scale={scale}
        ruler={<div data-testid="ruler-probe" />}
        playhead={<div data-testid="playhead-probe" />}
      />,
    )
    const scroller = container.querySelector('[data-scroller]')
    const headers = container.querySelector('[data-headers]')
    expect(scroller?.querySelector('[data-testid="ruler-probe"]')).not.toBeNull()
    expect(scroller?.querySelector('[data-testid="playhead-probe"]')).not.toBeNull()
    expect(headers?.querySelector('[data-testid="playhead-probe"]')).toBeNull()
  })
})
