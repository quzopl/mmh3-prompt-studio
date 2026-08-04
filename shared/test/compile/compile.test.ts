import { describe, it, expect } from 'vitest'
import { compile } from '../../src/compile/compile.js'
import { t2vaProject } from '../golden/fixtures/base.js'
import { refProject } from '../golden/fixtures/ref.js'

describe('compile', () => {
  it('wybiera emiter bazowy dla trybów bazowych', () => {
    expect(compile(t2vaProject).text).toContain('integrated_multimodal_description:')
  })

  it('wybiera emiter referencyjny dla REF', () => {
    expect(compile(refProject).text).toContain('subject_definitions:')
  })

  it('mapuje nagłówek ujęcia na obiekt ujęcia', () => {
    const { text, tokens } = compile(t2vaProject)
    const shot2 = tokens.find(t => t.ref.kind === 'shot' && t.ref.id === 's2')
    expect(shot2).toBeDefined()
    expect(text.slice(shot2!.start, shot2!.end)).toBe('[Shot 2]')
  })

  it('mapuje frazę ruchu kamery na obiekt ruchu', () => {
    const { text, tokens } = compile(t2vaProject)
    const cam = tokens.find(t => t.ref.kind === 'camera' && t.ref.id === 'c1')
    expect(text.slice(cam!.start, cam!.end))
      .toBe('The camera pushes in with small amplitude at slow speed')
  })

  it('mapuje blok dialogowy na zdarzenie', () => {
    const { text, tokens } = compile(t2vaProject)
    const dlg = tokens.find(t => t.ref.kind === 'dialogue' && t.ref.id === 'd1')
    expect(text.slice(dlg!.start, dlg!.end))
      .toBe('says: <d>[English] First batch of the morning.</d>')
  })

  it('mapuje etykiety w trybie REF', () => {
    const { text, tokens } = compile(refProject)
    const label = tokens.find(t => t.ref.kind === 'label' && t.ref.id === 'sub1')
    expect(text.slice(label!.start, label!.end)).toBe('<Subject 1>')
  })

  it('token ujęcia 1 w trybie REF wskazuje opis, a nie retention_analysis', () => {
    const { text, tokens } = compile(refProject)
    const shot1 = tokens.find(t => t.ref.kind === 'shot' && t.ref.id === 's1')
    expect(shot1).toBeDefined()
    expect(shot1!.start).toBeGreaterThan(text.indexOf('detailed_description:'))
    expect(text.slice(shot1!.start, shot1!.end)).toBe('[Shot 1]')
  })

  it('zwraca tokeny w rosnącej kolejności pozycji', () => {
    const { tokens } = compile(refProject)
    const starts = tokens.map(t => t.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })
})
