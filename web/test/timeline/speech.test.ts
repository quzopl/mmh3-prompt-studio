import { describe, expect, it } from 'vitest'
import { countWords, naturalDurationMs, DEFAULT_WORDS_PER_MINUTE } from '../../src/timeline/speech.js'

describe('countWords', () => {
  it('liczy słowa oddzielone dowolną białą spacją', () => {
    expect(countWords('jedno dwa\ttrzy\ncztery')).toBe(4)
  })

  it('nie liczy pustego ciągu ani samych spacji', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
  })

  it('nie rozbija słowa na apostrofie ani myślniku', () => {
    expect(countWords("don't stop")).toBe(2)
    expect(countWords('czarno-biały film')).toBe(2)
  })
})

describe('naturalDurationMs', () => {
  it('sto pięćdziesiąt słów przy stu pięćdziesięciu na minutę to minuta', () => {
    const text = Array.from({ length: 150 }, () => 'słowo').join(' ')
    expect(naturalDurationMs(text, DEFAULT_WORDS_PER_MINUTE)).toBe(60000)
  })

  it('szybsze tempo skraca kwestię', () => {
    const text = 'jedno dwa trzy cztery pięć sześć'
    expect(naturalDurationMs(text, 300)).toBeLessThan(naturalDurationMs(text, 150))
  })

  it('pusta kwestia trwa zero', () => {
    expect(naturalDurationMs('', DEFAULT_WORDS_PER_MINUTE)).toBe(0)
  })

  it('tempo zerowe albo ujemne nie daje nieskończoności', () => {
    expect(Number.isFinite(naturalDurationMs('jedno dwa', 0))).toBe(true)
    expect(Number.isFinite(naturalDurationMs('jedno dwa', -5))).toBe(true)
  })
})
