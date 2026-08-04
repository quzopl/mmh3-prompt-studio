import { describe, it, expect } from 'vitest'
import { VERSION } from '../src/index.js'

describe('pakiet shared', () => {
  it('eksportuje wersję', () => {
    expect(VERSION).toBe('0.1.0')
  })
})
