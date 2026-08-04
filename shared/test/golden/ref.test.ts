import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { emitRef } from '../../src/compile/emitRef.js'
import { refProject } from './fixtures/ref.js'

const here = dirname(fileURLToPath(import.meta.url))

describe('test złoty — tryb pełnoreferencyjny', () => {
  it('odtwarza pełny przykład z guide_ref §7 znak w znak', () => {
    const expected = readFileSync(join(here, 'expected', 'ref.txt'), 'utf8').replace(/\n$/, '')
    expect(emitRef(refProject)).toBe(expected)
  })
})
