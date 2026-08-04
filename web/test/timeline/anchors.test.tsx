import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@mmh3/shared'
import { anchorsForShot } from '../../src/timeline/AnchorBadges.js'
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

describe('anchorsForShot', () => {
  it('tryb tekstowy nie ma kotwic', () => {
    expect(anchorsForShot('T2VA', true)).toEqual([])
  })

  it('I2VA kotwiczy tylko pierwszą klatkę', () => {
    expect(anchorsForShot('I2VA', true)).toEqual(['picture-first'])
  })

  it('FL2VA kotwiczy obie klatki niezależnie od pozycji ujęcia', () => {
    // Żadna reguła nie wiąże pary kotwic FL2VA z konkretnym ujęciem.
    expect(anchorsForShot('FL2VA', false)).toEqual(['picture-first', 'picture-last'])
  })

  it('L2VA kotwiczy ostatnie ujęcie', () => {
    expect(anchorsForShot('L2VA', true)).toEqual(['picture-last'])
  })

  it('L2VA nie oferuje kotwicy na ujęciu innym niż ostatnie', () => {
    // L2VA_ANCHOR_LAST_SHOT wymaga, żeby kotwica siedziała akurat na ostatnim
    // ujęciu — oferowanie jej gdzie indziej prowadziłoby donikąd.
    expect(anchorsForShot('L2VA', false)).toEqual([])
  })

  it('tryb pełnoreferencyjny dopuszcza klatkę kluczową', () => {
    expect(anchorsForShot('REF', true)).toEqual(['keyframe'])
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

  it('nazwa dostępności odznaki wskazuje, do którego ujęcia należy', async () => {
    // Regresja: `aria-label` klipu nie "spływa" do dziecka, które ma własny
    // `aria-label` — bez numeru ujęcia w treści dwie odznaki tego samego typu
    // na różnych klipach miałyby identyczną nazwę dostępności.
    useProject.getState().load('test', {
      ...project('I2VA'),
      shots: [shot('a', 0, 0), shot('b', 1, 4000)],
    })
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    expect(screen.getByRole('button', { name: /przełącz kotwicę: pierwsza klatka — ujęcie 1/i }))
      .toBeInTheDocument()
    expect(screen.getByRole('button', { name: /przełącz kotwicę: pierwsza klatka — ujęcie 2/i }))
      .toBeInTheDocument()
  })

  it('L2VA pokazuje kotwicę tylko na ostatnim ujęciu', () => {
    useProject.getState().load('test', {
      ...project('L2VA'),
      shots: [shot('a', 0, 0), shot('b', 1, 4000)],
    })
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    const badges = screen.getAllByRole('button', { name: /przełącz kotwicę: ostatnia klatka/i })
    expect(badges).toHaveLength(1)
    expect(badges[0]).toHaveAccessibleName(/ujęcie 2/i)
  })

  it('kliknięcie odznaki nie zmienia zaznaczenia klipu', async () => {
    // `stopPropagation` w AnchorBadges musi powstrzymać kliknięcie od
    // przebicia się do handlera zaznaczenia na klipie-rodzicu.
    useProject.getState().load('test', project('I2VA'))
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    await userEvent.click(screen.getByRole('button', { name: /przełącz kotwicę: pierwsza klatka/i }))
    expect(useSelection.getState().selected).toEqual([])
  })

  it('każde przełączenie kotwicy to osobny wpis historii cofania', async () => {
    useProject.getState().load('test', project('FL2VA'))
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    const before = useProject.getState().past.length

    await userEvent.click(screen.getByRole('button', { name: /przełącz kotwicę: pierwsza klatka/i }))
    await userEvent.click(screen.getByRole('button', { name: /przełącz kotwicę: ostatnia klatka/i }))

    expect(useProject.getState().past.length).toBe(before + 2)
    expect(useProject.getState().project!.shots[0]!.anchors)
      .toEqual(['picture-first', 'picture-last'])

    useProject.getState().undo()
    expect(useProject.getState().project!.shots[0]!.anchors).toEqual(['picture-first'])
  })
})
