import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createScale } from '../../src/timeline/scale.js'
import { useDragClip } from '../../src/timeline/useDragClip.js'
import { clipBox, type TimeClip } from '../../src/timeline/clips.js'
import { firePointer } from './pointer.js'

const scale = createScale(8000, 800, 1)

let clips: TimeClip[] = []
let commits = 0
// Trzeci argument `write` — klucz sklejania historii. Cały powód, dla
// którego licznik gestów w `useDragClip.ts` jest modułowy, a nie `useRef`:
// bez tego dwa osobne przeciągnięcia wpadłyby do jednego wpisu cofania.
// Harness ze szkicu ten argument odrzucał, więc żaden test nie mógł tego
// sprawdzić — zapisujemy go tutaj, żeby móc go przeczytać w testach.
let coalesceKeys: string[] = []

function Harness() {
  const startDrag = useDragClip(scale, {
    read: id => clips.find(clip => clip.id === id),
    bounds: () => ({ lowestMs: 0, highestMs: 8000 }),
    snapPoints: () => [],
    write: (id, next, coalesceKey) => {
      clips = clips.map(clip => clip.id === id ? { ...clip, ...next } : clip)
      commits += 1
      coalesceKeys.push(coalesceKey)
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
  coalesceKeys = []
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

  it('zwolnienie odpina nasłuch', () => {
    // Osobny test od anulowania celowo — `pointerup` i `pointercancel`
    // odpinają się dwoma osobnymi wywołaniami `removeEventListener` w
    // `finish`, więc test pokrywający tylko jedno z nich nie broni drugiego.
    // Usunięcie samej rejestracji `pointerup` (przy zachowanej `pointercancel`)
    // zostawiłoby zielony komplet testów, gdyby ten przypadek nie istniał —
    // nasłuch zostałby podpięty na stałe i każdy kolejny gest dokładałby
    // kolejną kopię `move` do tego samego elementu.
    render(<Harness />)
    const handle = grab('move-a')
    firePointer(handle, 'pointerdown', 200)
    firePointer(handle, 'pointerup', 200)
    const before = commits
    firePointer(handle, 'pointermove', 700)
    expect(commits).toBe(before)
  })

  it('anulowanie odpina nasłuch', () => {
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

  it('brak `data-track` zostawia ostrzeżenie w konsoli, żeby cichy no-op dało się zdiagnozować', () => {
    render(<Harness />)
    screen.getByTestId('track').removeAttribute('data-track')
    const handle = grab('move-a')
    const warnings: unknown[][] = []
    const original = console.warn
    console.warn = (...args: unknown[]) => { warnings.push(args) }
    try {
      firePointer(handle, 'pointerdown', 200)
    } finally {
      console.warn = original
    }
    expect(warnings).toHaveLength(1)
    expect(String(warnings[0]?.[0])).toContain('data-track')
    expect(String(warnings[0]?.[0])).toContain('useDragClip')
  })

  // Klucz koalescencji to trzeci argument `write` i cały powód, dla którego
  // licznik gestów w `useDragClip.ts` jest zmienną modułową, a nie `useRef`
  // — patrz komentarz tam. Żaden test do tej pory go nie czytał, więc
  // regresja opisana w tamtym komentarzu (dwa gesty scalone w jeden wpis
  // historii) mogła przejść niezauważona przy zielonym komplecie testów.
  it('jeden gest z kilkoma ruchami zapisuje pod jednym, niepowtarzalnym kluczem koalescencji', () => {
    render(<Harness />)
    const handle = grab('move-a')
    firePointer(handle, 'pointerdown', 200)
    firePointer(handle, 'pointermove', 300)
    firePointer(handle, 'pointermove', 400)
    firePointer(handle, 'pointerup', 400)
    expect(coalesceKeys).toHaveLength(2)
    expect(new Set(coalesceKeys).size).toBe(1)
  })

  it('dwa gesty pod rząd zapisują pod dwoma różnymi kluczami', () => {
    render(<Harness />)
    const handle = grab('move-a')
    firePointer(handle, 'pointerdown', 200)
    firePointer(handle, 'pointermove', 300)
    firePointer(handle, 'pointerup', 300)
    const firstKey = coalesceKeys[coalesceKeys.length - 1]

    firePointer(handle, 'pointerdown', 300)
    firePointer(handle, 'pointermove', 400)
    firePointer(handle, 'pointerup', 400)
    const secondKey = coalesceKeys[coalesceKeys.length - 1]

    expect(firstKey).toBeDefined()
    expect(secondKey).toBeDefined()
    expect(firstKey).not.toBe(secondKey)
  })

  it('odmontowanie i ponowne zamontowanie ściezki między gestami nadal daje dwa różne klucze', () => {
    // Licznik gestów w `useRef` restartowałby się dokładnie tutaj — po
    // odmontowaniu i ponownym zamontowaniu komponentu — i drugi gest
    // odtworzyłby ten sam klucz co pierwszy.
    const first = render(<Harness />)
    const handle1 = grab('move-a')
    firePointer(handle1, 'pointerdown', 200)
    firePointer(handle1, 'pointermove', 300)
    firePointer(handle1, 'pointerup', 300)
    const firstKey = coalesceKeys[coalesceKeys.length - 1]
    first.unmount()

    render(<Harness />)
    const handle2 = grab('move-a')
    firePointer(handle2, 'pointerdown', 300)
    firePointer(handle2, 'pointermove', 400)
    firePointer(handle2, 'pointerup', 400)
    const secondKey = coalesceKeys[coalesceKeys.length - 1]

    expect(firstKey).toBeDefined()
    expect(secondKey).toBeDefined()
    expect(firstKey).not.toBe(secondKey)
  })
})
