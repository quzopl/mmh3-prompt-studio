import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { emitBase } from '../../src/compile/emitBase.js'
import { t2vaProject, i2vaProject, fl2vaProject, l2vaProject } from './fixtures/base.js'

const here = dirname(fileURLToPath(import.meta.url))
const expected = (name: string) =>
  readFileSync(join(here, 'expected', `${name}.txt`), 'utf8').replace(/\n$/, '')

describe('testy złote — tryby bazowe', () => {
  it('T2VA odtwarza Case 1 znak w znak', () => {
    expect(emitBase(t2vaProject)).toBe(expected('t2va'))
  })

  it('I2VA odtwarza Case 2 znak w znak', () => {
    expect(emitBase(i2vaProject)).toBe(expected('i2va'))
  })

  it('FL2VA odtwarza Case 3 znak w znak', () => {
    expect(emitBase(fl2vaProject)).toBe(expected('fl2va'))
  })

  it('L2VA odtwarza Case 4 znak w znak', () => {
    expect(emitBase(l2vaProject)).toBe(expected('l2va'))
  })
})
