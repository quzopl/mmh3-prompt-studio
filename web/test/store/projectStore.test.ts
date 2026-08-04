import { describe, it, expect, beforeEach } from 'vitest'
import type { Project } from '@mmh3/shared'
import { useProject } from '../../src/store/projectStore.js'

const base: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: '', assets: [], labels: [], speakers: [],
  shots: [{
    id: 'shot-1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
    composition: '', body: [], cameraMoves: [], dialogue: [], screenText: [],
    diegeticSfx: [], labelRefs: [], anchors: [],
  }],
  audio: { overallSoundscape: '', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

beforeEach(() => {
  useProject.setState({
    slug: null, project: null, prompt: '', tokens: [], diagnostics: [],
    past: [], future: [], dirty: false,
  })
})

describe('load', () => {
  it('ustawia projekt i od razu kompiluje prompt', () => {
    useProject.getState().load('test', base)
    const state = useProject.getState()
    expect(state.slug).toBe('test')
    expect(state.prompt).toContain('integrated_multimodal_description:')
    expect(state.dirty).toBe(false)
  })

  it('czyści historię cofania', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'Live-action' }))
    useProject.getState().load('test', base)
    expect(useProject.getState().past).toEqual([])
  })
})

describe('apply', () => {
  it('przelicza prompt i oznacza projekt jako zmieniony', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'Live-action, cinematic' }))
    const state = useProject.getState()
    expect(state.prompt).toContain('Live-action, cinematic')
    expect(state.dirty).toBe(true)
  })

  it('odkłada poprzedni stan na stos cofania', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'A' }))
    useProject.getState().apply(p => ({ ...p, style: 'B' }))
    expect(useProject.getState().past).toHaveLength(2)
  })

  it('recepta zwracająca ten sam obiekt nie zostawia śladu w historii', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => p)
    expect(useProject.getState().past).toEqual([])
    expect(useProject.getState().dirty).toBe(false)
  })

  it('nie wywraca się na modelu, którego nie da się skompilować', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({
      ...p,
      shots: p.shots.map(s => ({ ...s, body: [{ kind: 'camera' as const, moveId: 'nie-ma' }] })),
    }))
    const state = useProject.getState()
    expect(state.prompt).toBe('')
    expect(state.diagnostics.map(d => d.ruleId)).toContain('COMPILE_FAILED')
  })
})

describe('undo i redo', () => {
  it('cofa i ponawia zmianę', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'Live-action' }))
    useProject.getState().undo()
    expect(useProject.getState().project!.style).toBe('')
    useProject.getState().redo()
    expect(useProject.getState().project!.style).toBe('Live-action')
  })

  it('przelicza prompt przy cofnięciu', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'Live-action' }))
    useProject.getState().undo()
    expect(useProject.getState().prompt).not.toContain('Live-action')
  })

  it('nowa zmiana kasuje możliwość ponowienia', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'A' }))
    useProject.getState().undo()
    useProject.getState().apply(p => ({ ...p, style: 'B' }))
    expect(useProject.getState().future).toEqual([])
  })

  it('cofnięcie bez historii nic nie psuje', () => {
    useProject.getState().load('test', base)
    useProject.getState().undo()
    expect(useProject.getState().project!.style).toBe('')
    expect(useProject.getState().canUndo()).toBe(false)
  })

  it('raportuje dostępność cofania i ponawiania', () => {
    useProject.getState().load('test', base)
    expect(useProject.getState().canUndo()).toBe(false)
    useProject.getState().apply(p => ({ ...p, style: 'A' }))
    expect(useProject.getState().canUndo()).toBe(true)
    expect(useProject.getState().canRedo()).toBe(false)
    useProject.getState().undo()
    expect(useProject.getState().canRedo()).toBe(true)
  })
})

describe('apply z kluczem koalescencji', () => {
  it('zbija serię zmian z tym samym kluczem w jeden wpis historii', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'A' }), { coalesceKey: 'drag:shot-1' })
    useProject.getState().apply(p => ({ ...p, style: 'AB' }), { coalesceKey: 'drag:shot-1' })
    useProject.getState().apply(p => ({ ...p, style: 'ABC' }), { coalesceKey: 'drag:shot-1' })
    expect(useProject.getState().past).toHaveLength(1)
    expect(useProject.getState().project!.style).toBe('ABC')
  })

  it('cofnięcie po serii wraca do stanu sprzed całego gestu', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'A' }), { coalesceKey: 'drag:shot-1' })
    useProject.getState().apply(p => ({ ...p, style: 'AB' }), { coalesceKey: 'drag:shot-1' })
    useProject.getState().undo()
    expect(useProject.getState().project!.style).toBe('')
  })

  it('inny klucz zaczyna nowy wpis', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'A' }), { coalesceKey: 'drag:shot-1' })
    useProject.getState().apply(p => ({ ...p, style: 'B' }), { coalesceKey: 'drag:shot-2' })
    expect(useProject.getState().past).toHaveLength(2)
  })

  it('zmiana bez klucza przerywa serię', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'A' }), { coalesceKey: 'drag:shot-1' })
    useProject.getState().apply(p => ({ ...p, style: 'B' }))
    useProject.getState().apply(p => ({ ...p, style: 'C' }), { coalesceKey: 'drag:shot-1' })
    expect(useProject.getState().past).toHaveLength(3)
  })

  it('load czyści pamięć ostatniego klucza', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'A' }), { coalesceKey: 'drag:shot-1' })
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'B' }), { coalesceKey: 'drag:shot-1' })
    expect(useProject.getState().past).toHaveLength(1)
  })
})
