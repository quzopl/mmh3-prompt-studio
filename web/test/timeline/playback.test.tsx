import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import type { Project } from '@mmh3/shared'
import { firePointer } from './pointer.js'
import { advancePlayback, usePlayback } from '../../src/timeline/usePlayback.js'
import { Playhead } from '../../src/timeline/Playhead.js'
import { ShotTrack } from '../../src/timeline/ShotTrack.js'
import { createScale } from '../../src/timeline/scale.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useLang } from '../../src/i18n/useT.js'

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  usePlayhead.setState({ ms: 0, playing: false })
})

describe('advancePlayback', () => {
  it('przesuwa czas o miniony odcinek', () => {
    expect(advancePlayback(1000, 100, 8000)).toEqual({ ms: 1100, playing: true })
  })

  it('zatrzymuje się na końcu wideo', () => {
    expect(advancePlayback(7950, 100, 8000)).toEqual({ ms: 8000, playing: false })
  })

  it('nie cofa się przy ujemnym odcinku', () => {
    expect(advancePlayback(1000, -50, 8000)).toEqual({ ms: 1000, playing: true })
  })

  it('pojedynczy przeskok dłuższy niż całe wideo kończy odtwarzanie', () => {
    expect(advancePlayback(0, 99999, 8000)).toEqual({ ms: 8000, playing: false })
  })
})

describe('Playhead', () => {
  it('stoi w miejscu odpowiadającym czasowi', () => {
    usePlayhead.setState({ ms: 4000, playing: false })
    render(<Playhead scale={createScale(8000, 800, 1)} />)
    expect(screen.getByRole('presentation').style.left).toBe('400px')
  })

  it('przeciągnięcie przesuwa czas', () => {
    render(<Playhead scale={createScale(8000, 800, 1)} />)
    const handle = screen.getByRole('presentation')
    handle.setPointerCapture = () => {}
    handle.releasePointerCapture = () => {}
    handle.parentElement!.getBoundingClientRect = () => ({ left: 0, width: 800 }) as DOMRect
    firePointer(handle, 'pointerdown', 0)
    firePointer(handle, 'pointermove', 200)
    firePointer(handle, 'pointerup', 200)
    expect(usePlayhead.getState().ms).toBe(2000)
  })

  it('linia jest czysto wizualna — tylko uchwyt przyjmuje wskaźnik', () => {
    const { container } = render(<Playhead scale={createScale(8000, 800, 1)} />)

    // Element linii jest oznaczony `aria-hidden` i niczym innym w tym
    // komponencie — to jedyny sposób, żeby go odróżnić od uchwytu bez
    // wprowadzania data-testid, którego reszta projektu nie używa.
    const line = container.querySelector('[aria-hidden="true"]')
    expect(line).not.toBeNull()
    expect(line?.className).toContain('pointer-events-none')

    // Rolę ma wyłącznie uchwyt — dokładnie jeden element, nie dwa. Gdyby linia
    // też była interaktywna (jak przed poprawką z zadania 7), przyjmowałaby
    // zdarzenia na całej wysokości i przykrywałaby granice ujęć w tym samym
    // miejscu. Uchwyt nie ma własnej nazwy dostępności: kontrolką tej wartości
    // jest linijka czasu z rolą `slider`, a `aria-label` na elemencie
    // prezentacyjnym jest niedozwolone i kasuje samą rolę.
    const handles = screen.getAllByRole('presentation')
    expect(handles).toHaveLength(1)
    expect(handles[0]).not.toHaveAttribute('aria-label')
  })
})

const shot = (id: string, index: number, startMs: number) => ({
  id, index, startMs, cutType: 'cut' as const, cutPhrase: 'the camera cuts to' as const,
  composition: '', body: [], cameraMoves: [], dialogue: [],
  screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
})

const twoShotProject: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic', assets: [], labels: [], speakers: [],
  shots: [shot('a', 0, 0), shot('b', 1, 3000)],
  audio: { overallSoundscape: 'Rain.', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

describe('Playhead nad granicą ujęcia', () => {
  it('granica w tej samej pozycji co playhead wciąż daje się chwycić i przeciągnąć', () => {
    // jsdom dostarcza zdarzenia bezpośrednio do elementu wskazanego w
    // `firePointer`, z pominięciem prawdziwego trafiania w piksel na
    // podstawie z-index/pointer-events — tego jedna przeglądarka (Chromium
    // w e2e) pilnuje naprawdę. Ten test dokumentuje zamierzone zachowanie
    // i chroni przed regresją strukturalną (np. przypadkowym zagnieżdżeniem
    // znacznika nad ścieżką ujęć), ale to e2e jest ostatecznym dowodem, że
    // granica pod znacznikiem faktycznie daje się złapać myszą.
    useSelection.setState({ selected: [] })
    useProject.getState().load('test', twoShotProject)
    // Playhead stoi dokładnie na granicy ujęcia 2 (3000 ms = 300 px przy tej
    // skali) — dokładnie tam, gdzie w prawdziwej przeglądarce rozstrzyga się
    // konflikt z-index/pointer-events.
    usePlayhead.setState({ ms: 3000, playing: false })

    const scale = createScale(8000, 800, 1)
    render(
      <>
        <ShotTrack scale={scale} />
        <Playhead scale={scale} />
      </>,
    )

    const handle = screen.getByRole('separator', { name: /ujęcie 2/i })
    handle.setPointerCapture = () => {}
    handle.releasePointerCapture = () => {}
    handle.parentElement!.getBoundingClientRect = () => ({ left: 0, width: 800 }) as DOMRect

    firePointer(handle, 'pointerdown', 300)
    firePointer(handle, 'pointermove', 500)
    firePointer(handle, 'pointerup', 500)

    expect(useProject.getState().project!.shots[1]!.startMs).toBe(5000)
  })
})

/**
 * Komponent-nosiciel — jedyny sposób, żeby zamontować hooka `usePlayback`
 * (hooki poza komponentem nie istnieją) i sterować jego pętlą klatkową z
 * testu. Nic nie renderuje: interesuje nas wyłącznie efekt uboczny w
 * magazynie `usePlayhead`.
 */
function TestPlayback({ durationMs }: { durationMs: number }) {
  usePlayback(durationMs)
  return null
}

/**
 * Ręcznie sterowana kolejka klatek zastępująca `requestAnimationFrame` /
 * `cancelAnimationFrame`. Prawdziwe zegary uczyniłyby testy pętli klatkowej
 * powolne i niedeterministyczne (rzeczywisty upływ czasu między klatkami),
 * a testu na skok w czasie proporcjonalny do odcinka między klatkami w ogóle
 * nie dałoby się napisać bez kontroli nad tym, jaką wartość `now` niesie
 * każda klatka. `runOnly` celowo rzuca, gdy w kolejce nie ma dokładnie
 * jednej oczekującej klatki — pętla `usePlayback` w każdej chwili powinna
 * mieć zaplanowaną co najwyżej jedną klatkę, więc niejednoznaczność w
 * scenariuszu testu jest błędem w samym teście, nie czymś do przemilczenia.
 */
function createFrameQueue() {
  let nextId = 0
  const pending = new Map<number, FrameRequestCallback>()

  const request = (cb: FrameRequestCallback): number => {
    nextId += 1
    pending.set(nextId, cb)
    return nextId
  }

  const cancel = (id: number): void => {
    pending.delete(id)
  }

  const runOnly = (now: number): void => {
    const ids = [...pending.keys()]
    if (ids.length !== 1) {
      throw new Error(`oczekiwano dokładnie jednej zaplanowanej klatki, jest ${ids.length}`)
    }
    const id = ids[0] as number
    const cb = pending.get(id) as FrameRequestCallback
    pending.delete(id)
    cb(now)
  }

  /** Próba odpalenia konkretnego uchwytu — no-op, jeśli został wcześniej anulowany. */
  const tryRun = (id: number, now: number): void => {
    const cb = pending.get(id)
    if (!cb) return
    pending.delete(id)
    cb(now)
  }

  const size = (): number => pending.size

  return { request, cancel, runOnly, tryRun, size }
}

describe('usePlayback — pętla klatkowa', () => {
  let queue: ReturnType<typeof createFrameQueue>
  let rafSpy: ReturnType<typeof vi.fn>
  let cafSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    queue = createFrameQueue()
    rafSpy = vi.fn(queue.request)
    cafSpy = vi.fn(queue.cancel)
    vi.stubGlobal('requestAnimationFrame', rafSpy)
    vi.stubGlobal('cancelAnimationFrame', cafSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posuwa playhead proporcjonalnie do minionego czasu, a nie o stały krok', () => {
    usePlayhead.setState({ ms: 0, playing: true })
    const first = render(<TestPlayback durationMs={8000} />)
    act(() => queue.runOnly(0)) // klatka bazowa — tylko ustala punkt odniesienia
    act(() => queue.runOnly(100)) // odcinek 100 ms
    const shortStep = usePlayhead.getState().ms
    first.unmount()

    usePlayhead.setState({ ms: 0, playing: true })
    const second = render(<TestPlayback durationMs={8000} />)
    act(() => queue.runOnly(0))
    act(() => queue.runOnly(1000)) // odcinek dziesięciokrotnie dłuższy
    const longStep = usePlayhead.getState().ms
    second.unmount()

    expect(shortStep).toBe(83)
    expect(longStep).toBe(1000)
  })

  it('przy realistycznych odstępach klatek (ok. 16,7 ms) playhead faktycznie się posuwa', () => {
    // Prawdziwy vsync tyka co ok. 16,7 ms — mniej niż pół klatki materiału
    // (20,8 ms przy 24 FPS). Testy z odcinkami 100 ms i 1000 ms wyżej nie
    // wyłapały tego, bo pojedynczym skokiem przeskakują próg zaokrąglenia —
    // ten test celowo tego nie robi.
    usePlayhead.setState({ ms: 0, playing: true })
    render(<TestPlayback durationMs={8000} />)

    act(() => queue.runOnly(0)) // klatka bazowa
    let now = 0
    for (let frame = 0; frame < 120; frame += 1) {
      now += 1000 / 60
      act(() => queue.runOnly(now))
    }

    // 120 klatek po ok. 16,7 ms to ok. 2000 ms rzeczywistego czasu.
    expect(usePlayhead.getState().ms).toBeGreaterThan(1900)
  })

  it('zatrzymuje się dokładnie na końcu materiału i nie planuje kolejnej klatki', () => {
    usePlayhead.setState({ ms: 7960, playing: true })
    render(<TestPlayback durationMs={8000} />)

    act(() => queue.runOnly(0)) // klatka bazowa
    act(() => queue.runOnly(1000)) // odcinek dłuższy niż to, co zostało do końca

    expect(usePlayhead.getState().ms).toBe(8000)
    expect(usePlayhead.getState().playing).toBe(false)
    expect(queue.size()).toBe(0)
    // Nie wystarczy, że w kolejce nic finalnie nie zostało — sprzątające
    // odmontowanie/efekt potrafiłoby zamaskować spóźnione planowanie klatki,
    // anulując ją zaraz po zaplanowaniu. Liczba wywołań `requestAnimationFrame`
    // to trwały ślad: klatka po zatrzymaniu nie powinna zostać zaplanowana
    // ani razu, więc licznik ma zatrzymać się na dwóch wywołaniach (montaż +
    // jedno zaplanowanie po klatce bazowej), nie trzech.
    expect(rafSpy).toHaveBeenCalledTimes(2)
  })

  it('przy odmontowaniu w trakcie odtwarzania anuluje oczekującą klatkę i nie pisze już do magazynu', () => {
    usePlayhead.setState({ ms: 0, playing: true })
    const view = render(<TestPlayback durationMs={8000} />)

    act(() => queue.runOnly(0)) // klatka bazowa — planuje kolejną, wciąż w locie
    expect(queue.size()).toBe(1)
    const outstanding = rafSpy.mock.results.at(-1)?.value as number

    view.unmount()

    expect(cafSpy).toHaveBeenCalledWith(outstanding)
    expect(queue.size()).toBe(0)

    // Nawet gdyby ktoś spróbował odpalić już anulowaną klatkę, nic się nie dzieje.
    act(() => queue.tryRun(outstanding, 500))
    expect(usePlayhead.getState().ms).toBe(0)
  })

  it('szybkie przełączenie pauza→graj zostawia dokładnie jedną działającą pętlę', () => {
    usePlayhead.setState({ ms: 0, playing: true })
    render(<TestPlayback durationMs={8000} />)

    act(() => queue.runOnly(0)) // klatka bazowa pierwszej pętli
    expect(queue.size()).toBe(1)
    const firstLoopHandle = rafSpy.mock.results.at(-1)?.value as number

    act(() => usePlayhead.getState().pause())
    expect(cafSpy).toHaveBeenCalledWith(firstLoopHandle)
    expect(queue.size()).toBe(0) // pierwsza pętla naprawdę zdjęta z kolejki

    act(() => usePlayhead.getState().play())
    expect(queue.size()).toBe(1) // druga pętla zaplanowała dokładnie jedną klatkę
    const secondLoopHandle = rafSpy.mock.results.at(-1)?.value as number
    expect(secondLoopHandle).not.toBe(firstLoopHandle)

    // Restart resetuje znacznik czasu (naprawa z tej samej rundy), więc
    // pierwsza klatka nowej pętli jest bazowa — dopiero druga liczy odcinek.
    // Gdyby zamiast jednej pętli działały dwie równolegle, `runOnly` sam by
    // to wykrył: rzuciłby, bo w kolejce byłaby więcej niż jedna klatka.
    act(() => queue.runOnly(1000))
    act(() => queue.runOnly(1100))
    expect(usePlayhead.getState().ms).toBeGreaterThan(0)
  })

  it('przewinięcie w trakcie odtwarzania nie zostaje cofnięte przez zakumulowaną pozycję', () => {
    usePlayhead.setState({ ms: 0, playing: true })
    const view = render(<TestPlayback durationMs={8000} />)

    act(() => queue.runOnly(0)) // klatka bazowa
    act(() => queue.runOnly(1000)) // odcinek 1000 ms
    expect(usePlayhead.getState().ms).toBe(1000)

    // Coś spoza pętli (np. klik w linijkę czasu) przewija playhead w trakcie
    // odtwarzania — akumulator w hooku o tym jeszcze nie wie.
    act(() => usePlayhead.getState().setMs(5000, 8000))
    expect(usePlayhead.getState().ms).toBe(5000)

    // Kolejna klatka powinna kontynuować od przewiniętej pozycji (5000 + ~100),
    // a nie nadpisać ją starą, zakumulowaną wartością sprzed przewinięcia
    // (1000 + 100 = 1100 byłoby cofnięciem przewinięcia).
    act(() => queue.runOnly(1100))

    const ms = usePlayhead.getState().ms
    expect(ms).toBeGreaterThan(5000)
    expect(ms).toBeLessThan(5200)
    view.unmount()
  })

  it('zmiana durationMs w trakcie odtwarzania nie liczy odcinka przez granicę zmiany', () => {
    usePlayhead.setState({ ms: 0, playing: true })
    const view = render(<TestPlayback durationMs={8000} />)

    act(() => queue.runOnly(0)) // klatka bazowa pierwszej długości materiału
    view.rerender(<TestPlayback durationMs={12000} />) // durationMs zmienia się w locie

    // Gdyby znacznik czasu przetrwał zmianę, ta klatka policzyłaby odcinek
    // 5000 ms i przesunęła playhead. Zamiast tego to nowa klatka bazowa.
    act(() => queue.runOnly(5000))

    expect(usePlayhead.getState().ms).toBe(0)
  })
})
