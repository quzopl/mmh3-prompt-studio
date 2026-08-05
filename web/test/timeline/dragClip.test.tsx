import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createScale } from '../../src/timeline/scale.js'
import { useDragClip } from '../../src/timeline/useDragClip.js'
import { clipBox, type TimeClip } from '../../src/timeline/clips.js'
import { firePointer } from './pointer.js'

const scale = createScale(8000, 800, 1)

let clips: TimeClip[] = []
let commits = 0

function Harness() {
  const startDrag = useDragClip(scale, {
    read: id => clips.find(clip => clip.id === id),
    bounds: () => ({ lowestMs: 0, highestMs: 8000 }),
    snapPoints: () => [],
    write: (id, next) => {
      clips = clips.map(clip => clip.id === id ? { ...clip, ...next } : clip)
      commits += 1
    },
  })

  return (
    // `data-track` oznacza korzeń ściezki — patrz komentarz w useDragClip.ts.
    // Uchwyty siedzą dwa poziomy niżej (button -> kontener klipu -> ściezka),
    // dokładnie jak w prawdziwych torach kamery/dialogu/SFX, więc test
    // zamierzenie odtwarza to zagnieżdżenie zamiast montować przycisk wprost
    // w ściezce.
    <div
      data-testid="track"
      data-track
      style={{ position: 'relative', width: 800 }}
    >
      {clips.map(clip => (
        <div key={clip.id} data-testid={`clip-${clip.id}`} style={{ position: 'absolute', ...clipBox(scale, clip) }}>
          <button type="button" data-testid={`move-${clip.id}`} onPointerDown={e => startDrag(clip.id, 'move', e)}>x</button>
          <button type="button" data-testid={`start-${clip.id}`} onPointerDown={e => startDrag(clip.id, 'start', e)}>[</button>
          <button type="button" data-testid={`end-${clip.id}`} onPointerDown={e => startDrag(clip.id, 'end', e)}>]</button>
        </div>
      ))}
    </div>
  )
}

const grab = (testId: string) => {
  const element = screen.getByTestId(testId)
  element.setPointerCapture = () => {}
  element.releasePointerCapture = () => {}
  return element
}

/**
 * jsdom nie liczy layoutu, więc `getBoundingClientRect` zawsze zwraca zera —
 * żeby dowieść, że gest liczy współrzędne od ściezki, a nie od zagnieżdżonego
 * kontenera klipu, trzeba obu elementom podstawić różne, jawne prostokąty.
 */
const rect = (left: number, width: number): DOMRect => ({
  left, width, right: left + width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}),
})

beforeEach(() => {
  clips = [{ id: 'a', startMs: 2000, endMs: 3000 }]
  commits = 0
})

describe('useDragClip', () => {
  it('przesuwa cały klip zachowując jego długość', () => {
    render(<Harness />)
    const handle = grab('move-a')
    firePointer(handle, 'pointerdown', 200)
    firePointer(handle, 'pointermove', 500)
    firePointer(handle, 'pointerup', 500)
    const clip = clips[0]
    expect(clip?.startMs).toBe(5000)
    expect((clip?.endMs ?? 0) - (clip?.startMs ?? 0)).toBe(1000)
  })

  it('przeciągnięcie krawędzi zmienia tylko ją', () => {
    render(<Harness />)
    const handle = grab('end-a')
    firePointer(handle, 'pointerdown', 300)
    firePointer(handle, 'pointermove', 600)
    firePointer(handle, 'pointerup', 600)
    expect(clips[0]?.startMs).toBe(2000)
    expect(clips[0]?.endMs).toBe(6000)
  })

  it('każdy ruch wskaźnika zapisuje, więc klip nadąża za kursorem', () => {
    render(<Harness />)
    const handle = grab('move-a')
    firePointer(handle, 'pointerdown', 200)
    firePointer(handle, 'pointermove', 300)
    firePointer(handle, 'pointermove', 400)
    firePointer(handle, 'pointerup', 400)
    expect(commits).toBe(2)
  })

  it('zwolnienie i anulowanie odpinają nasłuch', () => {
    render(<Harness />)
    const handle = grab('move-a')
    firePointer(handle, 'pointerdown', 200)
    firePointer(handle, 'pointercancel', 200)
    const before = commits
    firePointer(handle, 'pointermove', 700)
    expect(commits).toBe(before)
  })

  it('źródłem współrzędnych jest ściezka, nie zagnieżdżony kontener klipu', () => {
    render(<Harness />)
    const track = screen.getByTestId('track')
    const clipWrapper = screen.getByTestId('clip-a')
    // Ściezka i kontener klipu stoją w różnych miejscach ekranu — gdyby gest
    // policzył współrzędne od kontenera klipu (bo uchwyt jest jego wnukiem,
    // a nie bezpośrednim dzieckiem ściezki), wynik wypadłby o 200 px za daleko.
    track.getBoundingClientRect = () => rect(100, 800)
    clipWrapper.getBoundingClientRect = () => rect(300, 200)
    const handle = grab('move-a')
    firePointer(handle, 'pointerdown', 350) // 250px od lewej krawędzi ściezki = środek klipu (200–300px)
    firePointer(handle, 'pointermove', 650) // 550px od lewej krawędzi ściezki
    firePointer(handle, 'pointerup', 650)
    expect(clips[0]?.startMs).toBe(5000)
  })

  it('bez `data-track` na ściezce gest się nie zaczyna, zamiast liczyć od złego elementu', () => {
    render(<Harness />)
    screen.getByTestId('track').removeAttribute('data-track')
    const handle = grab('move-a')
    firePointer(handle, 'pointerdown', 200)
    firePointer(handle, 'pointermove', 500)
    firePointer(handle, 'pointerup', 500)
    expect(commits).toBe(0)
    expect(clips[0]?.startMs).toBe(2000)
  })
})
