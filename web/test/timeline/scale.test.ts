import { describe, it, expect } from 'vitest'
import {
  clampZoom, createScale, frameTicks, msToPx, pxToMs, secondTicks, snapMs,
  MAX_ZOOM, MIN_ZOOM,
} from '../../src/timeline/scale.js'

const scale = (zoom = 1) => createScale(8000, 800, zoom)

describe('createScale', () => {
  it('przy zoomie 1 mieści całą długość w dostępnej szerokości', () => {
    expect(msToPx(scale(), 8000)).toBe(800)
    expect(msToPx(scale(), 0)).toBe(0)
  })

  it('zoom mnoży szerokość, nie długość', () => {
    expect(msToPx(scale(2), 8000)).toBe(1600)
    expect(scale(2).durationMs).toBe(8000)
  })

  it('ogranicza zoom do dozwolonego zakresu', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM)
    expect(clampZoom(1000)).toBe(MAX_ZOOM)
    expect(clampZoom(4)).toBe(4)
  })

  it('nie dzieli przez zero przy zerowej szerokości', () => {
    expect(msToPx(createScale(8000, 0, 1), 4000)).toBe(0)
    expect(pxToMs(createScale(8000, 0, 1), 100)).toBe(0)
  })
})

describe('pxToMs', () => {
  it('jest odwrotnością msToPx', () => {
    const s = scale(3)
    for (const ms of [0, 1234, 4000, 7999, 8000]) {
      expect(Math.round(pxToMs(s, msToPx(s, ms)))).toBe(ms)
    }
  })

  it('przycina do zakresu wideo', () => {
    expect(pxToMs(scale(), -50)).toBe(0)
    expect(pxToMs(scale(), 5000)).toBe(8000)
  })
})

describe('secondTicks', () => {
  it('daje znacznik na każdą pełną sekundę wraz z końcem', () => {
    expect(secondTicks(scale())).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000])
  })

  it('nie gubi ostatniej sekundy przy niepełnej długości', () => {
    expect(secondTicks(createScale(8500, 800, 1))).toEqual(
      [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 8500],
    )
  })
})

describe('frameTicks', () => {
  it('milczy, dopóki klatki są nieczytelnie gęste', () => {
    expect(frameTicks(scale(1))).toEqual([])
  })

  it('przy dużym zoomie daje znaczniki co klatkę', () => {
    const ticks = frameTicks(scale(MAX_ZOOM))
    expect(ticks.length).toBeGreaterThan(100)
    expect(ticks[0]).toBe(0)
    expect(ticks[1]).toBe(42)
  })
})

describe('snapMs', () => {
  it('przyciąga do najbliższego punktu w zasięgu', () => {
    expect(snapMs(4980, [0, 5000, 8000], 50)).toBe(5000)
  })

  it('zostawia wartość, gdy nic nie jest w zasięgu', () => {
    expect(snapMs(4000, [0, 5000, 8000], 50)).toBe(4000)
  })

  it('wybiera bliższy punkt, gdy dwa są w zasięgu', () => {
    expect(snapMs(4990, [4900, 5000], 200)).toBe(5000)
  })

  it('radzi sobie z pustą listą punktów', () => {
    expect(snapMs(1234, [], 50)).toBe(1234)
  })
})
