import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createScale, msToPx } from '../../src/timeline/scale.js'
import { DialogueTracks } from '../../src/timeline/DialogueTracks.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useSpeechRate } from '../../src/store/speechRateStore.js'
import { DEFAULT_WORDS_PER_MINUTE, naturalDurationMs } from '../../src/timeline/speech.js'
import { projectWithDialogue } from './fixtures.js'

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
    expect(shadowD1.style.width)
      .toBe(`${msToPx(scale, naturalDurationMs('jedno dwa', DEFAULT_WORDS_PER_MINUTE))}px`)
    expect(shadowD3.style.width)
      .toBe(`${msToPx(scale, naturalDurationMs('razem', DEFAULT_WORDS_PER_MINUTE))}px`)
    // Dwa słowa w d1 kontra jedno w d3 — cień d1 musi być dwa razy szerszy,
    // bo `naturalDurationMs` rośnie liniowo z liczbą słów przy stałym tempie.
    expect(Number.parseFloat(shadowD1.style.width)).toBe(2 * Number.parseFloat(shadowD3.style.width))
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
})
