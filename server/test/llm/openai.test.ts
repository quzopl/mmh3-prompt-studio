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

  // Round 1 recenzji zadania 9: brak liczników w odpowiedzi nie jest tym
  // samym co zgłoszone zero — model po prostu nie powiedział, ile tokenów
  // zużył. `null` niesie tę różnicę dalej (do `runTask`, do zdarzenia
  // `done`), zamiast udawać precyzję, której nikt nie zgłosił.
  it('brak liczników w odpowiedzi daje null, nie zero — model tego nie zgłosił', async () => {
    mockFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })))
    const result = await createOpenAiProvider(settings).complete({
      messages: [{ role: 'user', content: 'x' }],
      schema: { type: 'object' },
      maxTokens: 100,
      signal: new AbortController().signal,
    })
    expect(result.promptTokens).toBeNull()
    expect(result.completionTokens).toBeNull()
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

  // Podmiana pojedynczego literalnego wystąpienia klucza w tekście nie starczy —
  // zakodowany, przekształcony wielkością liter albo rozbity formatowaniem klucz
  // przejdzie obok takiego filtra. Jedyna kompletna ochrona: gdy klucz jest
  // skonfigurowany, treść odpowiedzi w ogóle nie trafia do komunikatu błędu.
  it('gdy klucz jest skonfigurowany, treść odpowiedzi błędu nie trafia do komunikatu w żadnej postaci', async () => {
    mockFetch(() => new Response('TAJNY-FRAGMENT-KTORY-NIE-MOZE-WYCIEC', { status: 400 }))
    await expect(createOpenAiProvider(settings).listModels()).rejects.toThrow(/400/)
    try {
      await createOpenAiProvider(settings).listModels()
      throw new Error('powinno rzucić')
    } catch (error) {
      expect(String(error)).not.toContain('TAJNY-FRAGMENT-KTORY-NIE-MOZE-WYCIEC')
    }
  })

  // Bez klucza nie ma czego chronić, a treść odpowiedzi jest jedyną
  // diagnostyką, jaką ma użytkownik — LM Studio i llama-server bez klucza to
  // najczęstszy lokalny przypadek, więc szczegóły muszą zostać.
  it('bez klucza treść odpowiedzi błędu zostaje w komunikacie — nie ma czego chronić', async () => {
    mockFetch(() => new Response('brak modelu o takiej nazwie', { status: 404 }))
    await expect(createOpenAiProvider({ ...settings, apiKey: '' }).listModels())
      .rejects.toThrow(/brak modelu o takiej nazwie/)
  })

  // `fetch` rzuca `TypeError: fetch failed`, zanim dojdzie do `readOrThrow` —
  // to pierwsze, co widzi użytkownik po literówce w porcie. Komunikat ma być
  // po polsku i nazywać adres, nie powtarzać angielski tekst wyjątku sieci.
  it('brak połączenia z serwerem modelu daje polski komunikat z adresem, nie "fetch failed"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed')
    }))
    await expect(createOpenAiProvider(settings).listModels()).rejects.toThrow(
      /model\.local.*Sprawdź, czy serwer/is,
    )
    try {
      await createOpenAiProvider(settings).listModels()
      throw new Error('powinno rzucić')
    } catch (error) {
      expect(String(error)).not.toContain('fetch failed')
    }
  })

  it('baseUrl z parametrami zapytania trafia poprawnie do ścieżki, nie miesza się z nią', async () => {
    let seenUrl = ''
    mockFetch(url => {
      seenUrl = url
      return new Response(JSON.stringify({ data: [] }))
    })
    await createOpenAiProvider({ ...settings, baseUrl: 'http://model.local/v1?foo=bar' }).listModels()
    expect(seenUrl).toBe('http://model.local/v1/models?foo=bar')
  })

  it('baseUrl z prefiksem ścieżki dokleja segment na końcu, nie zamienia go', async () => {
    let seenUrl = ''
    mockFetch(url => {
      seenUrl = url
      return new Response(JSON.stringify({ data: [] }))
    })
    await createOpenAiProvider({ ...settings, baseUrl: 'http://host.local/proxy/v1' }).listModels()
    expect(seenUrl).toBe('http://host.local/proxy/v1/models')
  })

  // Mock imituje realną semantykę `fetch`: odrzuca też wtedy, gdy sygnał był
  // przerwany, zanim `fetch` w ogóle wystartował — nie tylko wtedy, gdy
  // przerwanie przychodzi w trakcie trwającego żądania.
  const abortAwareFetchMock = () =>
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init.signal
        if (signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'))
          return
        }
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })))

  it('przerwanie sygnałem w trakcie żądania daje odrzucenie z rozpoznawalnym błędem, nie ciche zawieszenie', async () => {
    abortAwareFetchMock()
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

  it('sygnał przerwany jeszcze przed wywołaniem też daje odrzucenie, a nie zawieszenie', async () => {
    abortAwareFetchMock()
    const controller = new AbortController()
    controller.abort()
    await expect(createOpenAiProvider(settings).complete({
      messages: [{ role: 'user', content: 'x' }],
      schema: { type: 'object' },
      maxTokens: 10,
      signal: controller.signal,
    })).rejects.toThrow(/Aborted|abort/i)
  })

  it('ujemne liczniki tokenów w odpowiedzi zostają przycięte do zera', async () => {
    mockFetch(() => new Response(JSON.stringify({
      choices: [{ message: { content: '{}' } }],
      usage: { prompt_tokens: -3, completion_tokens: -1 },
    })))
    const result = await createOpenAiProvider(settings).complete({
      messages: [{ role: 'user', content: 'x' }],
      schema: { type: 'object' },
      maxTokens: 10,
      signal: new AbortController().signal,
    })
    expect(result.promptTokens).toBe(0)
    expect(result.completionTokens).toBe(0)
  })
})
