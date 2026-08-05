import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createScale, msToPx } from '../../src/timeline/scale.js'
import { DialogueTracks } from '../../src/timeline/DialogueTracks.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useSpeechRate } from '../../src/store/speechRateStore.js'
import { DEFAULT_WORDS_PER_MINUTE, naturalDurationMs } from '../../src/timeline/speech.js'
import { line, projectWithDialogue } from './fixtures.js'

const scale = createScale(8000, 800, 1)

beforeEach(() => {
  useSelection.setState({ selected: [] })
  useSpeechRate.setState({ wordsPerMinute: DEFAULT_WORDS_PER_MINUTE })
  useProject.getState().load('test', projectWithDialogue())
})

describe('naturalna długość na klipie dialogowym', () => {
  it('rysuje cień naturalnej długości proporcjonalny do liczby słów, poza drzewem dostępności', () => {
    // Pas S1 ma dwie kwestie — d1 (wyłącznie S1) i d3 (S1 i S2 razem, więc
    // pojawia się w obu pasach, patrz komentarz nad `DialogueTracks`) — z
    // różną liczbą słów, żeby dowieść, że cień liczy się z KONKRETNEJ
    // kwestii, a nie że przypadkiem obie mają tę samą szerokość.
    useProject.getState().apply(project => ({
      ...project,
      shots: project.shots.map(shot => ({
        ...shot,
        dialogue: shot.dialogue.map(event =>
          event.id === 'd1' ? { ...event, text: 'jedno dwa' } : event),
      })),
    }))
    render(<DialogueTracks scale={scale} />)
    const lane = screen.getByLabelText(/dialog S1/i)
    const shadows = Array.from(lane.querySelectorAll<HTMLElement>('[data-natural-length]'))
    expect(shadows).toHaveLength(2)
    for (const shadow of shadows) {
      // Poza drzewem dostępności: gdy kwestia się mieści, cień powtarza to,
      // co czytnik ekranu już usłyszał w etykiecie klipu; gdy się nie
      // mieści, tę samą informację niesie ostrzeżenie. Osobna etykieta na
      // każdym cieniu byłaby drugim przystankiem Tabu na to samo — i, jak
      // pokazuje ten właśnie test z dwiema kwestiami w jednym pasie, nie
      // dałaby się jednoznacznie zapytać stałym tekstem przez
      // `getByLabelText`.
      expect(shadow.getAttribute('aria-hidden')).toBe('true')
      expect(shadow.hasAttribute('aria-label')).toBe(false)
    }
    const [shadowD1, shadowD3] = shadows
    if (!shadowD1 || !shadowD3) throw new Error('oczekiwano dwóch cieni w pasie S1')
    // Każdy cień porównany wprost do tej samej formuły, którą liczy produkcja
    // (`naturalDurationMs` + `msToPx`), z KONKRETNYM tekstem swojej kwestii —
    // to już dowodzi, że cień liczy się z właściwej kwestii, nie że dwa cienie
    // przypadkiem wyszły tej samej szerokości.
    expect(shadowD1.style.width)
      .toBe(`${msToPx(scale, naturalDurationMs('jedno dwa', DEFAULT_WORDS_PER_MINUTE))}px`)
    expect(shadowD3.style.width)
      .toBe(`${msToPx(scale, naturalDurationMs('razem', DEFAULT_WORDS_PER_MINUTE))}px`)
    // Wartości policzone RĘCZNIE, nie przez wywołanie `naturalDurationMs`/
    // `msToPx` w samym teście jak dwie asercje wyżej. Te dwie asercje
    // liczą oczekiwaną szerokość TĄ SAMĄ produkcyjną formułą, którą woła
    // `DialogueTracks` — pinują więc, że cień bierze tekst właściwej
    // kwestii, ale nie złapałyby złamanej proporcjonalności samej formuły:
    // podstawienie `naturalDurationMs` stałą wartością (np. zawsze 500)
    // dawałoby identyczny — bo policzony tą samą podmienioną funkcją —
    // wynik po obu stronach porównania, i TE DWIE asercje przechodziłyby
    // mimo że cień przestał cokolwiek mówić o liczbie słów. Zweryfikowane
    // różnicowo: podmiana `naturalDurationMs` na funkcję zwracającą zawsze
    // 500 czerwieni w praktyce 5 z 6 testów w tym pliku (prawie wszystko tu
    // zależy od realnego czasu trwania policzonego z liczby słów, nie tylko
    // te dwie asercje) — ale WŁAŚNIE te dwie, poniżej, są jedynymi, które
    // BEZ tej podmiany i tak by przeszły, gdyby produkcyjna formuła sama
    // przestała liczyć proporcjonalnie do liczby słów (np. zaokrąglała się
    // do stałego kroku). To ich rolę jako testu proporcjonalności trzeba
    // było przywrócić, nie fakt, że reszta pliku jest na tę konkretną
    // podmianę ślepa — nie jest.
    //
    // Przy DEFAULT_WORDS_PER_MINUTE = WORDS_PER_SECOND * 60 = 162 i
    // pxPerMs = 800/8000 = 0,1:
    //   'jedno dwa' (2 słowa) → round(2/162*60000) = 741 ms → 74,1px
    //   'razem'     (1 słowo) → round(1/162*60000) = 370 ms → 37px
    expect(shadowD1.style.width).toBe('74.10000000000001px')
    expect(shadowD3.style.width).toBe('37px')
  })

  it('ostrzega, gdy kwestia nie mieści się w klipie', () => {
    useProject.getState().apply(project => ({
      ...project,
      shots: project.shots.map(shot => ({
        ...shot,
        dialogue: shot.dialogue.map(event =>
          event.id === 'd1'
            ? { ...event, text: Array.from({ length: 40 }, () => 'słowo').join(' ') }
            : event),
      })),
    }))
    render(<DialogueTracks scale={scale} />)
    const lane = screen.getByLabelText(/dialog S1/i)
    expect(within(lane).getByRole('button', { name: /nie mieści się/i })).toBeTruthy()
  })

  it('trzysłowowa kwestia w oknie 1100 ms mieści się w granicach tolerancji walidatora, mimo że naturalMs > actualMs', () => {
    // Dokładnie przykład koordynatora: naturalMs przy DEFAULT_WORDS_PER_MINUTE
    // (162/min) dla trzech słów to round(3/162*60000) = 1111 ms — WIĘCEJ niż
    // samo okno (1100 ms), więc proste `naturalMs <= actualMs` (usterka
    // sprzed tej rundy) pokazywałoby ostrzeżenie, mimo że `SPEECH_FITS` w
    // walidatorze milczy aż do 1,5-krotności okna (1650 ms) — dokładnie ta
    // rozbieżność, którą `fitsClip` (`speech.ts`) zamyka.
    useProject.getState().apply(project => ({
      ...project,
      shots: project.shots.map(shot => ({
        ...shot,
        dialogue: shot.dialogue.map(event =>
          event.id === 'd1' ? { ...event, text: 'slowo jeden dwa', endMs: 2100 } : event),
      })),
    }))
    render(<DialogueTracks scale={scale} />)
    const lane = screen.getByLabelText(/dialog S1/i)
    expect(within(lane).queryByRole('button', { name: /nie mieści się/i })).toBeNull()
    // Cień mimo to rysuje się przy DOKŁADNEJ długości naturalnej (1111 ms) —
    // tolerancja należy tylko do osądu, czy ostrzec, nie do samego rysunku
    // (patrz komentarz przy `fitsClip`).
    const shadow = lane.querySelector<HTMLElement>('[data-natural-length]')
    if (!shadow) throw new Error('oczekiwano cienia naturalnej długości')
    expect(shadow.style.width).toBe(`${msToPx(scale, 1111)}px`)
  })

  it('szybsze tempo usuwa ostrzeżenie', () => {
    useProject.getState().apply(project => ({
      ...project,
      shots: project.shots.map(shot => ({
        ...shot,
        dialogue: shot.dialogue.map(event =>
          event.id === 'd1'
            ? { ...event, text: Array.from({ length: 40 }, () => 'słowo').join(' '), endMs: 9000 }
            : event),
      })),
    }))
    render(<DialogueTracks scale={scale} />)
    const lane = screen.getByLabelText(/dialog S1/i)
    // Przy domyślnym tempie kwestia się nie mieści.
    expect(within(lane).getByRole('button', { name: /nie mieści się/i })).toBeTruthy()
    // Zmiana tempa PO montażu, nie przed nim — inaczej ten test nie
    // rozróżniałby subskrypcji od jednorazowego `getState()` w ciele
    // renderu: gdyby tempo zmieniało się przed pierwszym `render`, nawet
    // odczyt bez subskrypcji zdążyłby złapać nową wartość przy pierwszym
    // (jedynym) przebiegu renderu. Sprawdzone różnicowo: zamiana
    // `useSpeechRate(state => state.wordsPerMinute)` z powrotem na
    // `useSpeechRate.getState().wordsPerMinute` w `DialogueTracks`
    // czerwieni WŁAŚNIE ten test (klip nie przemalowuje się po zmianie w
    // magazynie), a nie test wcześniejszy, który zmieniał tempo przed
    // montażem i przechodził w obu wariantach.
    act(() => {
      useSpeechRate.setState({ wordsPerMinute: 600 })
    })
    expect(within(lane).queryByRole('button', { name: /nie mieści się/i })).toBeNull()
  })

  it('kliknięcie ostrzeżenia zaznacza klip dokładnie raz i nie zaczyna przeciągania klipu', async () => {
    // Plakietka ostrzeżenia jest zagnieżdżona w klipie, który sam ma
    // `onClick` (select/toggle) i `onPointerDown` (start przeciągnięcia) —
    // dokładnie ten kształt, w którym ten projekt już dwa razy złapał
    // podwójne wyzwolenie z zagnieżdżonych elementów interaktywnych
    // (plakietka na ujęciu, która zaznaczała też samo ujęcie; spacja na
    // zaznaczonym klipie, która też startowała odtwarzanie). Test trzyma
    // Shift przez cały gest, żeby ujawnić dokładnie tę usterkę: gdyby
    // kliknięcie w plakietkę bąbelkowało do `onClick` klipu-rodzica,
    // `toggle` przy trzymanym Shifcie natychmiast odwróciłby zaznaczenie,
    // które plakietka przed chwilą ustawiła.
    useProject.getState().apply(project => ({
      ...project,
      shots: project.shots.map(shot => ({
        ...shot,
        dialogue: shot.dialogue.map(event =>
          event.id === 'd1'
            ? { ...event, text: Array.from({ length: 40 }, () => 'słowo').join(' ') }
            : event),
      })),
    }))
    const user = userEvent.setup()
    render(<DialogueTracks scale={scale} />)
    const lane = screen.getByLabelText(/dialog S1/i)
    const clip = within(lane).getByRole('button', { name: /^kwestia s1 nr 1/i })
    const warning = within(lane).getByRole('button', { name: /nie mieści się/i })
    const setPointerCapture = vi.fn()
    clip.setPointerCapture = setPointerCapture
    clip.releasePointerCapture = () => {}

    await user.keyboard('{Shift>}')
    await user.click(warning)
    await user.keyboard('{/Shift}')

    expect(useSelection.getState().selected).toEqual([{ kind: 'dialogue', id: 'd1' }])
    expect(setPointerCapture).not.toHaveBeenCalled()
  })

  it('klipy w pasie renderują się w kolejności czasu, nawet gdy tablica kwestii ma inną kolejność', () => {
    // `write` w `useDragClip` podmienia `startMs`/`endMs` po id, nigdy nie
    // przestawia elementu w `shot.dialogue` — zwykłe przeciągnięcie klipu
    // wcześniejszego za późniejszy zostawia więc tablicę w kolejności
    // niezgodnej z czasem. Kolejność w DOM-ie musi mimo to iść za czasem
    // (patrz `.sort` w `DialogueTracks`), bo od niej zależy, który klip
    // przykrywa przelewający się cień sąsiada — stąd tablica tu celowo ma
    // kolejność ODWRÓCONĄ względem czasu (najpierw późniejsza kwestia).
    useProject.getState().apply(project => ({
      ...project,
      shots: project.shots.map(shot => shot.id === 'a'
        ? {
            ...shot,
            dialogue: [
              line('later', ['s1'], 'pozniejsza', 5000, 6000),
              line('earlier', ['s1'], 'wczesniejsza', 1000, 2000),
            ],
          }
        : shot),
    }))
    render(<DialogueTracks scale={scale} />)
    const lane = screen.getByLabelText(/dialog S1/i)
    const clips = within(lane).getAllByRole('button')
    expect(clips.map(clip => clip.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/wczesniejsza/i),
      expect.stringMatching(/pozniejsza/i),
    ])
  })
})
