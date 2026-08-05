import type { LlmSettings } from './settings.js'
import { createOpenAiProvider } from './openai.js'
import { managedState } from './managed.js'

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface CompletionRequest {
  messages: ChatMessage[]
  /** Schemat JSON wymuszany na odpowiedzi modelu. */
  schema: object
  maxTokens: number
  signal: AbortSignal
}

export interface CompletionResult {
  text: string
  promptTokens: number
  completionTokens: number
}

export interface Provider {
  listModels: () => Promise<string[]>
  complete: (req: CompletionRequest) => Promise<CompletionResult>
  /**
   * Jak `complete`, ale wynik przychodzi kawałkami — `onChunk` dostaje każdy
   * kolejny fragment tekstu odpowiedzi, zanim strumień się zamknie. Obietnica
   * rozstrzyga się dopiero na końcu, z tym samym kształtem wyniku co
   * `complete` (pełny tekst i liczniki tokenów) — wywołujący, który
   * potrzebuje tylko końcowego wyniku, może zignorować `onChunk` i użyć tej
   * metody dokładnie tak samo jak `complete`.
   */
  stream: (req: CompletionRequest, onChunk: (text: string) => void) => Promise<CompletionResult>
}

/**
 * `null` znaczy „model nie jest skonfigurowany". Aplikacja ma działać w pełni
 * bez modelu, więc brak dostawcy nie jest błędem, tylko stanem.
 */
export function createProvider(settings: LlmSettings): Provider | null {
  if (settings.mode === 'endpoint' && settings.endpoint.baseUrl !== '') {
    return createOpenAiProvider(settings.endpoint)
  }
  if (settings.mode === 'managed') {
    const managed = managedState()
    // Serwer, który jeszcze się nie wystartował albo padł, to dla wołającego
    // to samo co brak dostawcy — `null` już umie obsłużyć.
    if (managed.status !== 'ready') return null
    return createOpenAiProvider({
      baseUrl: `http://127.0.0.1:${managed.port}/v1`,
      apiKey: '',
      // `llama-server` serwuje jeden, już wczytany model i nie waliduje pola
      // "model" w żądaniu, więc nie ma czego tu wpisać.
      model: '',
    })
  }
  return null
}
