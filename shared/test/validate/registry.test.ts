import { describe, it, expect } from 'vitest'
import { defineRule, makeDiagnostic } from '../../src/validate/types.js'
import { validateWith } from '../../src/validate/validate.js'
import { compile } from '../../src/compile/compile.js'
import { t2vaProject } from '../golden/fixtures/base.js'

const alwaysFails = defineRule({
  id: 'TEST_ALWAYS',
  severity: 'error',
  guideRef: 'test',
  run: ({ project }) => [
    makeDiagnostic(alwaysFails, { kind: 'project', id: project.id }, 'zawsze', 'always'),
  ],
})

const neverFails = defineRule({
  id: 'TEST_NEVER', severity: 'warning', guideRef: 'test', run: () => [],
})

describe('walidator', () => {
  it('zbiera diagnostyki ze wszystkich reguł', () => {
    const compiled = compile(t2vaProject)
    const out = validateWith([alwaysFails, neverFails], t2vaProject, compiled)
    expect(out).toHaveLength(1)
    expect(out[0]!.ruleId).toBe('TEST_ALWAYS')
    expect(out[0]!.severity).toBe('error')
    expect(out[0]!.message).toBe('zawsze')
    expect(out[0]!.messageEn).toBe('always')
    expect(out[0]!.guideRef).toBe('test')
  })

  it('nie przerywa serii, gdy reguła rzuci wyjątek', () => {
    const throwing = defineRule({
      id: 'TEST_THROWS', severity: 'error', guideRef: 'test',
      run: () => { throw new Error('bum') },
    })
    const compiled = compile(t2vaProject)
    const out = validateWith([throwing, alwaysFails], t2vaProject, compiled)
    expect(out.map(d => d.ruleId)).toContain('TEST_ALWAYS')
    expect(out.find(d => d.ruleId === 'TEST_THROWS')?.message).toContain('bum')
  })

  it('sortuje wynik: błędy, ostrzeżenia, wskazówki', () => {
    const hint = defineRule({
      id: 'TEST_HINT', severity: 'hint', guideRef: 'test',
      run: ({ project }) => [makeDiagnostic(hint, { kind: 'project', id: project.id }, 'w', 'h')],
    })
    const compiled = compile(t2vaProject)
    const out = validateWith([hint, alwaysFails], t2vaProject, compiled)
    expect(out.map(d => d.severity)).toEqual(['error', 'hint'])
  })
})
