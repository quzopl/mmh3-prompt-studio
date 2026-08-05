import { describe, expect, it, vi, afterEach } from 'vitest'
import { createOpenAiProvider } from '../../src/llm/openai.js'

/**
 * Zadanie 9: `Provider.stream()` czyta strumień SSE odpowiedzi
 * `chat/completions` (`stream: true`, format zgodny z OpenAI — kawałki
 * `data: {...}`, zakończone `data: [DONE]`) i woła `onChunk` dla każdego
 * kawałka tekstu, zanim zwróci pełny wynik. Ten plik testuje samo czytanie
 * strumienia (odpowiednik `openai.test.ts` dla `complete()`) — zdarzenie SSE
 * `error` wysyłane do przeglądarki, gdy oba podejścia `runTask` zawiodą, jest
 * pokryte na poziomie trasy w `test/routes/llm.test.ts`.
 */

const settings = { baseUrl: 'http://model.local/v1', apiKey: 'tajne', model: 'qwen' }

afterEach(() => { vi.restoreAllMocks() })

const mockFetch = (handler: () => Response) =>
  vi.stubGlobal('fetch', vi.fn(async () => handler()))

const req = (signal: AbortSignal) => ({
  messages: [{ role: 'user' as const, content: 'x' }],
  schema: { type: 'object' },
  maxTokens: 100,
  signal,
})

/** Jeden kawałek SSE zgodny z formatem odpowiedzi `stream: true`. */
const deltaEvent = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`

const usageEvent = (promptTokens: number, completionTokens: number) =>
  `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens } })}`

describe('Provider.stream — normalny strumień', () => {
  it('woła onChunk dla każdego kawałka, w kolejności, a [DONE] kończy strumień', async () => {
    const body = [deltaEvent('Cześć'), deltaEvent(' świecie'), deltaEvent('!'), usageEvent(11, 22), 'data: [DONE]']
      .join('\n\n') + '\n\n'
    mockFetch(() => new Response(body))

    const onChunk = vi.fn()
    const result = await createOpenAiProvider(settings).stream(req(new AbortController().signal), onChunk)

    expect(onChunk.mock.calls.map(call => call[0])).toEqual(['Cześć', ' świecie', '!'])
    expect(result.text).toBe('Cześć świecie!')
    expect(result.promptTokens).toBe(11)
    expect(result.completionTokens).toBe(22)
  })

  it('kawałki po [DONE] są ignorowane — strumień kończy się na pierwszym [DONE]', async () => {
    const body = [deltaEvent('a'), 'data: [DONE]', deltaEvent('b — nie powinno dotrzeć')].join('\n\n') + '\n\n'
    mockFetch(() => new Response(body))

    const onChunk = vi.fn()
    const result = await createOpenAiProvider(settings).stream(req(new AbortController().signal), onChunk)

    expect(onChunk).toHaveBeenCalledTimes(1)
    expect(result.text).toBe('a')
  })
})

describe('Provider.stream — kawałek przecięty w pół między dwoma pakietami sieci', () => {
  it('kawałek rozdzielony w środku prefiksu "data:" i w środku JSON-a jest sklejany, nie gubiony', async () => {
    // Najczęstszy błąd w tego rodzaju kodzie: parser, który próbuje
    // dopasować "data:" i granicę zdarzenia w obrębie POJEDYNCZEGO odczytu
    // gniazda, gubi wszystko, co przypadło na granicę dwóch odczytów. Ten
    // strumień celowo tnie DOKŁADNIE w środku słowa "data:" (po "da"), a
    // potem jeszcze raz w środku samego JSON-a.
    const encoder = new TextEncoder()
    const full = `${deltaEvent('cześć')}\n\n${usageEvent(3, 5)}\n\ndata: [DONE]\n\n`
    const cut1 = full.indexOf('data:') + 2 // tnie po "da"
    const cut2 = cut1 + 15 // gdzieś w środku "ta: {\"choices\":..."

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(full.slice(0, cut1)))
        controller.enqueue(encoder.encode(full.slice(cut1, cut2)))
        controller.enqueue(encoder.encode(full.slice(cut2)))
        controller.close()
      },
    })
    mockFetch(() => new Response(stream))

    const onChunk = vi.fn()
    const result = await createOpenAiProvider(settings).stream(req(new AbortController().signal), onChunk)

    expect(onChunk).toHaveBeenCalledTimes(1)
    expect(onChunk).toHaveBeenCalledWith('cześć')
    expect(result.text).toBe('cześć')
    expect(result.promptTokens).toBe(3)
    expect(result.completionTokens).toBe(5)
  })
})

describe('Provider.stream — przerwanie sygnałem', () => {
  it('kończy strumień i nie woła onChunk po przerwaniu', async () => {
    const encoder = new TextEncoder()
    let pullCount = 0
    // Pierwszy `pull()` dostarcza jeden kawałek. Drugi zawiesza się na
    // zawsze — udaje oczekiwanie na kolejne bajty z sieci, których model
    // jeszcze nie wysłał. Test przerywa sygnał dokładnie w tym oknie.
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1
        if (pullCount === 1) {
          controller.enqueue(encoder.encode(`${deltaEvent('zanim')}\n\n`))
          return
        }
        return new Promise<void>(() => {})
      },
    })
    mockFetch(() => new Response(stream))

    const controller = new AbortController()
    const onChunk = vi.fn()
    const promise = createOpenAiProvider(settings).stream(req(controller.signal), onChunk)

    await vi.waitFor(() => expect(onChunk).toHaveBeenCalledTimes(1))
    controller.abort()

    await expect(promise).rejects.toThrow(/Aborted|abort/i)
    // Dokładnie jedno wywołanie — to z PRZED przerwaniem. Gdyby przerwanie
    // tylko przestało pokazywać wynik, a nie naprawdę zatrzymało odczyt,
    // drugi (zawieszony) `pull()` w końcu by coś dostarczył i `onChunk`
    // dostałby drugie wywołanie, mimo przerwania.
    expect(onChunk).toHaveBeenCalledTimes(1)
    expect(onChunk).toHaveBeenCalledWith('zanim')
  })

  it('sygnał przerwany jeszcze przed pierwszym odczytem też kończy się odrzuceniem, nie zawieszeniem', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull() { return new Promise<void>(() => {}) },
    })
    mockFetch(() => new Response(stream))

    const controller = new AbortController()
    controller.abort()
    const onChunk = vi.fn()
    await expect(createOpenAiProvider(settings).stream(req(controller.signal), onChunk))
      .rejects.toThrow(/Aborted|abort/i)
    expect(onChunk).not.toHaveBeenCalled()
  })
})

describe('Provider.stream — błąd w środku strumienia', () => {
  it('kawałek z niepoprawnym JSON-em kończy się odrzuceniem, nie ciszą (pustym wynikiem)', async () => {
    const body = [deltaEvent('ok'), 'data: {to nie jest poprawny JSON', 'data: [DONE]'].join('\n\n') + '\n\n'
    mockFetch(() => new Response(body))

    const onChunk = vi.fn()
    await expect(createOpenAiProvider(settings).stream(req(new AbortController().signal), onChunk))
      .rejects.toThrow(/strumienia/)
    // Kawałek sprzed błędu zdążył dotrzeć — błąd nie kasuje tego, co już się wydarzyło.
    expect(onChunk).toHaveBeenCalledTimes(1)
    expect(onChunk).toHaveBeenCalledWith('ok')
  })

  it('odpowiedź spoza dwusetki (błąd HTTP zamiast strumienia) rzuca tak samo jak complete()', async () => {
    mockFetch(() => new Response('brak modelu', { status: 404 }))
    const onChunk = vi.fn()
    await expect(createOpenAiProvider(settings).stream(req(new AbortController().signal), onChunk))
      .rejects.toThrow(/404/)
    expect(onChunk).not.toHaveBeenCalled()
  })
})
