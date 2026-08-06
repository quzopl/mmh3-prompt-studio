import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelInstall } from '../../src/llm/ModelInstall.js'

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

const catalog = {
  models: [
    { id: 'm7', label: 'Qwen2.5 7B', fileName: 'a.gguf', url: 'u/a.gguf', bytes: 4_700_000_000, vramMb: 6_144 },
    { id: 'm14', label: 'Qwen2.5 14B', fileName: 'b.gguf', url: 'u/b.gguf', bytes: 8_988_110_976, vramMb: 11_264 },
  ],
  engine: { name: 'llama-b10295-bin-ubuntu-vulkan-x64.tar.gz', url: 'u', archive: 'tar' },
}

const sse = (body: string): Response =>
  new Response(body, { headers: { 'content-type': 'text/event-stream' } })

afterEach(() => { vi.unstubAllGlobals() })

describe('ModelInstall', () => {
  it('pokazuje rozmiar każdego modelu, żeby decyzja o gigabajtach była świadoma', async () => {
    vi.stubGlobal('fetch', routedFetch({ 'GET /api/llm/catalog': () => json(catalog) }))
    render(<ModelInstall freeVramMb={null} />)

    expect(await screen.findByText('4.7 GB')).toBeInTheDocument()
    expect(await screen.findByText('9.0 GB')).toBeInTheDocument()
  })

  it('ostrzega przy modelu większym niż wolny VRAM, ale go NIE blokuje', async () => {
    vi.stubGlobal('fetch', routedFetch({ 'GET /api/llm/catalog': () => json(catalog) }))
    render(<ModelInstall freeVramMb={8_192} />)

    // 7B (6 GB) się mieści, 14B (11 GB) nie — ostrzeżenie ma być dokładnie jedno.
    expect(await screen.findAllByText(/wolny VRAM/i)).toHaveLength(1)
    for (const button of screen.getAllByRole('button', { name: /pobierz i skonfiguruj/i })) {
      expect(button).toHaveAttribute('aria-disabled', 'false')
    }
  })

  it('bez odczytu VRAM nie ostrzega o niczym', async () => {
    vi.stubGlobal('fetch', routedFetch({ 'GET /api/llm/catalog': () => json(catalog) }))
    render(<ModelInstall freeVramMb={null} />)

    await screen.findByText('4.7 GB')
    expect(screen.queryByText(/wolny VRAM/i)).not.toBeInTheDocument()
  })

  it('pokazuje etap i kończy komunikatem o gotowości', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/llm/catalog': () => json(catalog),
      'POST /api/llm/install': () => sse(
        `event: progress\ndata: ${JSON.stringify({ stage: 'engine', received: 50, total: 100 })}\n\n`
        + `event: progress\ndata: ${JSON.stringify({ stage: 'model', received: 25, total: 100 })}\n\n`
        + 'event: done\ndata: {}\n\n',
      ),
    }))
    render(<ModelInstall freeVramMb={null} />)

    await user.click((await screen.findAllByRole('button', { name: /pobierz i skonfiguruj/i }))[0]!)

    expect(await screen.findByText(/gotowe/i)).toBeInTheDocument()
  })

  it('błąd z serwera pokazuje się użytkownikowi zamiast ciszy', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/llm/catalog': () => json(catalog),
      'POST /api/llm/install': () => sse(
        `event: error\ndata: ${JSON.stringify({ error: 'Za mało miejsca: potrzeba 10.0 GB' })}\n\n`,
      ),
    }))
    render(<ModelInstall freeVramMb={null} />)

    await user.click((await screen.findAllByRole('button', { name: /pobierz i skonfiguruj/i }))[0]!)

    expect(await screen.findByText(/za mało miejsca/i)).toBeInTheDocument()
  })

  it('gdy dla tego systemu nie ma silnika, mówi to zamiast oferować pobranie', async () => {
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/llm/catalog': () => json({ ...catalog, engine: null }),
    }))
    render(<ModelInstall freeVramMb={null} />)

    expect(await screen.findByText(/nie mamy gotowego silnika/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pobierz i skonfiguruj/i })).not.toBeInTheDocument()
  })
})
