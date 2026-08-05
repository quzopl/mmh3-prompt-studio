import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createScale } from '../../src/timeline/scale.js'
import { TrackStack } from '../../src/timeline/TrackStack.jsx'
import { Ruler, RULER_HEIGHT_PX } from '../../src/timeline/Ruler.jsx'
import { useTimelineShortcuts } from '../../src/timeline/useTimelineShortcuts.js'
import { useProject } from '../../src/store/projectStore.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { baseProject, emptyShot, speaker } from './fixtures.js'

const scale = createScale(8000, 800, 1)

/** Jak `ShortcutsHarness` w `anchors.test.tsx` — dowód, że spacja/Enter na przycisku nagłówka nie ucieka do globalnego skrótu. */
function ShortcutsHarness() {
  useTimelineShortcuts()
  return null
}

/** Wysokość zapisana jako `style.height` (liczba px) — liczy się identycznie po obu stronach kolumn, patrz `TrackStack.tsx`. */
const heightOf = (element: Element | null): number => {
  if (!element) throw new Error('element nie istnieje')
  return Number.parseFloat((element as HTMLElement).style.height)
}

const sumHeights = (elements: NodeListOf<Element>): number =>
  Array.from(elements).reduce((total, element) => total + heightOf(element), 0)

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
   * Runda poprawek 1, znalezisko 1 (Chromium): linijka renderuje się jako
   * PIERWSZE dziecko obszaru przewijanego, przed wierszami ścieżek — bez
   * odpowiednika w nagłówkach każdy wiersz treści siedziałby o
   * `RULER_HEIGHT_PX` niżej niż jego nagłówek. Dowód: odstępnik w nagłówkach
   * ma DOKŁADNIE tę wysokość, którą sama `Ruler` faktycznie renderuje
   * (`style.height`, nie zgadywana stała).
   */
  it('kolumna nagłówków ma odstępnik dokładnie wysokości linijki', () => {
    const { container } = render(<TrackStack scale={scale} ruler={<Ruler scale={scale} />} />)
    const rulerSpacer = container.querySelector('[data-header-row="ruler"]')
    const rulerRow = container.querySelector('[role="slider"]')
    expect(heightOf(rulerSpacer)).toBe(RULER_HEIGHT_PX)
    expect(heightOf(rulerRow)).toBe(RULER_HEIGHT_PX)
    expect(heightOf(rulerSpacer)).toBe(heightOf(rulerRow))
  })

  it('bez slotu linijki nagłówki nie dostają odstępnika', () => {
    const { container } = render(<TrackStack scale={scale} />)
    expect(container.querySelector('[data-header-row="ruler"]')).toBeNull()
  })

  /**
   * Runda poprawek 1, znalezisko 5 (Chromium): poprzednia wersja porównywała
   * syntetyczny atrybut `data-rows` sam ze sobą, więc nawet rażący rozjazd
   * wysokości (np. wiersz mówcy 7px zamiast 32px) zostawiał testy zielone.
   * Testy niżej czytają FAKTYCZNĄ `style.height` obu kolumn dla KAŻDEJ
   * ścieżki, w kilku stanach — jedyny sposób złapać rozjazd wysokości, nie
   * tylko liczby wierszy.
   */
  describe('wysokość nagłówka zgadza się z faktyczną wysokością treści', () => {
    it('ujęcia', () => {
      const { container } = render(<TrackStack scale={scale} />)
      const header = container.querySelector('[data-header-row="shots"]')
      const content = container.querySelector('[data-content-row="shots"] > *')
      expect(heightOf(header)).toBe(heightOf(content))
    })

    it('kamera', () => {
      const { container } = render(<TrackStack scale={scale} />)
      const header = container.querySelector('[data-header-row="camera"]')
      const content = container.querySelector('[data-track="camera"]')
      expect(heightOf(header)).toBe(heightOf(content))
    })

    it('sfx', () => {
      const { container } = render(<TrackStack scale={scale} />)
      const header = container.querySelector('[data-header-row="sfx"]')
      const content = container.querySelector('[data-track="sfx"]')
      expect(heightOf(header)).toBe(heightOf(content))
    })

    it('pejzaż dźwiękowy i muzyka', () => {
      const { container } = render(<TrackStack scale={scale} />)
      expect(heightOf(container.querySelector('[data-header-row="soundscape"]')))
        .toBe(heightOf(container.querySelector('[data-track="audio-soundscape"]')))
      expect(heightOf(container.querySelector('[data-header-row="music"]')))
        .toBe(heightOf(container.querySelector('[data-track="audio-music"]')))
    })

    it.each([0, 1, 3])('dialogi przy %i mówcach', speakerCount => {
      useProject.getState().load('test', {
        ...baseProject([emptyShot('a', 0, 0)]),
        speakers: Array.from({ length: speakerCount }, (_, index) => speaker(`s${index}`, `S${index}`)),
      })
      const { container } = render(<TrackStack scale={scale} />)
      const header = container.querySelector('[data-header-row="dialogue"]')
      const lanes = container.querySelectorAll('[data-track^="dialogue-"]')
      // Jeden pas na mówcę; przy ZERZE mówców jeden pusty pas zastępczy, żeby
      // wiersz treści miał wysokość swojego nagłówka (patrz `DialogueTracks.tsx`
      // — pas zbiorczy „bez mówcy" zniknął z recenzją końcową).
      expect(lanes).toHaveLength(Math.max(1, speakerCount))
      expect(heightOf(header)).toBe(sumHeights(lanes))
    })

    it.each([2, 3])('referencje przy %i etykietach', labelCount => {
      useProject.getState().load('test', {
        ...baseProject([{ ...emptyShot('a', 0, 0), labelRefs: [] }]),
        mode: 'REF',
        labels: Array.from({ length: labelCount }, (_, index) => (
          { id: `l${index}`, kind: 'subject' as const, index: index + 1, assetIds: [], definition: '', role: '', standalone: false }
        )),
      })
      const { container } = render(<TrackStack scale={scale} />)
      const header = container.querySelector('[data-header-row="references"]')
      const labelRows = container.querySelectorAll('[data-track^="references-"]')
      expect(labelRows).toHaveLength(labelCount)
      expect(heightOf(header)).toBe(sumHeights(labelRows))
    })

    /**
     * Bez żadnej etykiety `ReferencesTrack` nie rysuje żadnego wiersza — to
     * jedyny UDOKUMENTOWANY wyjątek od równości: nagłówek trzyma
     * `Math.max(1, …)`, żeby tytuł „Referencje” został widoczny, a treść ma
     * wtedy 0 px. Test dowodzi, że to WŁAŚNIE ten przypadek, nie przypadkowy rozjazd.
     */
    it('referencje bez żadnej etykiety: nagłówek jednego pustego wiersza, treść zerowej wysokości', () => {
      useProject.getState().load('test', { ...baseProject([emptyShot('a', 0, 0)]), mode: 'REF' })
      const { container } = render(<TrackStack scale={scale} />)
      const header = container.querySelector('[data-header-row="references"]')
      expect(container.querySelectorAll('[data-track^="references-"]')).toHaveLength(0)
      expect(heightOf(header)).toBe(24)
    })

    it.each([2, 3])('tekst na ekranie przy %i tekstach w jednym ujęciu', textCount => {
      useProject.getState().load('test', baseProject([
        {
          ...emptyShot('a', 0, 0),
          screenText: Array.from({ length: textCount }, (_, index) => ({ id: `t${index}`, text: `tekst ${index}` })),
        },
      ]))
      const { container } = render(<TrackStack scale={scale} />)
      const header = container.querySelector('[data-header-row="screenText"]')
      const content = container.querySelector('[data-track="screen-text"]')
      expect(heightOf(header)).toBe(heightOf(content))
    })
  })

  /**
   * Runda poprawek 1, znalezisko 2 (Chromium): zwinięcie zostawiało nagłówek
   * pełnej wysokości, a treść znikała do zera — wszystko PONIŻEJ przesuwało
   * się o wysokość zwiniętego wiersza, z kumulacją przy kolejnych
   * zwinięciach. Dowód naprawy: po zwinięciu obie strony mają TĘ SAMĄ,
   * niezerową wysokość — zarówno dla ścieżki jednowierszowej (kamera), jak i
   * wielowierszowej (dialogi przy trzech mówcach, gdzie błąd byłby
   * największy).
   */
  describe('zwinięcie nie rozjeżdża wysokości obu kolumn', () => {
    it('kamera', async () => {
      const user = userEvent.setup()
      const { container } = render(<TrackStack scale={scale} />)
      await user.click(screen.getByRole('button', { name: /zwiń ścieżkę kamera/i }))
      const header = container.querySelector('[data-header-row="camera"]')
      const content = container.querySelector('[data-content-row="camera"]')
      expect(heightOf(header)).toBe(heightOf(content))
      expect(heightOf(header)).toBeGreaterThan(0)
    })

    it('dialogi przy trzech mówcach', async () => {
      useProject.getState().load('test', {
        ...baseProject([emptyShot('a', 0, 0)]),
        speakers: [speaker('s1', 'S1'), speaker('s2', 'S2'), speaker('s3', 'S3')],
      })
      const user = userEvent.setup()
      const { container } = render(<TrackStack scale={scale} />)
      await user.click(screen.getByRole('button', { name: /zwiń ścieżkę dialogi/i }))
      const header = container.querySelector('[data-header-row="dialogue"]')
      const content = container.querySelector('[data-content-row="dialogue"]')
      expect(heightOf(header)).toBe(heightOf(content))
      expect(heightOf(header)).toBeGreaterThan(0)
      // Rozjazd sprzed poprawki zostawiał nagłówek na 4×32=128 (rowCount pełny)
      // podczas gdy treść spadała do 0 — dowodzimy, że NIE jest to już 128.
      expect(heightOf(header)).not.toBe(4 * 32)
    })
  })

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

  it('przycisk dodawania w nagłówku kamery nadal tworzy ruch na playheadzie', async () => {
    const user = userEvent.setup()
    usePlayhead.setState({ ms: 0, playing: false })
    render(<TrackStack scale={scale} />)
    await user.click(screen.getByRole('button', { name: /dodaj ruch kamery/i }))
    expect(useProject.getState().project?.shots[0]?.cameraMoves).toHaveLength(1)
  })

  /**
   * Runda poprawek 1, znalezisko 3 (Chromium, czwarte wystąpienie tej klasy
   * błędu w planie): przyciski nagłówka są `role="button"` z jawną obsługą
   * klawiatury (jak `CameraTrack`/`ReferencesTrack`), NIE natywnym
   * `<button>` — na natywnym przycisku spacja i tak bąbelkuje do `window`,
   * gdzie `useTimelineShortcuts` przełącza odtwarzanie jako efekt uboczny.
   * Test sprawdza OBA klawisze na OBU rodzajach przycisku i dowodzi, że
   * odtwarzanie NIGDY się nie włącza.
   */
  describe('klawiatura na przyciskach nagłówka nie ucieka do globalnego skrótu', () => {
    it('Enter na przycisku dodawania tworzy obiekt, nie włącza odtwarzania', async () => {
      const user = userEvent.setup()
      render(<><TrackStack scale={scale} /><ShortcutsHarness /></>)
      screen.getByRole('button', { name: /dodaj ruch kamery/i }).focus()
      await user.keyboard('{Enter}')
      expect(useProject.getState().project?.shots[0]?.cameraMoves).toHaveLength(1)
      expect(usePlayhead.getState().playing).toBe(false)
    })

    it('Spacja na przycisku dodawania tworzy obiekt, nie włącza odtwarzania', async () => {
      const user = userEvent.setup()
      render(<><TrackStack scale={scale} /><ShortcutsHarness /></>)
      screen.getByRole('button', { name: /dodaj ruch kamery/i }).focus()
      await user.keyboard(' ')
      expect(useProject.getState().project?.shots[0]?.cameraMoves).toHaveLength(1)
      expect(usePlayhead.getState().playing).toBe(false)
    })

    it('Enter na przycisku zwijania zwija ścieżkę, nie włącza odtwarzania', async () => {
      const user = userEvent.setup()
      render(<><TrackStack scale={scale} /><ShortcutsHarness /></>)
      screen.getByRole('button', { name: /zwiń ścieżkę kamera/i }).focus()
      await user.keyboard('{Enter}')
      expect(screen.queryByLabelText(/^kamera$/i)).toBeNull()
      expect(usePlayhead.getState().playing).toBe(false)
    })

    it('Spacja na przycisku zwijania zwija ścieżkę, nie włącza odtwarzania', async () => {
      const user = userEvent.setup()
      render(<><TrackStack scale={scale} /><ShortcutsHarness /></>)
      screen.getByRole('button', { name: /zwiń ścieżkę kamera/i }).focus()
      await user.keyboard(' ')
      expect(screen.queryByLabelText(/^kamera$/i)).toBeNull()
      expect(usePlayhead.getState().playing).toBe(false)
    })
  })

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
