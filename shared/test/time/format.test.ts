import { describe, it, expect } from 'vitest'
import { MS_PER_FRAME, snapToFrame, isFrameAligned } from '../../src/time/frames.js'
import { formatShotTime, formatAlignSeconds } from '../../src/time/format.js'

describe('klatki', () => {
  it('liczy długość klatki dla 24 fps', () => {
    expect(MS_PER_FRAME).toBeCloseTo(41.666, 2)
  })

  it('przyciąga do najbliższej klatki', () => {
    expect(snapToFrame(0)).toBe(0)
    expect(snapToFrame(40)).toBe(42)
    expect(snapToFrame(1000)).toBe(1000)
    expect(snapToFrame(3480)).toBe(3500)
  })

  it('rozpoznaje czas wyrównany do klatki', () => {
    expect(isFrameAligned(0)).toBe(true)
    expect(isFrameAligned(3500)).toBe(true)
    expect(isFrameAligned(3490)).toBe(false)
  })
})

describe('formatShotTime', () => {
  it('formatuje jako MM:SS.mmm', () => {
    expect(formatShotTime(0)).toBe('00:00.000')
    expect(formatShotTime(3500)).toBe('00:03.500')
    expect(formatShotTime(5000)).toBe('00:05.000')
    expect(formatShotTime(9000)).toBe('00:09.000')
    expect(formatShotTime(65432)).toBe('01:05.432')
  })

  it('zaokrągla niecałkowite milisekundy', () => {
    expect(formatShotTime(3500.7)).toBe('00:03.501')
    expect(formatShotTime(3500.2)).toBe('00:03.500')
  })
})

describe('formatAlignSeconds', () => {
  it('zawsze daje dwa miejsca po przecinku', () => {
    expect(formatAlignSeconds(0)).toBe('0.00')
    expect(formatAlignSeconds(6000)).toBe('6.00')
    expect(formatAlignSeconds(8000)).toBe('8.00')
    expect(formatAlignSeconds(7500)).toBe('7.50')
    expect(formatAlignSeconds(12340)).toBe('12.34')
  })

  it('prawidłowo zaokrągla wartości wiążące (tie values)', () => {
    expect(formatAlignSeconds(1005)).toBe('1.01')
    expect(formatAlignSeconds(8005)).toBe('8.01')
  })
})
