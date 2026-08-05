import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { isFrameAligned, type Project } from '@mmh3/shared'
import { firePointer } from './pointer.js'
import { boundaryTargetMs, MIN_SHOT_MS, SNAP_TOLERANCE_MS } from '../../src/timeline/useDragBoundary.js'
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

  it('dolne ograniczenie zostaje na siatce klatek, nawet gdy poprzednik sam nie leży w klatce zero', () => {
    // previousMs = 208 to klatka 5 (5 * 41,666… ≈ 208,33, zaokrąglone do 208).
    // Naiwne `previousMs + MIN_SHOT_MS` dałoby 208 + 83 = 291 — poza siatką,
    // bo MIN_SHOT_MS to zaokrąglone dwie klatki, nie dokładna wielokrotność
    // MS_PER_FRAME. Klatka 7 (5 + 2) leży w 292 ms.
    const result = boundaryTargetMs({ ...base, previousMs: 208, desiredMs: 10 })
    expect(isFrameAligned(result)).toBe(true)
    expect(result).toBe(292)
  })

  it('gdy sąsiedzi są bliżej niż dwie minimalne długości ujęcia, wygrywa dolne ograniczenie', () => {
    // Sąsiedzi bliżsi niż cztery klatki dają `highest < lowest` — przecięcie
    // ograniczeń. Przy `Math.min(Math.max(...), highest)` wygrywa wtedy zewnętrzne
    // `min`, więc granica ląduje PRZED poprzednikiem: pierwszy przypadek dawał
    // -42 ms, a ujemny `startMs` nie przechodzi przez `ShotSchema`, więc każdy
    // kolejny autozapis odpowiadał 400 i projektu nie dało się już zapisać.
    // Granica nie może stanąć przed swoim poprzednikiem, cokolwiek robią sąsiedzi.
    expect(boundaryTargetMs({ ...base, desiredMs: 35, previousMs: 0, nextMs: 40 }))
      .toBe(MIN_SHOT_MS)
    expect(boundaryTargetMs({ ...base, desiredMs: 5000, previousMs: 4000, nextMs: 4050 }))
      .toBe(4083)
    // 4083 to klatka 98, czyli dokładnie poprzednik (klatka 96) plus minimum.
    expect(isFrameAligned(4083)).toBe(true)
  })

  it('korzysta z rzeczywistej tolerancji przyciągania (SNAP_TOLERANCE_MS), nie tylko wartości 40 z reszty testów', () => {
    const justInside = 4000 + SNAP_TOLERANCE_MS - 1
    const justOutside = 4000 + SNAP_TOLERANCE_MS + 1
    expect(boundaryTargetMs({
      ...base, desiredMs: justInside, snapPoints: [4000], toleranceMs: SNAP_TOLERANCE_MS,
    })).toBe(4000)
    expect(boundaryTargetMs({
      ...base, desiredMs: justOutside, snapPoints: [4000], toleranceMs: SNAP_TOLERANCE_MS,
    })).not.toBe(4000)
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

  it('pointercancel przerywa gest i zdejmuje nasłuch — kolejne przeciągnięcie wciąż działa', () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    const handle = screen.getByRole('separator', { name: /ujęcie 2/i })
    handle.setPointerCapture = () => {}
    handle.releasePointerCapture = () => {}
    handle.parentElement!.getBoundingClientRect = () => ({ left: 0, width: 800 }) as DOMRect

    firePointer(handle, 'pointerdown', 300)
    firePointer(handle, 'pointermove', 500)
    const afterMove = useProject.getState().project!.shots[1]!.startMs
    handle.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }))

    // Ruch po anulowaniu nie powinien już nic zmieniać — nasłuch został zdjęty.
    firePointer(handle, 'pointermove', 700)
    expect(useProject.getState().project!.shots[1]!.startMs).toBe(afterMove)

    // Nowy, świeży gest na tym samym uchwycie wciąż działa poprawnie.
    firePointer(handle, 'pointerdown', 300)
    firePointer(handle, 'pointermove', 600)
    firePointer(handle, 'pointerup', 600)
    expect(useProject.getState().project!.shots[1]!.startMs).toBe(6000)
  })

  it('dwa gesty rozdzielone odmontowaniem komponentu to wciąż dwa wpisy w historii', () => {
    // `gesture` licznika nie wolno trzymać w `useRef` — restartuje się przy
    // każdym montowaniu komponentu, więc po odmontowaniu i ponownym montażu
    // drugi gest odtworzyłby ten sam klucz koalescencji co pierwszy i scalił
    // się z jego (już zamkniętym) wpisem historii zamiast dołożyć nowy.
    const first = render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    dragTo(500)
    first.unmount()

    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    dragTo(600)

    expect(useProject.getState().past).toHaveLength(2)
  })

  it('granica ujęcia środkowego dogania sąsiada przesuniętego w trakcie już otwartego gestu', () => {
    // Model potrafi się zmienić spoza gestu, kiedy gest jest już otwarty —
    // cofnięcie, skrót klawiszowy, przeładowanie z dysku. Dlatego `move`
    // odczytuje sąsiadów na nowo przy każdym ruchu, zamiast zamykać ich w
    // domknięciu z chwili `pointerdown`. Żeby to sprawdzić naprawdę, sąsiad
    // (ujęcie c) musi się przesunąć MIĘDZY `pointerdown` a `pointermove` tego
    // samego gestu — nie jako osobne, wcześniej zakończone przeciągnięcie
    // (użytkownik ma jeden wskaźnik; dwa równoległe gesty to scenariusz,
    // który w ogóle nie może się zdarzyć i niczego by nie odróżnił).
    const threeShots: Project = {
      ...project,
      video: { ...project.video, durationMs: 9000 },
      shots: [shot('a', 0, 0), shot('b', 1, 3000), shot('c', 2, 6000)],
    }
    useProject.getState().load('test', threeShots)
    render(<ShotTrack scale={createScale(9000, 900, 1)} />)

    const handle = screen.getByRole('separator', { name: /ujęcie 2/i })
    handle.setPointerCapture = () => {}
    handle.releasePointerCapture = () => {}
    handle.parentElement!.getBoundingClientRect = () => ({ left: 0, width: 900 }) as DOMRect

    firePointer(handle, 'pointerdown', 300)

    // Sąsiad przesuwa się spoza gestu, podczas gdy gest ujęcia 2 jest już otwarty.
    useProject.getState().apply(p => ({
      ...p,
      shots: p.shots.map(s => (s.id === 'c' ? { ...s, startMs: 4000 } : s)),
    }))

    // Dopiero teraz ciągniemy granicę ujęcia 2 mocno w prawo, w stronę nowego położenia ujęcia 3.
    firePointer(handle, 'pointermove', 900)
    firePointer(handle, 'pointerup', 900)

    const shots = useProject.getState().project!.shots
    const b = shots.find(s => s.id === 'b')!
    const c = shots.find(s => s.id === 'c')!
    expect(c.startMs).toBe(4000)
    expect(b.startMs).toBe(4000 - MIN_SHOT_MS)
    expect(b.startMs).toBeLessThan(c.startMs)
    // Kolejność cięć (indeksy) pozostaje nienaruszona.
    expect(shots.map(s => s.index)).toEqual([0, 1, 2])
  })

  it('przeciągnięcie granicy za sąsiada nie rozjeżdża indeksów z czasami', () => {
    const threeShots: Project = {
      ...project,
      shots: [shot('a', 0, 0), shot('b', 1, 2000), shot('c', 2, 6000)],
    }
    useProject.getState().load('test', threeShots)
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)

    const handle = screen.getByRole('separator', { name: /ujęcie 2/i })
    handle.setPointerCapture = () => {}
    handle.releasePointerCapture = () => {}
    handle.parentElement!.getBoundingClientRect = () => ({ left: 0, width: 800 }) as DOMRect

    firePointer(handle, 'pointerdown', 200)
    firePointer(handle, 'pointermove', 780)
    firePointer(handle, 'pointerup', 780)

    const shots = useProject.getState().project?.shots ?? []
    const byIndex = [...shots].sort((x, y) => x.index - y.index).map(s => s.startMs)
    expect(byIndex).toEqual([...byIndex].sort((x, y) => x - y))
  })
})
