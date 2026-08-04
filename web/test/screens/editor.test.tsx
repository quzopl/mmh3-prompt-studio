import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import type { Project } from '@mmh3/shared'
import { Editor } from '../../src/screens/Editor.js'
import { api } from '../../src/api/client.js'
import { useProject } from '../../src/store/projectStore.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useLang } from '../../src/i18n/useT.js'

const shot = (id: string, index: number, startMs: number) => ({
  id, index, startMs, cutType: 'cut' as const, cutPhrase: 'the camera cuts to' as const,
  composition: '', body: [], cameraMoves: [], dialogue: [],
  screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
})

const project = (name: string, durationMs: number): Project => ({
  schemaVersion: 1, id: name, name, mode: 'T2VA',
  video: { durationMs, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic', assets: [], labels: [], speakers: [],
  shots: [shot('a', 0, 0), shot('b', 1, Math.round(durationMs / 2))],
  audio: { overallSoundscape: 'Rain.', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
})

const LONG = project('Długi', 15000)
const SHORT = project('Krótki', 4000)

/**
 * Pętla odtwarzania nie ma tu nic do roboty — te testy ustawiają `playing`
 * tylko po to, żeby sprawdzić, czy przełączenie projektu ten stan zeruje.
 * Puste `requestAnimationFrame` powstrzymuje `usePlayback` przed przesuwaniem
 * znacznika w tle i czyni asercje deterministycznymi.
 */
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.spyOn(api, 'getProject').mockImplementation(async slug => ({
    project: slug === 'dlugi' ? LONG : SHORT,
    prompt: '', tokens: [], diagnostics: [],
  }))
  useLang.setState({ lang: 'pl' })
  useSelection.setState({ selected: [] })
  usePlayhead.setState({ ms: 0, playing: false })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const openedName = (name: string) => waitFor(() =>
  expect(screen.getByText(name)).toBeInTheDocument())

describe('Editor — przełączenie projektu', () => {
  it('zeruje pozycję znacznika i zatrzymuje odtwarzanie', async () => {
    // Znacznik odtwarzania żyje w globalnym magazynie, tak samo jak projekt.
    // Reset dotyczył dotąd wyłącznie projektu, więc pozycja 14000 ms i włączone
    // odtwarzanie przechodziły do projektu trwającego 4000 ms: odtwarzanie
    // startowało bez prośby i od razu przeskakiwało na koniec materiału, a przed
    // tą klatką pasek narzędzi pokazywał 14000 ms dla 4000-milisekundowego wideo.
    const view = render(<Editor slug="dlugi" onClose={() => {}} />)
    await openedName('Długi')

    act(() => usePlayhead.setState({ ms: 14000, playing: true }))

    view.rerender(<Editor slug="krotki" onClose={() => {}} />)
    await openedName('Krótki')
    await waitFor(() =>
      expect(useProject.getState().project?.video.durationMs).toBe(4000))

    expect(usePlayhead.getState().ms).toBe(0)
    expect(usePlayhead.getState().playing).toBe(false)
  })

  it('cofanie i ponawianie są wyłączone, dopóki nie ma czego cofać', async () => {
    // Oba przyciski były włączone zawsze — stąd wzięły się nieużywane
    // `canUndo`/`canRedo` w sklepie: ktoś przewidział tę potrzebę i nikt jej
    // nie podłączył. Zamiast trzymać martwe akcesory, przyciski czytają
    // długość historii wprost (subskrypcja na `past.length`, a nie na funkcji
    // gettera — ta ma stałą referencję i nigdy nie wywołałaby przemalowania).
    render(<Editor slug="dlugi" onClose={() => {}} />)
    await openedName('Długi')

    const undo = screen.getByRole('button', { name: /^cofnij$/i })
    const redo = screen.getByRole('button', { name: /^ponów$/i })
    expect(undo).toBeDisabled()
    expect(redo).toBeDisabled()

    act(() => useProject.getState().apply(p => ({ ...p, style: 'Anime' })))
    expect(undo).toBeEnabled()
    expect(redo).toBeDisabled()

    act(() => useProject.getState().undo())
    expect(undo).toBeDisabled()
    expect(redo).toBeEnabled()
  })

  it('odmontowanie edytora też zeruje znacznik', async () => {
    // Powrót do listy projektów zostawiał odtwarzanie włączone — kolejny
    // otwarty projekt zastawał je już w biegu.
    const view = render(<Editor slug="dlugi" onClose={() => {}} />)
    await openedName('Długi')
    act(() => usePlayhead.setState({ ms: 14000, playing: true }))

    view.unmount()

    expect(usePlayhead.getState().ms).toBe(0)
    expect(usePlayhead.getState().playing).toBe(false)
  })
})
