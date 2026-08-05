import type { LlmSettings } from './settings.js'
import { createOpenAiProvider } from './openai.js'

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
}

/**
 * `null` znaczy „model nie jest skonfigurowany". Aplikacja ma działać w pełni
 * bez modelu, więc brak dostawcy nie jest błędem, tylko stanem.
 */
export function createProvider(settings: LlmSettings): Provider | null {
  if (settings.mode === 'endpoint' && settings.endpoint.baseUrl !== '') {
    return createOpenAiProvider(settings.endpoint)
  }
  return null
}
