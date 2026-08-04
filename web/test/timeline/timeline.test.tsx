import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@mmh3/shared'
import { Timeline } from '../../src/timeline/Timeline.js'
import { PromptPanel } from '../../src/panels/PromptPanel.js'
import { useProject } from '../../src/store/projectStore.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useLang } from '../../src/i18n/useT.js'

const shot = (id: string, index: number, startMs: number) => ({
  id, index, startMs, cutType: 'cut' as const, cutPhrase: 'the camera cuts to' as const,
  composition: '', body: [], cameraMoves: [], dialogue: [],
  screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
})

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic', assets: [], labels: [], speakers: [],
  shots: [shot('a', 0, 0)],
  audio: { overallSoundscape: 'Rain.', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useSelection.setState({ selected: [] })
  usePlayhead.setState({ ms: 0, playing: false })
  useProject.getState().load('test', project)
})

describe('Timeline', () => {
  it('składa linijkę, ścieżkę ujęć i playhead', () => {
    render(<Timeline />)
    expect(screen.getByRole('slider', { name: /linijka czasu/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ujęcie 1/i })).toBeInTheDocument()
    // Znacznik nie ma nazwy dostępności — dostępną kontrolką czasu jest
    // linijka (`slider`) sprawdzana wyżej, a uchwyt to sam afordans myszy.
    expect(screen.getByRole('presentation')).toBeInTheDocument()
  })

  it('przybliżenie poszerza oś, oddalenie zwęża', async () => {
    render(<Timeline />)
    const ruler = screen.getByRole('slider', { name: /linijka czasu/i })
    expect(ruler.style.width).toBe('900px')
    await userEvent.click(screen.getByRole('button', { name: /przybliż/i }))
    expect(ruler.style.width).toBe('1800px')
    await userEvent.click(screen.getByRole('button', { name: /oddal/i }))
    expect(ruler.style.width).toBe('900px')
  })

  it('dopasowanie wraca do zoomu początkowego', async () => {
    render(<Timeline />)
    await userEvent.click(screen.getByRole('button', { name: /przybliż/i }))
    await userEvent.click(screen.getByRole('button', { name: /dopasuj/i }))
    expect(screen.getByRole('slider', { name: /linijka czasu/i }).style.width).toBe('900px')
  })

  it('przycisk dodawania wstawia ujęcie na playheadzie', async () => {
    usePlayhead.setState({ ms: 4000, playing: false })
    render(<Timeline />)
    await userEvent.click(screen.getByRole('button', { name: /dodaj ujęcie/i }))
    expect(useProject.getState().project!.shots).toHaveLength(2)
  })

  it('zaznaczenie klipu podświetla token tego ujęcia w promptcie', async () => {
    render(
      <>
        <Timeline />
        <PromptPanel />
      </>,
    )
    await userEvent.click(screen.getByRole('button', { name: /ujęcie 1/i }))
    const token = screen.getByRole('button', { name: '[Shot 1]' })
    expect(token).toHaveAttribute('aria-current', 'true')
  })

  it('przycisk odtwarzania zmienia etykietę na zatrzymanie', async () => {
    render(<Timeline />)
    await userEvent.click(screen.getByRole('button', { name: /^odtwarzaj$/i }))
    expect(screen.getByRole('button', { name: /^zatrzymaj$/i })).toBeInTheDocument()
  })
})

/**
 * Zastępuje `ResizeObserver`, którego jsdom w ogóle nie zna — tak samo jak
 * `requestAnimationFrame` w testach pętli odtwarzania (`playback.test.tsx`).
 * Trzyma ostatnio utworzoną instancję, żeby test mógł ręcznie odpalić jej
 * callback z wybraną szerokością, symulując realny pomiar kontenera.
 */
class FakeResizeObserver {
  static last: FakeResizeObserver | null = null
  private readonly callback: ResizeObserverCallback
  readonly disconnect = vi.fn()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.last = this
  }

  observe(): void {}
  unobserve(): void {}

  fire(width: number): void {
    this.callback(
      [{ contentRect: { width } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
}

describe('dopasowanie do zmierzonej szerokości kontenera', () => {
  beforeEach(() => {
    FakeResizeObserver.last = null
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('dopasowanie przy różnych szerokościach kontenera daje różne zoomy', async () => {
    const first = render(<Timeline />)
    const firstObserver = FakeResizeObserver.last
    if (!firstObserver) throw new Error('ResizeObserver nie został utworzony')
    act(() => firstObserver.fire(1800))
    await userEvent.click(screen.getByRole('button', { name: /dopasuj/i }))
    expect(screen.getByRole('slider', { name: /linijka czasu/i }).style.width).toBe('1800px')
    first.unmount()

    render(<Timeline />)
    const secondObserver = FakeResizeObserver.last
    if (!secondObserver) throw new Error('ResizeObserver nie został utworzony')
    act(() => secondObserver.fire(3600))
    await userEvent.click(screen.getByRole('button', { name: /dopasuj/i }))
    expect(screen.getByRole('slider', { name: /linijka czasu/i }).style.width).toBe('3600px')
  })

  it('zmiana rozmiaru kontenera po zamontowaniu aktualizuje dopasowanie', async () => {
    render(<Timeline />)
    const observer = FakeResizeObserver.last
    if (!observer) throw new Error('ResizeObserver nie został utworzony')

    act(() => observer.fire(1800))
    await userEvent.click(screen.getByRole('button', { name: /dopasuj/i }))
    expect(screen.getByRole('slider', { name: /linijka czasu/i }).style.width).toBe('1800px')

    // Ten sam obserwator odpala się ponownie — symuluje zmianę rozmiaru okna
    // po tym, jak komponent już stoi zamontowany, a nie tylko pierwszy pomiar.
    act(() => observer.fire(2700))
    await userEvent.click(screen.getByRole('button', { name: /dopasuj/i }))
    expect(screen.getByRole('slider', { name: /linijka czasu/i }).style.width).toBe('2700px')
  })

  it('odmontowanie rozłącza obserwator', () => {
    const view = render(<Timeline />)
    const observer = FakeResizeObserver.last
    if (!observer) throw new Error('ResizeObserver nie został utworzony')
    view.unmount()
    expect(observer.disconnect).toHaveBeenCalledOnce()
  })
})
