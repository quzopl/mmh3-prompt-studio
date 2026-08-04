import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Project } from '@mmh3/shared'
import { firePointer } from './pointer.js'
import { boundaryTargetMs, MIN_SHOT_MS } from '../../src/timeline/useDragBoundary.js'
import { ShotTrack } from '../../src/timeline/ShotTrack.js'
import { createScale } from '../../src/timeline/scale.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useLang } from '../../src/i18n/useT.js'

describe('boundaryTargetMs', () => {
  const base = { previousMs: 0, nextMs: 8000, snapPoints: [] as number[], toleranceMs: 40 }

  it('przyciąga do granicy klatki', () => {
    expect(boundaryTargetMs({ ...base, desiredMs: 3010 })).toBe(3000)
  })

  it('nie pozwala zejść bliżej niż minimalna długość ujęcia do poprzedniego', () => {
    expect(boundaryTargetMs({ ...base, desiredMs: 10 })).toBe(MIN_SHOT_MS)
  })

  it('nie pozwala podejść bliżej niż minimalna długość ujęcia do następnego', () => {
    expect(boundaryTargetMs({ ...base, desiredMs: 7990 })).toBe(8000 - MIN_SHOT_MS)
  })

  it('przyciąga do podanego punktu, gdy jest bliżej niż tolerancja', () => {
    expect(boundaryTargetMs({ ...base, desiredMs: 4010, snapPoints: [4000] })).toBe(4000)
  })

  it('punkt spoza tolerancji nie przyciąga', () => {
    expect(boundaryTargetMs({ ...base, desiredMs: 4500, snapPoints: [4000] })).toBe(4500)
  })

  it('ograniczenia mają pierwszeństwo przed punktem przyciągania', () => {
    expect(boundaryTargetMs({ ...base, desiredMs: 10, snapPoints: [0] })).toBe(MIN_SHOT_MS)
  })
})

const shot = (id: string, index: number, startMs: number) => ({
  id, index, startMs, cutType: 'cut' as const, cutPhrase: 'the camera cuts to' as const,
  composition: '', body: [], cameraMoves: [], dialogue: [],
  screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
})

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic', assets: [], labels: [], speakers: [],
  shots: [shot('a', 0, 0), shot('b', 1, 3000)],
  audio: { overallSoundscape: 'Rain.', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useSelection.setState({ selected: [] })
  useProject.getState().load('test', project)
})

describe('przeciąganie granicy w ścieżce ujęć', () => {
  const dragTo = (clientX: number) => {
    const handle = screen.getByRole('separator', { name: /ujęcie 2/i })
    handle.setPointerCapture = () => {}
    handle.releasePointerCapture = () => {}
    const track = handle.parentElement!
    track.getBoundingClientRect = () => ({ left: 0, width: 800 }) as DOMRect
    firePointer(handle, 'pointerdown', 300)
    firePointer(handle, 'pointermove', clientX)
    firePointer(handle, 'pointerup', clientX)
  }

  it('pierwsze ujęcie nie ma uchwytu, bo jego czas jest zawsze zerem', () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    expect(screen.queryByRole('separator', { name: /ujęcie 1/i })).not.toBeInTheDocument()
  })

  it('przeciągnięcie zmienia czas cięcia', () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    dragTo(500)
    expect(useProject.getState().project!.shots[1]!.startMs).toBe(5000)
  })

  it('cały gest zostawia jeden wpis w historii cofania', () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    const handle = screen.getByRole('separator', { name: /ujęcie 2/i })
    handle.setPointerCapture = () => {}
    handle.releasePointerCapture = () => {}
    handle.parentElement!.getBoundingClientRect = () => ({ left: 0, width: 800 }) as DOMRect
    firePointer(handle, 'pointerdown', 300)
    firePointer(handle, 'pointermove', 400)
    firePointer(handle, 'pointermove', 450)
    firePointer(handle, 'pointermove', 500)
    firePointer(handle, 'pointerup', 500)
    expect(useProject.getState().past).toHaveLength(1)
  })

  it('dwa kolejne gesty to dwa wpisy w historii', () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    dragTo(500)
    dragTo(600)
    expect(useProject.getState().past).toHaveLength(2)
  })

  it('nie da się przeciągnąć poza sąsiadów', () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    dragTo(-200)
    expect(useProject.getState().project!.shots[1]!.startMs).toBe(MIN_SHOT_MS)
  })
})
