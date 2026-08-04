import { describe, it, expect, beforeEach } from 'vitest'
import { usePlayhead } from '../../src/store/playheadStore.js'

beforeEach(() => usePlayhead.setState({ ms: 0, playing: false }))

describe('usePlayhead', () => {
  it('przycina pozycję do długości wideo', () => {
    usePlayhead.getState().setMs(-100, 8000)
    expect(usePlayhead.getState().ms).toBe(0)
    usePlayhead.getState().setMs(99999, 8000)
    expect(usePlayhead.getState().ms).toBe(8000)
  })

  it('przyciąga pozycję do granicy klatki', () => {
    usePlayhead.getState().setMs(1000, 8000)
    expect(usePlayhead.getState().ms).toBe(1000)
    usePlayhead.getState().setMs(30, 8000)
    expect(usePlayhead.getState().ms).toBe(42)
  })

  it('przesuwa o zadaną liczbę klatek', () => {
    usePlayhead.getState().setMs(1000, 8000)
    usePlayhead.getState().stepFrames(1, 8000)
    expect(usePlayhead.getState().ms).toBe(1042)
    usePlayhead.getState().stepFrames(-1, 8000)
    expect(usePlayhead.getState().ms).toBe(1000)
  })

  it('nie wychodzi poza zakres przy przesuwaniu', () => {
    usePlayhead.getState().setMs(0, 8000)
    usePlayhead.getState().stepFrames(-10, 8000)
    expect(usePlayhead.getState().ms).toBe(0)
  })

  it('nie wychodzi poza materiał, gdy długość nie leży na granicy klatki', () => {
    usePlayhead.getState().setMs(4999, 4999)
    expect(usePlayhead.getState().ms).toBeLessThanOrEqual(4999)
    expect(usePlayhead.getState().ms).toBe(4958)
  })

  it('przełącza odtwarzanie', () => {
    usePlayhead.getState().toggle()
    expect(usePlayhead.getState().playing).toBe(true)
    usePlayhead.getState().toggle()
    expect(usePlayhead.getState().playing).toBe(false)
  })

  it('zatrzymuje odtwarzanie przy resecie', () => {
    usePlayhead.getState().play()
    usePlayhead.getState().setMs(4000, 8000)
    usePlayhead.getState().reset()
    expect(usePlayhead.getState()).toMatchObject({ ms: 0, playing: false })
  })
})
