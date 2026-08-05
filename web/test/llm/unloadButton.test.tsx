import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@mmh3/shared'
import { LlmPanel } from '../../src/llm/LlmPanel.js'
import { useProject } from '../../src/store/projectStore.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { useCritic } from '../../src/store/criticStore.js'
import { useTimelineShortcuts } from '../../src/timeline/useTimelineShortcuts.js'
import { useLang } from '../../src/i18n/useT.js'

/**
 * Zadanie 14: przycisk zwolnienia pamięci karty w `LlmPanel`. Ten sam wzorzec
 * mockowania `fetch` po URL-u i metodzie co `web/test/llm/llmPanel.test.tsx`.
 */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

type Handler = (init?: RequestInit) => Response | Promise<Response>

function routedFetch(handlers: Record<string, Handler>): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const key = `${method} ${url}`
    const handler = handlers[key]
    if (!handler) throw new Error(`Brak mocka dla ${key}`)
    return handler(init)
  })
}

interface TestSettings {
  mode: 'off' | 'endpoint' | 'managed'
  endpoint: { baseUrl: string; apiKey: string; model: string }
  managed: { serverBinary: string; modelPath: string; gpuLayers: number; contextSize: number }
}

const settingsEndpoint: TestSettings = {
  mode: 'endpoint',
  endpoint: { baseUrl: 'http://localhost:1234/v1', apiKey: '', model: 'qwen' },
  managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 8192 },
}

const settingsManaged: TestSettings = {
  mode: 'managed',
  endpoint: { baseUrl: '', apiKey: '', model: '' },
  managed: { serverBinary: '/bin/llama', modelPath: '/models/m.gguf', gpuLayers: 10, contextSize: 8192 },
}

const managedStopped = { status: 'stopped' as const, logs: [], port: 0 }
const managedReady = { status: 'ready' as const, logs: [], port: 9901 }

/** Handlery domyślne dla trzech odczytów, które panel woła przy montowaniu —
 * niezależnie od tego, co dany test właściwie sprawdza. */
interface TestManagedState { status: 'stopped' | 'starting' | 'ready' | 'failed'; logs: string[]; port: number }

function baseHandlers(
  settings: TestSettings,
  capability: 'managed' | 'ollama' | 'lmstudio' | 'none',
  managedState: TestManagedState = managedStopped,
): Record<string, Handler> {
  return {
    'GET /api/llm/settings': () => json(settings),
    'GET /api/llm/managed/state': () => json(managedState),
    'GET /api/llm/unload/capability': () => json({ capability }),
  }
}

function controllableStream() {
  let ref: ReadableStreamDefaultController<Uint8Array> | null = null
  const stream = new ReadableStream<Uint8Array>({ start: controller => { ref = controller } })
  const encoder = new TextEncoder()
  const send = (event: string, data: unknown): void => {
    try {
      ref?.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    } catch {
      // strumień już zamknięty przez `reader.cancel()` — nic do wysłania
    }
  }
  const close = (): void => { try { ref?.close() } catch { /* już zamknięty */ } }
  return { stream, send, close }
}

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'REF',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Sitcom', assets: [],
  labels: [],
  speakers: [],
  shots: [{
    id: 'shot-1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
    composition: '', body: [], cameraMoves: [], dialogue: [],
    screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
  }],
  audio: { overallSoundscape: 'Room tone.', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useProject.getState().load('test-projekt', project)
  usePlayhead.getState().reset()
  useCritic.setState({ notes: [], capturedProject: null })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('LlmPanel — przycisk zwolnienia pamięci karty, możliwość "none"', () => {
  it('jest nieaktywny i pokazuje wyjaśnienie z llm.unloadUnsupported', async () => {
    vi.stubGlobal('fetch', routedFetch(baseHandlers(settingsEndpoint, 'none')))
    render(<LlmPanel />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Zwolnij pamięć karty' })).toHaveAttribute('aria-disabled', 'true')
    })
    expect(screen.getByText('Ten dostawca nie umie zwolnić pamięci na żądanie — zatrzymaj go po swojej stronie'))
      .toBeInTheDocument()
  })
})

describe('LlmPanel — przycisk zwolnienia pamięci karty, tryb zarządzany', () => {
  it('jest aktywny, a podpowiedź mówi wprost, że zatrzyma serwer, nie tylko zwolni pamięć', async () => {
    vi.stubGlobal('fetch', routedFetch(baseHandlers(settingsManaged, 'managed', managedReady)))
    render(<LlmPanel />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Zwolnij pamięć karty' })).toHaveAttribute('aria-disabled', 'false')
    })
    expect(screen.getByText('Zatrzymuje serwer modelu i zwalnia całą pamięć karty')).toBeInTheDocument()
  })

  it('udane zwolnienie woła trasę, pokazuje potwierdzenie i pokazuje serwer jako zatrzymany', async () => {
    const handlers = {
      ...baseHandlers(settingsManaged, 'managed', managedReady),
      'POST /api/llm/unload': () => json({ freed: true, how: 'managed' }),
    }
    vi.stubGlobal('fetch', routedFetch(handlers))
    render(<LlmPanel />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Zwolnij pamięć karty' })).toHaveAttribute('aria-disabled', 'false')
    })
    // Zanim kliknięto — serwer wciąż pokazuje się jako gotowy.
    expect(screen.getByText(/Stan serwera: Gotowy/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Zwolnij pamięć karty' }))

    expect(await screen.findByText('Pamięć karty zwolniona')).toBeInTheDocument()
    // Po udanym zwolnieniu w trybie zarządzanym proces jest zatrzymany —
    // panel MA to pokazać, inaczej skłamie, że serwer wciąż jest gotowy.
    expect(screen.getByText(/Stan serwera: Zatrzymany/)).toBeInTheDocument()
  })
})

describe('LlmPanel — przycisk zwolnienia pamięci karty, Ollama', () => {
  it('kliknięcie woła trasę zwolnienia i pokazuje potwierdzenie', async () => {
    const handlers = {
      ...baseHandlers(settingsEndpoint, 'ollama'),
      'POST /api/llm/unload': () => json({ freed: true, how: 'ollama' }),
    }
    vi.stubGlobal('fetch', routedFetch(handlers))
    render(<LlmPanel />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Zwolnij pamięć karty' })).toHaveAttribute('aria-disabled', 'false')
    })
    expect(screen.getByText('Prosi Ollamę o wyładowanie modelu z pamięci karty')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Zwolnij pamięć karty' }))
    expect(await screen.findByText('Pamięć karty zwolniona')).toBeInTheDocument()
  })

  it('nieudane zwolnienie pokazuje powód i nie znika po cichu', async () => {
    const handlers = {
      ...baseHandlers(settingsEndpoint, 'ollama'),
      'POST /api/llm/unload': () => json({ freed: false, how: 'ollama', reason: 'Odpowiedź 500: padło' }),
    }
    vi.stubGlobal('fetch', routedFetch(handlers))
    render(<LlmPanel />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Zwolnij pamięć karty' })).toHaveAttribute('aria-disabled', 'false')
    })

    await user.click(screen.getByRole('button', { name: 'Zwolnij pamięć karty' }))

    expect(await screen.findByText('Nie udało się zwolnić pamięci: Odpowiedź 500: padło')).toBeInTheDocument()
    expect(screen.queryByText('Pamięć karty zwolniona')).not.toBeInTheDocument()

    // Komunikat NIE znika sam z siebie — zostaje widoczny do kolejnej akcji.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.getByText('Nie udało się zwolnić pamięci: Odpowiedź 500: padło')).toBeInTheDocument()
  })
})

describe('LlmPanel — przycisk zwolnienia pamięci karty jest zablokowany w trakcie zadania', () => {
  it('zadanie w toku blokuje przycisk zwolnienia tak samo jak resztę formularza', async () => {
    const { stream } = controllableStream()
    const handlers = {
      ...baseHandlers(settingsEndpoint, 'ollama'),
      'POST /api/llm/run': () => new Response(stream),
    }
    vi.stubGlobal('fetch', routedFetch(handlers))
    render(<LlmPanel />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Podpowiedź audio' })).toHaveAttribute('aria-disabled', 'false')
    })
    expect(screen.getByRole('button', { name: 'Zwolnij pamięć karty' })).toHaveAttribute('aria-disabled', 'false')

    await user.click(screen.getByRole('button', { name: 'Podpowiedź audio' }))
    await screen.findByText(/W toku…/)

    // Wyładowanie modelu w połowie generowania to gwarantowany błąd — przycisk
    // MUSI być nieaktywny, dopóki zadanie biegnie.
    expect(screen.getByRole('button', { name: 'Zwolnij pamięć karty' })).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('LlmPanel — przycisk zwolnienia pamięci karty: klawiatura nie wypływa do skrótów osi czasu', () => {
  function ShortcutsHarness() {
    useTimelineShortcuts()
    return null
  }

  it('spacja na przycisku zwalnia pamięć lokalnie i nie przełącza odtwarzania', async () => {
    const unloadCalls: number[] = []
    const handlers = {
      ...baseHandlers(settingsEndpoint, 'ollama'),
      'POST /api/llm/unload': () => {
        unloadCalls.push(1)
        return json({ freed: true, how: 'ollama' })
      },
    }
    vi.stubGlobal('fetch', routedFetch(handlers))
    render(<><LlmPanel /><ShortcutsHarness /></>)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Zwolnij pamięć karty' })).toHaveAttribute('aria-disabled', 'false')
    })
    expect(usePlayhead.getState().playing).toBe(false)

    const unloadButton = screen.getByRole('button', { name: 'Zwolnij pamięć karty' })
    unloadButton.focus()
    await userEvent.keyboard(' ')

    // Gdyby spacja wypłynęła do globalnego nasłuchu (`useTimelineShortcuts`
    // na `window`), ten sam klawisz przełączyłby odtwarzanie.
    expect(usePlayhead.getState().playing).toBe(false)
    expect(await screen.findByText('Pamięć karty zwolniona')).toBeInTheDocument()
    expect(unloadCalls).toEqual([1])
  })

  it('enter na przycisku zwalnia pamięć lokalnie i nie przełącza odtwarzania', async () => {
    const unloadCalls: number[] = []
    const handlers = {
      ...baseHandlers(settingsEndpoint, 'ollama'),
      'POST /api/llm/unload': () => {
        unloadCalls.push(1)
        return json({ freed: true, how: 'ollama' })
      },
    }
    vi.stubGlobal('fetch', routedFetch(handlers))
    render(<><LlmPanel /><ShortcutsHarness /></>)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Zwolnij pamięć karty' })).toHaveAttribute('aria-disabled', 'false')
    })
    expect(usePlayhead.getState().playing).toBe(false)

    const unloadButton = screen.getByRole('button', { name: 'Zwolnij pamięć karty' })
    unloadButton.focus()
    await userEvent.keyboard('{Enter}')

    expect(usePlayhead.getState().playing).toBe(false)
    expect(await screen.findByText('Pamięć karty zwolniona')).toBeInTheDocument()
    expect(unloadCalls).toEqual([1])
  })
})
