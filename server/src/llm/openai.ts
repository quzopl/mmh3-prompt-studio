import type { CompletionRequest, CompletionResult, Provider } from './provider.js'

export interface OpenAiSettings {
  baseUrl: string
  apiKey: string
  model: string
}

const headersFor = (apiKey: string): Record<string, string> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  // LM Studio i llama-server nie wymagają klucza. Wysłanie pustego „Bearer "
  // bywa odrzucane, więc nagłówka po prostu nie ma, gdy klucza nie ma.
  if (apiKey !== '') headers['authorization'] = `Bearer ${apiKey}`
  return headers
}

/**
 * Podmiana samego literalnego wystąpienia klucza w tekście błędu nie jest
 * kompletną ochroną — klucz może wrócić zakodowany, z inną wielkością liter
 * albo rozbity formatowaniem odpowiedzi. Jedyna reguła, która daje pewność:
 * gdy klucz jest skonfigurowany, treść odpowiedzi w ogóle nie trafia do
 * komunikatu, tylko kod statusu i wskazanie, żeby zajrzeć do logu serwera
 * modelu. Bez klucza nie ma czego chronić — treść zostaje, bo to ona
 * pomaga zdiagnozować problem (najczęstszy lokalny przypadek: LM Studio i
 * llama-server bez klucza w ogóle).
 *
 * Wydzielone z `readOrThrow`, żeby `stream()` (odpowiedź bez ciała JSON do
 * odczytania na starcie, tylko strumień) mogło skorzystać z tej samej reguły
 * bez wołania `response.json()`.
 */
async function throwIfNotOk(response: Response, apiKey: string): Promise<void> {
  if (response.ok) return
  if (apiKey !== '') {
    throw new Error(`Model odpowiedział błędem ${response.status}. Sprawdź log serwera modelu po szczegóły.`)
  }
  const body = await response.text()
  throw new Error(`Model odpowiedział ${response.status}: ${body.slice(0, 200)}`)
}

async function readOrThrow(response: Response, apiKey: string): Promise<unknown> {
  await throwIfNotOk(response, apiKey)
  return response.json()
}

// Model bywa niekonsekwentny w licznikach — ujemna wartość nie ma sensu i w
// liczniku w interfejsie wygląda jak błąd po naszej stronie, więc przycinamy
// do zera zamiast przepuszczać dalej. Wspólne dla `complete` i `stream`.
const clampTokenCount = (value: unknown): number => typeof value === 'number' ? Math.max(0, value) : 0

interface StreamChunkPayload {
  choices?: Array<{ delta?: { content?: unknown } }>
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
}

/**
 * Czyta strumień SSE odpowiedzi „chat/completions" (`stream: true`, format
 * zgodny z OpenAI: kawałki `data: {...}\n\n`, zakończone `data: [DONE]\n\n`).
 *
 * Bufor gromadzi surowy, zdekodowany tekst i tnie go WYŁĄCZNIE na pełnych
 * granicach `\n\n` — kawałek rozdzielony w pół między dwoma odczytami gniazda
 * (nawet w środku słowa „data:" albo w środku samego JSON-a) zostaje w
 * buforze i czeka na resztę w kolejnym odczycie, zamiast się zgubić albo
 * rozsypać parsowanie. To najczęstszy błąd w tego rodzaju kodzie — bufor
 * nigdy nie zakłada, że jeden odczyt gniazda odpowiada jednej granicy zdarzenia.
 *
 * Sygnał przerwania jest sprawdzany przed i po każdym odczycie, a dodatkowo
 * nasłuch na `abort` woła `reader.cancel()` — bez tego odczyt czekający na
 * kolejne bajty z sieci nie obudziłby się, dopóki model faktycznie czegoś nie
 * wyśle, i przerwanie nie zatrzymałoby niczego aż do następnego kawałka.
 */
async function readCompletionStream(
  response: Response,
  signal: AbortSignal,
  onChunk: (text: string) => void,
): Promise<CompletionResult> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Model nie zwrócił strumienia odpowiedzi.')

  const onAbort = (): void => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', onAbort)

  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let promptTokens = 0
  let completionTokens = 0
  let finished = false

  try {
    while (!finished) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const { done, value } = await reader.read()
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1 && !finished) {
        const rawEvent = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)

        for (const line of rawEvent.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice('data:'.length).trim()
          if (data === '[DONE]') { finished = true; break }

          let payload: StreamChunkPayload
          try {
            payload = JSON.parse(data) as StreamChunkPayload
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`Model przesłał niepoprawny fragment strumienia: ${message}`)
          }
          const delta = payload.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta !== '') {
            text += delta
            onChunk(delta)
          }
          if (payload.usage) {
            promptTokens = clampTokenCount(payload.usage.prompt_tokens)
            completionTokens = clampTokenCount(payload.usage.completion_tokens)
          }
        }

        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
  }

  return { text, promptTokens, completionTokens }
}

/** Buduje adres żądania przez `URL`, żeby parametry zapytania, fragment albo
 * prefiks ścieżki w `baseUrl` złożyły się poprawnie zamiast rozjechać się przy
 * zwykłej konkatenacji stringów (np. `.../v1?foo=bar` + `/models`). */
function requestUrl(baseUrl: string, path: string): string {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`
  return url.toString()
}

/** `fetch` rzuca (np. `TypeError: fetch failed`), zanim dojdzie do odpowiedzi
 * HTTP — to najczęstszy pierwszy błąd po literówce w porcie albo nieuruchomionym
 * serwerze modelu. Komunikat wyjątku sieciowego jest po angielsku i nic nie mówi
 * o adresie, więc zamieniamy go na coś, co można przeczytać i na czym można
 * działać. Przerwanie przez `AbortSignal` to inny przypadek — ma zostać
 * rozpoznawalne jako przerwanie, nie zamieniać się w komunikat o braku połączenia. */
async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new Error(`Brak połączenia z serwerem modelu pod adresem ${url}. Sprawdź, czy serwer jest uruchomiony.`)
  }
}

export function createOpenAiProvider(settings: OpenAiSettings): Provider {
  return {
    async listModels() {
      const payload = await readOrThrow(
        await safeFetch(requestUrl(settings.baseUrl, '/models'), { headers: headersFor(settings.apiKey) }),
        settings.apiKey,
      )
      const data = (payload as { data?: Array<{ id?: unknown }> }).data ?? []
      return data
        .map(entry => entry.id)
        .filter((id): id is string => typeof id === 'string')
    },

    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const payload = await readOrThrow(
        await safeFetch(requestUrl(settings.baseUrl, '/chat/completions'), {
          method: 'POST',
          headers: headersFor(settings.apiKey),
          signal: req.signal,
          body: JSON.stringify({
            model: settings.model,
            messages: req.messages,
            max_tokens: req.maxTokens,
            temperature: 0.4,
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'wynik', strict: true, schema: req.schema },
            },
          }),
        }),
        settings.apiKey,
      )

      const body = payload as {
        choices?: Array<{ message?: { content?: unknown } }>
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
      }
      const content = body.choices?.[0]?.message?.content

      return {
        text: typeof content === 'string' ? content : '',
        promptTokens: clampTokenCount(body.usage?.prompt_tokens),
        completionTokens: clampTokenCount(body.usage?.completion_tokens),
      }
    },

    async stream(req: CompletionRequest, onChunk: (text: string) => void): Promise<CompletionResult> {
      const response = await safeFetch(requestUrl(settings.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: headersFor(settings.apiKey),
        signal: req.signal,
        body: JSON.stringify({
          model: settings.model,
          messages: req.messages,
          max_tokens: req.maxTokens,
          temperature: 0.4,
          stream: true,
          // Bez tego niektóre serwery (zgodne z API OpenAI) w ogóle nie
          // wysyłają liczników tokenów przy strumieniu — dopiero ten
          // parametr prosi o dodatkowy kawałek z `usage` tuż przed `[DONE]`.
          stream_options: { include_usage: true },
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'wynik', strict: true, schema: req.schema },
          },
        }),
      })
      await throwIfNotOk(response, settings.apiKey)
      return readCompletionStream(response, req.signal, onChunk)
    },
  }
}
