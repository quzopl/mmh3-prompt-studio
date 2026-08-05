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
 * Usuwa klucz z tekstu, zanim ten trafi do komunikatu błędu. Niektóre proxy
 * odbijają całe żądanie w treści odpowiedzi błędu — bez tego klucz z nagłówka
 * Authorization powtórzyłby się w komunikacie, a stąd prosta droga do logów
 * i ekranu użytkownika.
 */
const redactKey = (text: string, apiKey: string): string =>
  apiKey === '' ? text : text.split(apiKey).join('[KLUCZ]')

async function readOrThrow(response: Response, apiKey: string): Promise<unknown> {
  if (!response.ok) {
    const body = redactKey(await response.text(), apiKey)
    throw new Error(`Model odpowiedział ${response.status}: ${body.slice(0, 200)}`)
  }
  return response.json()
}

export function createOpenAiProvider(settings: OpenAiSettings): Provider {
  const base = settings.baseUrl.replace(/\/+$/, '')

  return {
    async listModels() {
      const payload = await readOrThrow(
        await fetch(`${base}/models`, { headers: headersFor(settings.apiKey) }),
        settings.apiKey,
      )
      const data = (payload as { data?: Array<{ id?: unknown }> }).data ?? []
      return data
        .map(entry => entry.id)
        .filter((id): id is string => typeof id === 'string')
    },

    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const payload = await readOrThrow(
        await fetch(`${base}/chat/completions`, {
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
      const count = (value: unknown): number => typeof value === 'number' ? value : 0

      return {
        text: typeof content === 'string' ? content : '',
        promptTokens: count(body.usage?.prompt_tokens),
        completionTokens: count(body.usage?.completion_tokens),
      }
    },
  }
}
