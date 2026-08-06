import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { LlmPanel } from '../../src/llm/LlmPanel.js'

/**
 * Linijka zużycia VRAM. Mockowanie `fetch` po parze `METODA URL`, jak w
 * `web/test/llm/unloadButton.test.tsx`.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

type Handler = (init?: RequestInit) => Response | Promise<Response>

function routedFetch(handlers: Record<string, Handler>): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const handler = handlers[`${method} ${url}`]
    if (!handler) throw new Error(`Brak mocka dla ${method} ${url}`)
    return handler(init)
  })
}

const settings = {
  mode: 'endpoint',
  endpoint: { baseUrl: 'http://localhost:1234/v1', apiKey: '', model: 'qwen' },
  managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 8192 },
}

const handlers = (gpu: unknown): Record<string, Handler> => ({
  'GET /api/llm/settings': () => json(settings),
  'GET /api/llm/managed/state': () => json({ status: 'stopped', logs: [], port: 0, gpu }),
  'GET /api/llm/unload/capability': () => json({ capability: 'none' }),
  'GET /api/llm/discover': () => json({ found: [] }),
})

afterEach(() => { vi.unstubAllGlobals() })

describe('LlmPanel — linijka VRAM', () => {
  it('pokazuje nazwę karty i pamięć w gigabajtach', async () => {
    vi.stubGlobal('fetch', routedFetch(handlers({
      name: 'NVIDIA RTX PRO 6000', usedMb: 10651, totalMb: 97887,
    })))
    render(<LlmPanel />)

    // 10651 MiB ≈ 10,4 GB, 97887 MiB ≈ 95,6 GB.
    expect(await screen.findByText(/NVIDIA RTX PRO 6000 · VRAM 10\.4 \/ 95\.6 GB/)).toBeInTheDocument()
  })

  it('gdy karty nie da się odczytać, NIE pokazuje linijki ani zer', async () => {
    vi.stubGlobal('fetch', routedFetch(handlers(null)))
    render(<LlmPanel />)

    await screen.findByText(/ustawienia dostawcy/i)
    expect(screen.queryByText(/VRAM/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/0\.0 \/ 0\.0/)).not.toBeInTheDocument()
  })

  it('odpytuje stan ponownie, więc liczba się odświeża', async () => {
    let calls = 0
    vi.stubGlobal('fetch', routedFetch({
      ...handlers(null),
      'GET /api/llm/managed/state': () => {
        calls += 1
        return json({
          status: 'stopped', logs: [], port: 0,
          gpu: { name: 'GPU', usedMb: calls === 1 ? 1024 : 4096, totalMb: 8192 },
        })
      },
    }))
    render(<LlmPanel />)

    expect(await screen.findByText(/VRAM 1\.0 \/ 8\.0 GB/)).toBeInTheDocument()
    // Odświeżenie przychodzi po GPU_POLL_MS; zegar jest prawdziwy, więc dajemy
    // `waitFor` odpowiednio długi limit zamiast podmieniać czas.
    await waitFor(() => {
      expect(screen.getByText(/VRAM 4\.0 \/ 8\.0 GB/)).toBeInTheDocument()
    }, { timeout: 8_000 })
  }, 15_000)

  it('brak karty zatrzymuje odpytywanie — nie pyta w kółko o nieistniejące polecenie', async () => {
    let calls = 0
    vi.stubGlobal('fetch', routedFetch({
      ...handlers(null),
      'GET /api/llm/managed/state': () => {
        calls += 1
        return json({ status: 'stopped', logs: [], port: 0, gpu: null })
      },
    }))
    render(<LlmPanel />)

    await screen.findByText(/ustawienia dostawcy/i)
    await new Promise(resolve => setTimeout(resolve, 6_000))
    expect(calls).toBe(1)
  }, 15_000)
})
