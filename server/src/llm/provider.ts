import type { LlmSettings } from './settings.js'
import { createOpenAiProvider } from './openai.js'
import { managedState } from './managed.js'

export interface ChatMessage {
  /**
   * `assistant` doszło razem z zadaniem rozmowy o polu (`tasks/fieldChat.ts`):
   * historia wątku ma trafiać do modelu jako NAPRZEMIENNE tury, bo tylko wtedy
   * „mocniej" albo „nie, mniej deszczu" ma się do czego odnieść. Zlepienie
   * historii w jedną wiadomość użytkownika gubi, które zdania napisał model, a
   * to jest dokładnie ta informacja, którą doprecyzowanie modyfikuje.
   *
   * Warstwa HTTP przepuszcza role bez tłumaczenia (`openai.ts` wysyła
   * `messages: req.messages` wprost), a `assistant` jest rolą własną protokołu
   * OpenAI — więc rozszerzenie tej unii nie wymaga niczego po tamtej stronie.
   */
  role: 'system' | 'user' | 'assistant'
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
  /**
   * `null` znaczy „serwer modelu w ogóle nie zgłosił tej liczby" (np. lokalny
   * serwer bez wsparcia dla `stream_options.include_usage`, albo pole `usage`
   * nieobecne w odpowiedzi bez strumienia) — to co innego niż zgłoszone `0`.
   * Mylenie tych dwóch (round 1 recenzji zadania 9: `clampTokenCount` cicho
   * zamieniało brak na zero) sprawiało, że licznik w interfejsie rósł w
   * trakcie strumieniowania, a na końcu spadał do zera, wyglądając na
   * skłamany od początku. Zero ma zostać zerem tylko wtedy, gdy model
   * naprawdę tyle zgłosił.
   */
  promptTokens: number | null
  completionTokens: number | null
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
