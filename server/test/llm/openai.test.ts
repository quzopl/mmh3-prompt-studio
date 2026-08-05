import { describe, expect, it, vi, afterEach } from 'vitest'
import { createOpenAiProvider } from '../../src/llm/openai.js'

const settings = { baseUrl: 'http://model.local/v1', apiKey: 'tajne', model: 'qwen' }

afterEach(() => { vi.restoreAllMocks() })

const mockFetch = (handler: (url: string, init: RequestInit) => Response) =>
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => handler(url, init)))

describe('klient endpointu OpenAI', () => {
  it('listuje modele z /v1/models', async () => {
    mockFetch(() => new Response(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] })))
    expect(await createOpenAiProvider(settings).listModels()).toEqual(['a', 'b'])
  })

  it('wysyła klucz w nagłówku Authorization', async () => {
    let seen = ''
    mockFetch((_url, init) => {
      const headers = new Headers(init.headers)
      seen = headers.get('authorization') ?? ''
      return new Response(JSON.stringify({ data: [] }))
    })
    await createOpenAiProvider(settings).listModels()
    expect(seen).toBe('Bearer tajne')
  })

  it('pomija nagłówek, gdy klucza nie ma — LM Studio go nie wymaga', async () => {
    let hasHeader = true
    mockFetch((_url, init) => {
      hasHeader = new Headers(init.headers).has('authorization')
      return new Response(JSON.stringify({ data: [] }))
    })
    await createOpenAiProvider({ ...settings, apiKey: '' }).listModels()
    expect(hasHeader).toBe(false)
  })

  it('zwraca treść i liczniki tokenów', async () => {
    mockFetch(() => new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 34 },
    })))
    const result = await createOpenAiProvider(settings).complete({
      messages: [{ role: 'user', content: 'x' }],
      schema: { type: 'object' },
      maxTokens: 100,
      signal: new AbortController().signal,
    })
    expect(result.text).toBe('{"ok":true}')
    expect(result.promptTokens).toBe(12)
    expect(result.completionTokens).toBe(34)
  })

  it('brak liczników w odpowiedzi daje zera, a nie NaN', async () => {
    mockFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })))
    const result = await createOpenAiProvider(settings).complete({
      messages: [{ role: 'user', content: 'x' }],
      schema: { type: 'object' },
      maxTokens: 100,
      signal: new AbortController().signal,
    })
    expect(result.promptTokens).toBe(0)
    expect(Number.isNaN(result.completionTokens)).toBe(false)
  })

  it('odpowiedź spoza dwusetki niesie kod i treść w komunikacie', async () => {
    mockFetch(() => new Response('brak modelu', { status: 404 }))
    await expect(createOpenAiProvider(settings).listModels()).rejects.toThrow(/404/)
  })

  it('przekazuje schemat w response_format', async () => {
    let body: unknown = null
    mockFetch((_url, init) => {
      body = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }))
    })
    await createOpenAiProvider(settings).complete({
      messages: [{ role: 'user', content: 'x' }],
      schema: { type: 'object', properties: {} },
      maxTokens: 10,
      signal: new AbortController().signal,
    })
    const parsed = body as { response_format?: { type?: string } }
    expect(parsed.response_format?.type).toBe('json_schema')
  })

  // Niektóre proxy odbijają żądanie w treści błędu. Klucz nie może przez to
  // trafić do komunikatu, który leci dalej do przeglądarki i do logów.
  it('klucz API nie wycieka do komunikatu błędu, nawet gdy serwer odbija żądanie', async () => {
    mockFetch(() => new Response('błąd, otrzymano nagłówek: Bearer tajne', { status: 400 }))
    await expect(createOpenAiProvider(settings).listModels())
      .rejects.toThrow(/400/)
    try {
      await createOpenAiProvider(settings).listModels()
      throw new Error('powinno rzucić')
    } catch (error) {
      expect(String(error)).not.toContain('tajne')
    }
  })

  it('przerwanie sygnałem daje odrzucenie z rozpoznawalnym błędem, nie ciche zawieszenie', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init.signal
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })))
    const controller = new AbortController()
    const promise = createOpenAiProvider(settings).complete({
      messages: [{ role: 'user', content: 'x' }],
      schema: { type: 'object' },
      maxTokens: 10,
      signal: controller.signal,
    })
    controller.abort()
    await expect(promise).rejects.toThrow(/Aborted|abort/i)
  })
})
