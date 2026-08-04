import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { isFrameAligned, type Project } from '@mmh3/shared'
import { Inspector, toMs } from '../../src/panels/Inspector.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useLang } from '../../src/i18n/useT.js'

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
  useLang.setState({ lang: 'pl' })
  useSelection.setState({ selected: [] })
  useProject.getState().load('test', project)
})

describe('Inspector', () => {
  it('bez zaznaczenia pokazuje pola projektu', () => {
    render(<Inspector />)
    expect(screen.getByLabelText(/styl wizualny/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/długość wideo/i)).toBeInTheDocument()
  })

  it('zmiana stylu przelicza prompt', async () => {
    render(<Inspector />)
    await userEvent.type(screen.getByLabelText(/styl wizualny/i), 'Live-action')
    expect(useProject.getState().prompt).toContain('Live-action')
  })

  it('po zaznaczeniu ujęcia pokazuje jego pola', () => {
    useSelection.setState({ selected: [{ kind: 'shot', id: 'shot-1' }] })
    render(<Inspector />)
    expect(screen.getByLabelText(/kompozycja/i)).toBeInTheDocument()
  })

  it('zmiana czasu cięcia trafia do modelu dopiero przy zatwierdzeniu', async () => {
    // Wpis zatwierdza się przy opuszczeniu pola, nie po każdym znaku. Przy
    // zapisie na każdą literę pole nie dałoby się w ogóle wypełnić: pierwsza
    // cyfra „5" zostałaby natychmiast podniesiona do minimalnej długości
    // ujęcia (83 ms), a następne dopisałyby się do poprawionej liczby — z
    // „5000" wychodziłoby „83000" przycięte do końca materiału.
    useProject.getState().apply(p => ({
      ...p,
      shots: [...p.shots, { ...p.shots[0]!, id: 'shot-2', index: 1, startMs: 4000 }],
    }))
    useSelection.setState({ selected: [{ kind: 'shot', id: 'shot-2' }] })
    render(<Inspector />)
    const field = screen.getByLabelText(/czas cięcia/i)
    await userEvent.clear(field)
    await userEvent.type(field, '5000')
    expect(useProject.getState().project!.shots[1]!.startMs).toBe(4000)
    await userEvent.tab()
    expect(useProject.getState().project!.shots[1]!.startMs).toBe(5000)
  })

  it('Enter zatwierdza czas cięcia bez opuszczania pola', async () => {
    useProject.getState().apply(p => ({
      ...p,
      shots: [...p.shots, { ...p.shots[0]!, id: 'shot-2', index: 1, startMs: 4000 }],
    }))
    useSelection.setState({ selected: [{ kind: 'shot', id: 'shot-2' }] })
    render(<Inspector />)
    const field = screen.getByLabelText(/czas cięcia/i)
    await userEvent.clear(field)
    await userEvent.type(field, '5000{Enter}')
    expect(useProject.getState().project!.shots[1]!.startMs).toBe(5000)
  })

  it('czas cięcia wpisany ręcznie jest przyciągany do siatki klatek', async () => {
    // Każdy inny pisarz ujęć (`splitAtMs`, `useDragBoundary`) trzyma czasy
    // cięć na siatce klatek. Pole inspektora było jedynym, które zapisywało
    // surową liczbę: 4010 ms nie leży na żadnej klatce przy 1000/24 ms.
    useProject.getState().apply(p => ({
      ...p,
      shots: [...p.shots, { ...p.shots[0]!, id: 'shot-2', index: 1, startMs: 4000 }],
    }))
    useSelection.setState({ selected: [{ kind: 'shot', id: 'shot-2' }] })
    render(<Inspector />)
    const field = screen.getByLabelText(/czas cięcia/i)
    await userEvent.clear(field)
    await userEvent.type(field, '4010')
    await userEvent.tab()
    const startMs = useProject.getState().project!.shots[1]!.startMs
    expect(isFrameAligned(startMs)).toBe(true)
    expect(startMs).toBe(4000)
  })

  it('czas cięcia łamiący kolejność ujęć jest poprawiany, nie zapisywany', async () => {
    // Ujęcia: 0, 4000, 6000. Wpisanie 7000 dla środkowego rozjeżdża porządek
    // `index` z porządkiem `startMs`, a każdy konsument zakłada, że są zgodne
    // — `spans.ts` sortuje po `index`, `useDragBoundary` z tej kolejności
    // wyprowadza sąsiadów. Zmierzony skutek: przy następnym przeciągnięciu
    // granica ujęcia 3 sama odskakiwała z 6000 poza 7083, bez udziału
    // użytkownika. Ograniczenie jest to samo, co przy przeciąganiu: dwie
    // klatki przed następnym cięciem, czyli 5917 ms.
    useProject.getState().apply(p => ({
      ...p,
      shots: [
        p.shots[0]!,
        { ...p.shots[0]!, id: 'shot-2', index: 1, startMs: 4000 },
        { ...p.shots[0]!, id: 'shot-3', index: 2, startMs: 6000 },
      ],
    }))
    useSelection.setState({ selected: [{ kind: 'shot', id: 'shot-2' }] })
    render(<Inspector />)
    const field = screen.getByLabelText(/czas cięcia/i)
    await userEvent.clear(field)
    await userEvent.type(field, '7000')
    await userEvent.tab()

    const shots = useProject.getState().project!.shots
    expect(shots.map(s => s.startMs)).toEqual([0, 5917, 6000])
    expect(shots.map(s => s.index)).toEqual([0, 1, 2])
  })

  it('czas cięcia nie wychodzi poza długość materiału', async () => {
    useProject.getState().apply(p => ({
      ...p,
      shots: [...p.shots, { ...p.shots[0]!, id: 'shot-2', index: 1, startMs: 4000 }],
    }))
    useSelection.setState({ selected: [{ kind: 'shot', id: 'shot-2' }] })
    render(<Inspector />)
    const field = screen.getByLabelText(/czas cięcia/i)
    await userEvent.clear(field)
    await userEvent.type(field, '99000')
    await userEvent.tab()
    // 8000 ms materiału minus dwie klatki.
    expect(useProject.getState().project!.shots[1]!.startMs).toBe(7917)
  })

  it('toMs odrzuca wartość nieliczbową i zachowuje poprzednią', () => {
    expect(toMs('abc', 8000)).toBe(8000)
    expect(toMs('Infinity', 8000)).toBe(8000)
    expect(toMs('', 8000)).toBe(0)
    expect(toMs('5000', 8000)).toBe(5000)
  })

  it('pokazuje komunikat, gdy zaznaczony obiekt zniknął', () => {
    useSelection.setState({ selected: [{ kind: 'shot', id: 'nie-ma' }] })
    render(<Inspector />)
    expect(screen.getByRole('region', { name: /inspektor/i })).toBeInTheDocument()
  })
})
