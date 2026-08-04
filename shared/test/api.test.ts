import { describe, it, expect } from 'vitest'
import { buildPrompt, isExportReady, registerAllRules } from '../src/api.js'
import { allRules } from '../src/validate/registry.js'
import { t2vaProject, l2vaProject } from './golden/fixtures/base.js'
import { refProject } from './golden/fixtures/ref.js'

describe('buildPrompt', () => {
  it('rejestracja reguł jest idempotentna', () => {
    expect(() => { registerAllRules(); registerAllRules() }).not.toThrow()
  })

  it('zwraca tekst, tokeny i diagnostykę', () => {
    const result = buildPrompt(t2vaProject)
    expect(result.text).toContain('integrated_multimodal_description:')
    expect(result.tokens.length).toBeGreaterThan(0)
    expect(result.diagnostics).toEqual([])
  })

  it('uznaje projekt bez błędów za gotowy do eksportu', () => {
    expect(isExportReady(buildPrompt(t2vaProject).diagnostics)).toBe(true)
    expect(isExportReady(buildPrompt(l2vaProject).diagnostics)).toBe(true)
  })

  it('ostrzeżenie nie blokuje eksportu', () => {
    const result = buildPrompt(refProject)
    expect(result.diagnostics.map(d => d.ruleId)).toEqual(['REF_WORD_COUNT'])
    expect(isExportReady(result.diagnostics)).toBe(true)
  })

  it('błąd blokuje eksport', () => {
    const broken = { ...t2vaProject, video: { ...t2vaProject.video, durationMs: 1000 } }
    const result = buildPrompt(broken)
    expect(result.diagnostics.some(d => d.severity === 'error')).toBe(true)
    expect(isExportReady(result.diagnostics)).toBe(false)
  })

  it('nie rzuca wyjątkiem przy wiszącej referencji i pozwala regułom przemówić', () => {
    const shots = [...t2vaProject.shots]
    shots[0] = { ...shots[0]!, cameraMoves: [] }
    const result = buildPrompt({ ...t2vaProject, shots })
    const ids = result.diagnostics.map(d => d.ruleId)
    expect(ids).toContain('COMPILE_FAILED')
    expect(ids).toContain('BODY_REFS_COMPLETE')
    expect(isExportReady(result.diagnostics)).toBe(false)
  })

  it('nieznany typ ruchu kamery daje diagnostykę, nie wyjątek', () => {
    const shots = [...t2vaProject.shots]
    shots[0] = {
      ...shots[0]!,
      cameraMoves: [{ ...shots[0]!.cameraMoves[0]!, type: 'dolly-zoom' as never }],
    }
    const ids = buildPrompt({ ...t2vaProject, shots }).diagnostics.map(d => d.ruleId)
    expect(ids).toContain('CAM_VOCAB')
  })

  it('COMPILE_FAILED jest regułą z rejestru, nie identyfikatorem znikąd', () => {
    registerAllRules()
    expect(allRules().map(r => r.id)).toContain('COMPILE_FAILED')
  })
})
