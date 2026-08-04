import { describe, it, expect } from 'vitest'
import type { Token } from '@mmh3/shared'
import { shotAtMs, shotExcerpt } from '../../src/panels/shotExcerpt.js'

const span = (id: string, startMs: number, endMs: number) => ({
  shot: { id, index: 0, startMs } as never, startMs, endMs,
})

describe('shotAtMs', () => {
  const spans = [span('a', 0, 3000), span('b', 3000, 8000)]

  it('trafia w ujęcie zawierające czas', () => {
    expect(shotAtMs(spans, 1500)?.shot.id).toBe('a')
    expect(shotAtMs(spans, 5000)?.shot.id).toBe('b')
  })

  it('początek ujęcia należy do niego, nie do poprzedniego', () => {
    expect(shotAtMs(spans, 3000)?.shot.id).toBe('b')
  })

  it('koniec wideo należy do ostatniego ujęcia', () => {
    expect(shotAtMs(spans, 8000)?.shot.id).toBe('b')
  })

  it('zwraca nic dla pustej listy', () => {
    expect(shotAtMs([], 1000)).toBeUndefined()
  })
})

describe('shotExcerpt', () => {
  const prompt = 'nagłówek: [Shot 1] pierwsze ujęcie. [Shot 2] drugie ujęcie.'
  const tokens: Token[] = [
    { start: 10, end: 18, ref: { kind: 'shot', id: 'a' } },
    { start: 36, end: 44, ref: { kind: 'shot', id: 'b' } },
  ]

  it('wycina fragment od nagłówka ujęcia do następnego', () => {
    expect(shotExcerpt(prompt, tokens, 'a')).toBe('[Shot 1] pierwsze ujęcie.')
  })

  it('ostatnie ujęcie sięga końca tekstu', () => {
    expect(shotExcerpt(prompt, tokens, 'b')).toBe('[Shot 2] drugie ujęcie.')
  })

  it('zwraca pusty ciąg, gdy tokenu nie ma', () => {
    expect(shotExcerpt(prompt, tokens, 'nie-ma')).toBe('')
  })

  it('radzi sobie z pustym promptem', () => {
    expect(shotExcerpt('', [], 'a')).toBe('')
  })
})
