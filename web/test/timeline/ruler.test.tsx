import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Ruler } from '../../src/timeline/Ruler.js'
import { createScale } from '../../src/timeline/scale.js'
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
})
