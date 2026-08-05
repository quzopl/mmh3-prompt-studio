import type { z } from 'zod'
import type { ChatMessage, Provider } from './provider.js'

/**
 * Wspólny opis jednego zadania językowego: jak zbudować wiadomości, jakiego
 * schematu wymusić na odpowiedzi i jak ją zwalidować. Cztery zadania (redakcja
 * pomysłu, tłumaczenie, sugestie audio, krytyk) dzielą ten sam bieg w
 * `runTask` zamiast każde wymyślać własną obsługę naprawy.
 */
export interface TaskDefinition<T> {
  name: string
  schema: z.ZodType<T>
  jsonSchema: object
  buildMessages: (input: unknown) => ChatMessage[]
  maxTokens: number
}

export interface TaskResult<T> {
  value: T
  promptTokens: number
  completionTokens: number
  repaired: boolean
}

/**
 * Lokalne modele notorycznie owijają odpowiedź w płotek markdownu mimo
 * wymuszonego `response_format` i mimo instrukcji, żeby tego nie robić. To
 * formatowanie wokół treści, nie błąd treści — więc zdejmujemy płotek przed
 * próbą sparsowania, zamiast mylić ten objaw z niepoprawną odpowiedzią modelu.
 * Płotek może mieć znacznik języka albo nie i może być otoczony innym tekstem.
 */
function stripCodeFence(text: string): string {
  const match = /```(?:\w+)?\s*\n?([\s\S]*?)\n?```/.exec(text)
  return (match?.[1] ?? text).trim()
}

interface ParseFailure {
  /** Surowa odpowiedź modelu — cytowana w wiadomości naprawczej. */
  rawText: string
  /** Pełny opis błędu walidacji, do wglądu przez model przy naprawie. */
  fullDescription: string
  /** Pierwsze zdanie błędu — trafia do wyjątku, który widzi użytkownik. */
  firstSentence: string
}

type ParseAttempt<T> = { ok: true; value: T } | { ok: false; failure: ParseFailure }

function parseResponse<T>(rawText: string, schema: z.ZodType<T>): ParseAttempt<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(rawText))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const description = `odpowiedź nie jest poprawnym JSON-em (${message})`
    return { ok: false, failure: { rawText, fullDescription: description, firstSentence: description } }
  }

  const result = schema.safeParse(parsed)
  if (result.success) return { ok: true, value: result.data }

  const formatted = result.error.issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
  const firstSentence = formatted[0] ?? 'nieznany błąd walidacji'
  return { ok: false, failure: { rawText, fullDescription: formatted.join('; '), firstSentence } }
}

/**
 * Wiadomość naprawcza cytuje dokładnie to, co model odpowiedział, i dokładnie
 * to, co Zod uznał za błędne — model, który nie widzi własnej pomyłki, potrafi
 * ją tylko powtórzyć.
 */
function repairMessage(failure: ParseFailure): ChatMessage {
  return {
    role: 'user',
    content: [
      'Twoja poprzednia odpowiedź nie przeszła walidacji schematu.',
      '',
      'Twoja odpowiedź:',
      failure.rawText,
      '',
      'Błąd walidacji:',
      failure.fullDescription,
      '',
      'Popraw to. Zwróć wyłącznie poprawny JSON zgodny ze schematem — bez żadnego dodatkowego tekstu ani znaczników markdown.',
    ].join('\n'),
  }
}

/**
 * Wspólny bieg zadania językowego: zbuduj wiadomości, wymuś schemat, zwaliduj
 * Zodem. Przy niezgodności — łącznie z odpowiedzią, która nie jest nawet
 * poprawnym JSON-em — spróbuj dokładnie raz jeszcze, pokazując modelowi jego
 * własną odpowiedź i błąd. Druga porażka kończy się wyjątkiem, nie kolejną
 * próbą: pętla bez granicy to koszt, za który płaci użytkownik czasem.
 */
export async function runTask<T>(
  provider: Provider,
  task: TaskDefinition<T>,
  input: unknown,
  signal: AbortSignal,
): Promise<TaskResult<T>> {
  const messages = task.buildMessages(input)
  const first = await provider.complete({ messages, schema: task.jsonSchema, maxTokens: task.maxTokens, signal })
  const firstAttempt = parseResponse(first.text, task.schema)
  if (firstAttempt.ok) {
    return {
      value: firstAttempt.value,
      promptTokens: first.promptTokens,
      completionTokens: first.completionTokens,
      repaired: false,
    }
  }

  const repairMessages = [...messages, repairMessage(firstAttempt.failure)]
  const second = await provider.complete({ messages: repairMessages, schema: task.jsonSchema, maxTokens: task.maxTokens, signal })
  const secondAttempt = parseResponse(second.text, task.schema)
  // Tokeny sumują się przez obie próby — naprawa kosztuje drugie zapytanie,
  // a użytkownik ma widzieć pełny koszt, nie tylko koszt ostatniej próby.
  const promptTokens = first.promptTokens + second.promptTokens
  const completionTokens = first.completionTokens + second.completionTokens

  if (secondAttempt.ok) {
    return { value: secondAttempt.value, promptTokens, completionTokens, repaired: true }
  }

  throw new Error(`Zadanie „${task.name}" nie powiodło się: ${secondAttempt.failure.firstSentence}.`)
}
