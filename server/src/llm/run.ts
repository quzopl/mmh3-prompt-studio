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
 * Płotek zdejmujemy tylko wtedy, gdy owija odpowiedź w całości — grawisy na
 * samym początku i na samym końcu (po przycięciu białych znaków), nic
 * bardziej rozpoznawcze. Wcześniejsza wersja szukała potrójnego grawisu
 * gdziekolwiek w tekście, więc poprawny JSON, który miał taki ciąg wewnątrz
 * wartości string (np. cytat z fragmentem kodu), był okaleczany do samego
 * fragmentu między przypadkowymi grawisami — reszta odpowiedzi znikała bez
 * śladu. Odpowiedź, która nie jest opłotkowana w całości (np. z komentarzem
 * modelu przed albo po), zostaje nietknięta i ma szansę uczciwie nie
 * sparsować się jako JSON zamiast zostać zgadywana.
 */
const FENCE_PATTERN = /^```(?:\w+)?\n?([\s\S]*)```$/

function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const match = FENCE_PATTERN.exec(trimmed)
  return (match?.[1] ?? trimmed).trim()
}

interface ParseFailure {
  /** Surowa odpowiedź modelu — cytowana w wiadomości naprawczej. */
  rawText: string
  /**
   * Wyjaśnienie po angielsku, dla modelu: surowe błędy Zoda albo błąd
   * parsowania JSON. Model rozumuje po angielsku, więc to jest język, w
   * którym najskuteczniej poprawi własną odpowiedź — nie tłumaczymy go.
   */
  modelExplanation: string
  /** `true`, gdy odpowiedź w ogóle nie sparsowała się jako JSON — wtedy nie ma ścieżek pól. */
  invalidJson: boolean
  /** Ścieżki niezgodnych pól — neutralne językowo, bezpieczne do pokazania użytkownikowi wprost. */
  fieldPaths: string[]
}

type ParseAttempt<T> = { ok: true; value: T } | { ok: false; failure: ParseFailure }

function parseResponse<T>(rawText: string, schema: z.ZodType<T>): ParseAttempt<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(rawText))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      failure: {
        rawText,
        modelExplanation: `Your answer was not valid JSON: ${message}`,
        invalidJson: true,
        fieldPaths: [],
      },
    }
  }

  const result = schema.safeParse(parsed)
  if (result.success) return { ok: true, value: result.data }

  const fieldPaths = result.error.issues.map(issue => issue.path.join('.') || '(root)')
  const modelExplanation = result.error.issues
    .map(issue => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')
  return { ok: false, failure: { rawText, modelExplanation, invalidJson: false, fieldPaths } }
}

/**
 * Wiadomość naprawcza jest w całości po angielsku i cytuje dokładnie to, co
 * model odpowiedział, oraz surowe błędy Zoda — to audytorium modelu, nie
 * użytkownika, i model, który nie widzi własnej pomyłki, potrafi ją tylko
 * powtórzyć. Tłumaczenie tej wiadomości na polski nic by nie dało modelowi i
 * tylko oddaliłoby ją od formy, w jakiej Zod faktycznie zgłasza błędy.
 */
function repairMessage(failure: ParseFailure): ChatMessage {
  return {
    role: 'user',
    content: [
      'Your previous answer did not pass schema validation.',
      '',
      'Your answer:',
      failure.rawText,
      '',
      'Validation error:',
      failure.modelExplanation,
      '',
      'Fix this. Return only valid JSON matching the schema — no extra text, no markdown formatting.',
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

  // Ten komunikat czyta użytkownik, nie model — surowy angielski tekst
  // biblioteki (Zoda albo `JSON.parse`) tu nie trafia. Ścieżki pól są
  // neutralne językowo, więc można je pokazać wprost, nie udając, że reszta
  // komunikatu jest tłumaczeniem czegoś, czego nikt nie tłumaczył.
  const { failure } = secondAttempt
  const reason = failure.invalidJson
    ? 'odpowiedź modelu nie jest poprawnym JSON-em'
    : `niezgodne pola: ${failure.fieldPaths.join(', ')}`
  throw new Error(`Zadanie „${task.name}": ${reason}.`)
}
