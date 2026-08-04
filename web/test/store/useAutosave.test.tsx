import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { Project } from '@mmh3/shared'
import { useAutosave } from '../../src/store/useAutosave.js'
import { useProject } from '../../src/store/projectStore.js'
import { api } from '../../src/api/client.js'

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: '', assets: [], labels: [], speakers: [],
  shots: [{
    id: 'shot-1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
    composition: '', body: [], cameraMoves: [], dialogue: [],
    screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
  }],
  audio: { overallSoundscape: '', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

beforeEach(() => {
  useProject.getState().load('test', project)
})

afterEach(() => vi.restoreAllMocks())

describe('useAutosave', () => {
  it('nie zapisuje projektu, którego nikt nie zmienił', async () => {
    const save = vi.spyOn(api, 'saveProject').mockResolvedValue({ prompt: '', tokens: [], diagnostics: [] })
    renderHook(() => useAutosave('test', 5))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(save).not.toHaveBeenCalled()
  })

  it('zapisuje po chwili bezczynności', async () => {
    const save = vi.spyOn(api, 'saveProject').mockResolvedValue({ prompt: '', tokens: [], diagnostics: [] })
    renderHook(() => useAutosave('test', 5))
    act(() => useProject.getState().apply(p => ({ ...p, style: 'Live-action' })))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0]![1].style).toBe('Live-action')
  })

  it('zbija serię szybkich zmian w jeden zapis', async () => {
    const save = vi.spyOn(api, 'saveProject').mockResolvedValue({ prompt: '', tokens: [], diagnostics: [] })
    renderHook(() => useAutosave('test', 20))
    act(() => {
      useProject.getState().apply(p => ({ ...p, style: 'A' }))
      useProject.getState().apply(p => ({ ...p, style: 'AB' }))
      useProject.getState().apply(p => ({ ...p, style: 'ABC' }))
    })
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0]![1].style).toBe('ABC')
  })

  it('zdejmuje znacznik zmiany po udanym zapisie', async () => {
    vi.spyOn(api, 'saveProject').mockResolvedValue({ prompt: '', tokens: [], diagnostics: [] })
    renderHook(() => useAutosave('test', 5))
    act(() => useProject.getState().apply(p => ({ ...p, style: 'X' })))
    await waitFor(() => expect(useProject.getState().dirty).toBe(false))
  })

  it('nie uznaje za zapisaną edycji wykonanej w trakcie zapisu', async () => {
    let release: () => void = () => {}
    vi.spyOn(api, 'saveProject').mockImplementation(
      () => new Promise(resolve => { release = () => resolve({ prompt: '', tokens: [], diagnostics: [] }) }),
    )
    renderHook(() => useAutosave('test', 5))
    act(() => useProject.getState().apply(p => ({ ...p, style: 'pierwsza' })))
    await waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1))
    act(() => useProject.getState().apply(p => ({ ...p, style: 'druga' })))
    act(() => release())
    await waitFor(() => expect(useProject.getState().project!.style).toBe('druga'))
    expect(useProject.getState().dirty).toBe(true)
  })

  it('nie zapisuje, gdy w sklepie leży już inny projekt', async () => {
    // `beforeEach` ładuje sklep ze slugiem 'test', więc hook zamontowany dla
    // 'inny-slug' nie ma prawa nic wysłać.
    const save = vi.spyOn(api, 'saveProject').mockResolvedValue({ prompt: '', tokens: [], diagnostics: [] })
    renderHook(() => useAutosave('inny-slug', 5))
    act(() => useProject.getState().apply(p => ({ ...p, style: 'A' })))
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(save).not.toHaveBeenCalled()
  })

  it('pokazuje błąd i zostawia znacznik zmiany, gdy zapis padnie', async () => {
    vi.spyOn(api, 'saveProject').mockRejectedValue(new Error('dysk pełny'))
    const { result } = renderHook(() => useAutosave('test', 5))
    act(() => useProject.getState().apply(p => ({ ...p, style: 'X' })))
    await waitFor(() => expect(result.current.error).toMatch(/dysk pełny/))
    expect(useProject.getState().dirty).toBe(true)
  })
})
