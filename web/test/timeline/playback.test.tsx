import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { firePointer } from './pointer.js'
import { advancePlayback } from '../../src/timeline/usePlayback.js'
import { Playhead } from '../../src/timeline/Playhead.js'
import { createScale } from '../../src/timeline/scale.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { useLang } from '../../src/i18n/useT.js'

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  usePlayhead.setState({ ms: 0, playing: false })
})

describe('advancePlayback', () => {
  it('przesuwa czas o miniony odcinek', () => {
    expect(advancePlayback(1000, 100, 8000)).toEqual({ ms: 1100, playing: true })
  })

  it('zatrzymuje się na końcu wideo', () => {
    expect(advancePlayback(7950, 100, 8000)).toEqual({ ms: 8000, playing: false })
  })

  it('nie cofa się przy ujemnym odcinku', () => {
    expect(advancePlayback(1000, -50, 8000)).toEqual({ ms: 1000, playing: true })
  })

  it('pojedynczy przeskok dłuższy niż całe wideo kończy odtwarzanie', () => {
    expect(advancePlayback(0, 99999, 8000)).toEqual({ ms: 8000, playing: false })
  })
})

describe('Playhead', () => {
  it('stoi w miejscu odpowiadającym czasowi', () => {
    usePlayhead.setState({ ms: 4000, playing: false })
    render(<Playhead scale={createScale(8000, 800, 1)} />)
    expect(screen.getByRole('presentation', { name: /znacznik odtwarzania/i }).style.left)
      .toBe('400px')
  })

  it('przeciągnięcie przesuwa czas', () => {
    render(<Playhead scale={createScale(8000, 800, 1)} />)
    const handle = screen.getByRole('presentation', { name: /znacznik odtwarzania/i })
    handle.setPointerCapture = () => {}
    handle.releasePointerCapture = () => {}
    handle.parentElement!.getBoundingClientRect = () => ({ left: 0, width: 800 }) as DOMRect
    firePointer(handle, 'pointerdown', 0)
    firePointer(handle, 'pointermove', 200)
    firePointer(handle, 'pointerup', 200)
    expect(usePlayhead.getState().ms).toBe(2000)
  })
})
