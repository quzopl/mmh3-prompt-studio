import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Ruler } from '../../src/timeline/Ruler.js'
import { createScale, msToPx } from '../../src/timeline/scale.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { useLang } from '../../src/i18n/useT.js'
import { firePointer } from './pointer.js'

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  usePlayhead.setState({ ms: 0, playing: false })
})

describe('Ruler', () => {
  it('podpisuje pełne sekundy', () => {
    render(<Ruler scale={createScale(8000, 800, 1)} />)
    expect(screen.getByText('0s')).toBeInTheDocument()
    expect(screen.getByText('8s')).toBeInTheDocument()
  })

  it('nie rysuje znaczników klatek przy małym zoomie', () => {
    const { container } = render(<Ruler scale={createScale(8000, 800, 1)} />)
    expect(container.querySelectorAll('[data-frame-tick]')).toHaveLength(0)
  })

  it('rysuje znaczniki klatek przy dużym zoomie', () => {
    const { container } = render(<Ruler scale={createScale(8000, 800, 64)} />)
    expect(container.querySelectorAll('[data-frame-tick]').length).toBeGreaterThan(100)
  })

  it('kliknięcie ustawia playhead na wskazanym czasie', () => {
    const scale = createScale(8000, 800, 1)
    render(<Ruler scale={scale} />)
    const ruler = screen.getByRole('slider', { name: /linijka czasu/i })
    ruler.getBoundingClientRect = () => ({ left: 0, width: 800 }) as DOMRect
    firePointer(ruler, 'pointerdown', 400)
    expect(usePlayhead.getState().ms).toBe(4000)
  })

  /**
   * Runda poprawek 2 (recenzja w Chromium): ostatnia etykieta sekundy (i, przy
   * dużym zoomie, ostatnia kreska klatki) nie ma NIC po prawej stronie —
   * pozostałe znaczniki mają sąsiada z prawej i bezpiecznie rozwijają się w
   * tamtą stronę (`left: pozycjaZnacznika`, etykieta dosunięta `left-1`).
   * Sprzed naprawy OSTATNI znacznik dostawał `left` RÓWNE pełnej szerokości
   * osi — sam ten fakt gwarantuje wystawanie, bo cokolwiek ma jeszcze
   * szerokość (1px kreski, tekst etykiety) rośnie w prawo OD krawędzi, nie
   * wewnątrz niej. Test dowodzi: żaden znacznik nie ma `left` ustawionego na
   * szerokość osi (albo więcej) — jedyny sposób, żeby ten fakt był fałszywy, to
   * zakotwiczenie ostatniego znacznika do prawej krawędzi (`right: 0`) zamiast
   * do lewej pełną szerokością.
   */
  it('żaden znacznik linijki nie ma `left` ustawionego na szerokość osi (ostatni jest zakotwiczony do prawej krawędzi)', () => {
    const scale = createScale(8000, 800, 1)
    const { container } = render(<Ruler scale={scale} />)
    const axisWidthPx = msToPx(scale, scale.durationMs)

    const terminalLabel = container.querySelector('[data-terminal-label]')
    expect(terminalLabel).not.toBeNull()

    const elementsWithLeft = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .filter(element => element.style.left !== '')
    // Sanity: inne znaczniki (nieostatnie) nadal pozycjonują się przez `left`
    // — gdyby lista była pusta, test niżej przechodziłby bez powodu.
    expect(elementsWithLeft.length).toBeGreaterThan(0)
    for (const element of elementsWithLeft) {
      expect(Number.parseFloat(element.style.left)).toBeLessThan(axisWidthPx)
    }

    // Ostatnia etykieta i jej kreska używają `right`, nie `left` — zakotwiczone
    // do prawej krawędzi osi, rozwijają się do wewnątrz materiału.
    const wrapper = terminalLabel?.parentElement
    expect(wrapper?.style.left).toBe('')
    expect(wrapper?.style.right).toBe('0px')
  })

  it('przy dużym zoomie ostatnia kreska klatki też jest zakotwiczona do prawej krawędzi, nie wystaje', () => {
    const scale = createScale(8000, 800, 64)
    const { container } = render(<Ruler scale={scale} />)
    const axisWidthPx = msToPx(scale, scale.durationMs)
    const frameTicks = Array.from(container.querySelectorAll<HTMLElement>('[data-frame-tick]'))
    expect(frameTicks.length).toBeGreaterThan(100)
    for (const tick of frameTicks) {
      if (tick.style.left === '') {
        // Zakotwiczona do prawej — nie ma `left` w ogóle, więc nie może
        // wystawać z tej strony.
        expect(tick.style.right).toBe('0px')
        continue
      }
      expect(Number.parseFloat(tick.style.left)).toBeLessThan(axisWidthPx)
    }
  })
})
