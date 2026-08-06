import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProviderDiscovery } from '../../src/llm/ProviderDiscovery.js'

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

afterEach(() => { vi.unstubAllGlobals() })

describe('ProviderDiscovery', () => {
  it('po skanie pokazuje znalezione serwery z liczbą modeli', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/llm/discover': () => json({
        found: [{ kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', models: ['a', 'b'] }],
      }),
    }))
    render(<ProviderDiscovery onPick={() => {}} />)

    await user.click(screen.getByRole('button', { name: /szukaj lokalnych serwerów/i }))

    expect(await screen.findByText(/ollama · http:\/\/127\.0\.0\.1:11434/)).toBeInTheDocument()
    expect(await screen.findByText('2 modeli')).toBeInTheDocument()
  })

  it('brak wyników to zdanie, nie błąd', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', routedFetch({ 'GET /api/llm/discover': () => json({ found: [] }) }))
    render(<ProviderDiscovery onPick={() => {}} />)

    await user.click(screen.getByRole('button', { name: /szukaj lokalnych serwerów/i }))
    expect(await screen.findByText(/nie znaleziono żadnego serwera/i)).toBeInTheDocument()
  })

  it('nieudany skan też kończy się zdaniem, nie zawieszonym „Szukam…"', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('brak sieci') }))
    render(<ProviderDiscovery onPick={() => {}} />)

    await user.click(screen.getByRole('button', { name: /szukaj lokalnych serwerów/i }))
    expect(await screen.findByText(/nie znaleziono żadnego serwera/i)).toBeInTheDocument()
  })

  it('kliknięcie „Użyj" oddaje adres znalezionego serwera', async () => {
    const user = userEvent.setup()
    const picked: string[] = []
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/llm/discover': () => json({
        found: [{ kind: 'lmstudio', baseUrl: 'http://127.0.0.1:1234', models: ['x'] }],
      }),
    }))
    render(<ProviderDiscovery onPick={base => picked.push(base)} />)

    await user.click(screen.getByRole('button', { name: /szukaj lokalnych serwerów/i }))
    await user.click(await screen.findByRole('button', { name: /^użyj$/i }))

    expect(picked).toEqual(['http://127.0.0.1:1234'])
  })
})
