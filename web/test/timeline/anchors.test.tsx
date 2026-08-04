import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@mmh3/shared'
import { anchorsForMode } from '../../src/timeline/AnchorBadges.js'
import { ShotTrack } from '../../src/timeline/ShotTrack.js'
import { createScale } from '../../src/timeline/scale.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useLang } from '../../src/i18n/useT.js'

const shot = (id: string, index: number, startMs: number) => ({
  id, index, startMs, cutType: 'cut' as const, cutPhrase: 'the camera cuts to' as const,
  composition: '', body: [], cameraMoves: [], dialogue: [],
  screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
})

const project = (mode: Project['mode']): Project => ({
  schemaVersion: 1, id: 'p', name: 'Test', mode,
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic',
  assets: [],
  labels: mode === 'T2VA' ? [] : [
    { id: 'pic1', kind: 'picture', index: 1, assetIds: [], definition: '', role: '', standalone: true },
    { id: 'pic2', kind: 'picture', index: 2, assetIds: [], definition: '', role: '', standalone: true },
  ],
  speakers: [],
  shots: [shot('a', 0, 0)],
  audio: { overallSoundscape: 'Rain.', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
})

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useSelection.setState({ selected: [] })
})

describe('anchorsForMode', () => {
  it('tryb tekstowy nie ma kotwic', () => {
    expect(anchorsForMode('T2VA')).toEqual([])
  })

  it('I2VA kotwiczy tylko pierwszą klatkę', () => {
    expect(anchorsForMode('I2VA')).toEqual(['picture-first'])
  })

  it('FL2VA kotwiczy obie klatki', () => {
    expect(anchorsForMode('FL2VA')).toEqual(['picture-first', 'picture-last'])
  })

  it('L2VA kotwiczy tylko ostatnią klatkę', () => {
    expect(anchorsForMode('L2VA')).toEqual(['picture-last'])
  })

  it('tryb pełnoreferencyjny dopuszcza klatkę kluczową', () => {
    expect(anchorsForMode('REF')).toEqual(['keyframe'])
  })
})

describe('kotwice na klipie', () => {
  it('tryb tekstowy nie pokazuje żadnych przełączników', () => {
    useProject.getState().load('test', project('T2VA'))
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    expect(screen.queryByRole('button', { name: /przełącz kotwicę/i })).not.toBeInTheDocument()
  })

  it('ustawienie obu kotwic w FL2VA gasi błąd walidatora', async () => {
    useProject.getState().load('test', project('FL2VA'))
    expect(useProject.getState().diagnostics.map(d => d.ruleId)).toContain('ANCHOR_REQUIRED')

    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    await userEvent.click(screen.getByRole('button', { name: /przełącz kotwicę: pierwsza klatka/i }))
    await userEvent.click(screen.getByRole('button', { name: /przełącz kotwicę: ostatnia klatka/i }))

    expect(useProject.getState().project!.shots[0]!.anchors)
      .toEqual(['picture-first', 'picture-last'])
    expect(useProject.getState().diagnostics.map(d => d.ruleId)).not.toContain('ANCHOR_REQUIRED')
  })

  it('ponowne kliknięcie zdejmuje kotwicę', async () => {
    useProject.getState().load('test', project('I2VA'))
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    const badge = screen.getByRole('button', { name: /przełącz kotwicę: pierwsza klatka/i })
    await userEvent.click(badge)
    await userEvent.click(badge)
    expect(useProject.getState().project!.shots[0]!.anchors).toEqual([])
  })

  it('stan kotwicy jest widoczny dla czytnika ekranu', async () => {
    useProject.getState().load('test', project('I2VA'))
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    const badge = screen.getByRole('button', { name: /przełącz kotwicę: pierwsza klatka/i })
    expect(badge).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(badge)
    expect(badge).toHaveAttribute('aria-pressed', 'true')
  })
})
