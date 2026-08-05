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
 */
async function readOrThrow(response: Response, apiKey: string): Promise<unknown> {
  if (!response.ok) {
    if (apiKey !== '') {
      throw new Error(`Model odpowiedział błędem ${response.status}. Sprawdź log serwera modelu po szczegóły.`)
    }
    const body = await response.text()
    throw new Error(`Model odpowiedział ${response.status}: ${body.slice(0, 200)}`)
  }
  return response.json()
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
      // Model bywa niekonsekwentny w licznikach — ujemna wartość nie ma sensu
      // i w liczniku w interfejsie wygląda jak błąd po naszej stronie, więc
      // przycinamy do zera zamiast przepuszczać dalej.
      const count = (value: unknown): number => typeof value === 'number' ? Math.max(0, value) : 0

      return {
        text: typeof content === 'string' ? content : '',
        promptTokens: count(body.usage?.prompt_tokens),
        completionTokens: count(body.usage?.completion_tokens),
      }
    },
  }
}
