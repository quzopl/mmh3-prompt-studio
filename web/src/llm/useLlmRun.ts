import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectPatch } from '@mmh3/shared'
import { useT, type Translate } from '../i18n/useT.js'

export type LlmRunStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

/**
 * Ciało `POST /api/llm/run` (`RunBody` w `server/src/routes/llm.ts`) — jedno
 * z czterech zadań, każde z własnym kształtem pól poza wspólnymi `task` i
 * `projectSlug`. Ten hak jest wyłącznie mechaniką sieci (strumień,
 * anulowanie, liczniki) i nie zna kształtu pól właściwych każdemu zadaniu —
 * przenosi je bez zmian, tak jak zrobiłby to zwykły `fetch`.
 */
export interface LlmRunRequest {
  task: string
  projectSlug: string
  [key: string]: unknown
}

/** Kształt zdarzenia `done` — ten sam, którego trasa używała jako całej
 * odpowiedzi JSON przed zadaniem 9 (patrz `routes/llm.ts`): łatka dla trzech
 * zadań, uwagi krytyka dla czwartego, zawsze liczniki tokenów i informacja o
 * naprawie. `promptTokens`/`completionTokens` bywają `null` w samym JSON-ie
 * (serwer, który nie zgłasza `usage`) — stąd `unknown`, nie `number`, tutaj:
 * odróżnienie „liczba" od „null" od „czegoś innego" dzieje się przy odczycie. */
interface DonePayload {
  patch?: unknown
  promptTokens?: unknown
  completionTokens?: unknown
  repaired?: unknown
}

const isProjectPatch = (value: unknown): value is ProjectPatch =>
  typeof value === 'object' && value !== null && Array.isArray((value as { ops?: unknown }).ops)

/** `number`, jeśli serwer zgłosił konkretną wartość; `null`, jeśli pole jest
 * `null`, brakuje go, albo ma zły typ — wszystkie te przypadki znaczą to
 * samo: „nieznane", nie „zero" (round 1 recenzji zadania 9). */
const asTokenCount = (value: unknown): number | null => typeof value === 'number' ? value : null

export interface UseLlmRunResult {
  status: LlmRunStatus
  /** Tekst BIEŻĄCEJ próby, złożony z kawałków w kolejności ich przyjścia —
   * wyłącznie do pokazania postępu. Resetuje się do pustego przy zdarzeniu
   * `repair` (druga, naprawcza próba to nowa odpowiedź modelu, nie ciąg
   * dalszy pierwszej — sklejenie obu w jeden tekst wyglądałoby jak jedna,
   * bełkotliwa odpowiedź). Nigdy nie jest parsowany jako JSON: łatka
   * (`patch`) przychodzi osobno, dopiero w zdarzeniu `done`. */
  text: string
  /** `true` od zdarzenia `repair` do końca zadania — pierwsza odpowiedź nie
   * przeszła walidacji i model jest pytany drugi raz. Panel może to pokazać
   * („model jest pytany ponownie"), zamiast zostawiać martwą ciszę między
   * pierwszą (nieudaną) a drugą próbą. */
  retrying: boolean
  /** `null`, dopóki zadanie nie zakończy się poprawnie (albo dla zadania
   * „critic", które nie zwraca łatki tylko uwagi — poza zakresem tego haka). */
  patch: ProjectPatch | null
  /** Licznik postępu w trakcie strumieniowania — liczba przyjętych kawałków
   * BIEŻĄCEJ próby (przybliżenie liczby tokenów; lokalne serwery zgodne z
   * API OpenAI wysyłają zwykle jeden kawałek na jeden wygenerowany token).
   * Na końcu przyjmuje dokładną wartość z `completionTokens`, ale TYLKO
   * jeśli serwer ją naprawdę zgłosił — jeśli nie (`completionTokens` jest
   * `null`), przybliżenie zostaje jako ostateczna wartość zamiast fałszywie
   * spaść do zera (dokładnie ten błąd naprawiła runda 1 recenzji: `0`
   * wygląda jak precyzyjna odpowiedź, a jest po prostu brakiem odpowiedzi). */
  tokens: number
  /** Dokładne liczniki z serwera modelu (pole `usage` odpowiedzi, zsumowane
   * przez obie próby w `runTask`) — `null`, dopóki zadanie się nie zakończy
   * ALBO gdy serwer modelu w ogóle ich nie zgłosił. `null` tutaj znaczy
   * „nieznane", nie „zero" — panel ma to pokazać jako kreskę, nie jako 0. */
  promptTokens: number | null
  completionTokens: number | null
  elapsedMs: number
  /** Komunikat błędu po polsku — `null`, dopóki `status` nie jest `'error'`. */
  error: string | null
  run: (request: LlmRunRequest) => void
  cancel: () => void
}

/** Jak często odświeżać `elapsedMs` w trakcie działania. Wartość dokładna w
 * momencie zakończenia (`done`/`error`/`cancelled`) jest zawsze doliczana
 * osobno — nie czeka na najbliższe tyknięcie, patrz `finish()` niżej. */
const ELAPSED_TICK_MS = 100

interface StreamCallbacks {
  onChunk: (text: string) => void
  /** Druga (naprawcza) próba `runTask` właśnie rusza — zdarzenie SSE `repair`. */
  onRetry: () => void
  onDone: (payload: DonePayload) => void
  onError: (message: string) => void
  onCancelled: () => void
}

/**
 * Czyta `text/event-stream` odpowiedzi trasy (`chunk`, `repair`, `done`,
 * `error`) tym samym sposobem, co `readCompletionStream` po stronie serwera
 * (`server/src/llm/openai.ts`): bufor gromadzi zdekodowany tekst i tnie go
 * WYŁĄCZNIE na pełnych granicach `\n\n`, więc kawałek rozdzielony w pół
 * między dwoma odczytami sieci — nawet w środku `data:`, w środku JSON-a,
 * czy w środku wielobajtowego znaku UTF-8 (stąd `{ stream: true }` przy
 * dekodowaniu, nie samo `decoder.decode(value)`) — czeka w buforze zamiast
 * się zgubić.
 *
 * Nasłuch na `abort` woła `reader.cancel()` — bez tego odczyt czekający na
 * kolejne bajty z serwera nie obudziłby się od razu po `cancel()`, i
 * przerwanie nie zatrzymałoby faktycznego połączenia od razu.
 */
async function readEventStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  t: Translate,
  callbacks: Pick<StreamCallbacks, 'onChunk' | 'onRetry' | 'onDone' | 'onError'>,
): Promise<void> {
  const reader = body.getReader()
  const onAbort = (): void => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', onAbort)

  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false

  try {
    while (!finished) {
      if (signal.aborted) return
      const { done, value } = await reader.read()
      if (signal.aborted) return
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1 && !finished) {
        const rawEvent = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)

        let eventName = 'message'
        let data: unknown
        // Kawałek, którego nie da się rozebrać jako JSON, to usterka
        // STRUMIENIA (serwer wysłał coś zepsutego), nie sieci — osobny
        // komunikat (round 1 recenzji zadania 9), żeby użytkownik nie szukał
        // problemu w połączeniu, którego nic złego się nie stało. `return`
        // (nie `throw`) zamyka funkcję od razu, ale wciąż przez `finally`
        // niżej, więc nasłuch na `abort` i tak zostaje zdjęty.
        for (const line of rawEvent.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim()
          if (line.startsWith('data:')) {
            try {
              data = JSON.parse(line.slice('data:'.length).trim())
            } catch {
              callbacks.onError(t('llm.streamError'))
              return
            }
          }
        }

        if (eventName === 'chunk' && typeof data === 'object' && data !== null) {
          const text = (data as { text?: unknown }).text
          if (typeof text === 'string') callbacks.onChunk(text)
        } else if (eventName === 'repair') {
          callbacks.onRetry()
        } else if (eventName === 'done') {
          callbacks.onDone((data ?? {}) as DonePayload)
          finished = true
        } else if (eventName === 'error') {
          const message = typeof data === 'object' && data !== null ? (data as { error?: unknown }).error : undefined
          callbacks.onError(typeof message === 'string' ? message : t('llm.unknownError'))
          finished = true
        }

        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** Rozmowa z trasą, od `fetch` po ostatnie zdarzenie — jedyne miejsce, w
 * którym hak wie, że transportem jest SSE. Nie jest hakiem samym w sobie
 * (nie woła `useT`/innych hooków), więc `t` przychodzi jako argument. */
async function streamRun(request: LlmRunRequest, signal: AbortSignal, t: Translate, callbacks: StreamCallbacks): Promise<void> {
  let response: Response
  try {
    response = await fetch('/api/llm/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') { callbacks.onCancelled(); return }
    callbacks.onError(t('llm.networkError'))
    return
  }

  if (!response.ok) {
    let message: string | undefined
    try {
      const body = await response.json() as { error?: unknown }
      if (typeof body.error === 'string') message = body.error
    } catch {
      // Odpowiedź bez ciała JSON do odczytania — zostaje komunikat z kodem statusu.
    }
    callbacks.onError(message ?? t('llm.httpError', { status: response.status }))
    return
  }

  if (response.body === null) {
    callbacks.onError(t('llm.networkError'))
    return
  }

  try {
    await readEventStream(response.body, signal, t, callbacks)
    // `readEventStream` kończy się cicho (bez rzucania) także wtedy, gdy
    // wyszła z pętli z powodu przerwania — samo zwrócenie się stąd nie mówi,
    // czy to było zwykłe zamknięcie po "done"/"error", czy anulowanie w
    // trakcie. Sprawdzenie `signal.aborted` po fakcie jest jedynym miejscem,
    // które to rozstrzyga; bez niego `cancel()` przestawałby coś pokazywać,
    // ale `status` nigdy nie doszedłby do `'cancelled'`.
    if (signal.aborted) callbacks.onCancelled()
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) { callbacks.onCancelled(); return }
    callbacks.onError(t('llm.networkError'))
  }
}

/**
 * Strumieniowanie odpowiedzi modelu z anulowaniem i licznikami (zadanie 9,
 * plan „lokalny LLM"): model lokalny na dużym pliku odpowiada dziesiątki
 * sekund, bez strumieniowania panel wygląda na zawieszony, a bez anulowania
 * jedyną drogą wyjścia jest przeładowanie strony.
 */
export function useLlmRun(): UseLlmRunResult {
  const t = useT()
  // `useT()` zwraca nową funkcję przy KAŻDYM renderze — a `elapsedMs` sam z
  // siebie wywołuje nowy render co `ELAPSED_TICK_MS` przez cały czas trwania
  // zadania. Gdyby `t` siedziało w tablicy zależności `run` poniżej, `run`
  // zmieniałoby tożsamość dziesięć razy na sekundę, i każdy konsument z
  // `useEffect(…, [run])` zapętliłby się (round 1 recenzji zadania 9). Ref
  // aktualizowany po każdym renderze daje `run()` dostęp do NAJŚWIEŻSZEGO
  // tłumaczenia bez robienia zeń zależności.
  const tRef = useRef(t)
  useEffect(() => { tRef.current = t }, [t])

  const [status, setStatus] = useState<LlmRunStatus>('idle')
  const [text, setText] = useState('')
  const [retrying, setRetrying] = useState(false)
  const [patch, setPatch] = useState<ProjectPatch | null>(null)
  const [tokens, setTokens] = useState(0)
  const [promptTokens, setPromptTokens] = useState<number | null>(null)
  const [completionTokens, setCompletionTokens] = useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const controllerRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startRef = useRef(0)
  // Rośnie o jeden przy każdym `run()`. `cancel()` woła `controller.abort()`
  // na BIEŻĄCYM sterowniku, ale samo przerwanie rozstrzyga się asynchronicznie
  // (`streamRun` musi jeszcze zauważyć `signal.aborted`) — gdyby użytkownik
  // zdążył wywołać `run()` PONOWNIE, zanim to nastąpi (nowy bieg zanim stary
  // się domknął), spóźniony `onCancelled` starego biegu trafiłby w stan
  // NOWEGO: zresetowałby jego zegar (`finish()` czyta/zeruje `timerRef` i
  // `controllerRef` wspólne dla obu) i nadpisał jego `status` na `'cancelled'`.
  // Każde wywołanie zwrotne sprawdza, czy nadal jest „bieżące" — jeśli nie,
  // jest ciche.
  const generationRef = useRef(0)

  const stopTicking = useCallback((): void => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /** Zamyka licznik czasu na dokładnej wartości w chwili zakończenia, zamiast
   * czekać na najbliższe tyknięcie interwału (mogłoby spóźnić się o cały
   * `ELAPSED_TICK_MS`), i gasi `retrying` — po zakończeniu zadania (bez
   * względu na wynik) nie jesteśmy już „w trakcie ponownego pytania". */
  const finish = useCallback((): void => {
    stopTicking()
    setElapsedMs(Date.now() - startRef.current)
    setRetrying(false)
    controllerRef.current = null
  }, [stopTicking])

  useEffect(() => () => {
    // Odmontowanie w trakcie działania: przerwij połączenie i zegar, żeby
    // żaden z nich nie pisał do stanu komponentu, którego już nie ma.
    controllerRef.current?.abort()
    stopTicking()
  }, [stopTicking])

  const cancel = useCallback((): void => {
    controllerRef.current?.abort()
  }, [])

  const run = useCallback((request: LlmRunRequest): void => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    generationRef.current += 1
    const generation = generationRef.current
    const isCurrent = (): boolean => generationRef.current === generation

    setStatus('running')
    setText('')
    setRetrying(false)
    setPatch(null)
    setTokens(0)
    setPromptTokens(null)
    setCompletionTokens(null)
    setError(null)
    setElapsedMs(0)

    startRef.current = Date.now()
    stopTicking()
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startRef.current)
    }, ELAPSED_TICK_MS)

    void streamRun(request, controller.signal, tRef.current, {
      onChunk: chunkText => {
        if (!isCurrent()) return
        setText(prev => prev + chunkText)
        setTokens(prev => prev + 1)
      },
      onRetry: () => {
        if (!isCurrent()) return
        // Druga próba to nowa odpowiedź modelu, nie ciąg dalszy pierwszej —
        // sklejenie obu w jeden tekst wyglądałoby jak jedna, bełkotliwa
        // odpowiedź (round 1 recenzji zadania 9). Licznik kawałków też
        // wraca do zera z tego samego powodu: liczy postęp BIEŻĄCEJ próby.
        setText('')
        setTokens(0)
        setRetrying(true)
      },
      onDone: payload => {
        if (!isCurrent()) return
        finish()
        setPatch(isProjectPatch(payload.patch) ? payload.patch : null)
        const finalCompletion = asTokenCount(payload.completionTokens)
        setPromptTokens(asTokenCount(payload.promptTokens))
        setCompletionTokens(finalCompletion)
        // Tylko prawdziwa liczba nadpisuje przybliżenie z kawałków — `null`
        // (serwer nie zgłosił) zostawia lepsze z tego, co już wiadomo,
        // zamiast fałszywie spadać do zera na oczach użytkownika.
        if (finalCompletion !== null) setTokens(finalCompletion)
        setStatus('done')
      },
      onError: message => {
        if (!isCurrent()) return
        finish()
        setError(message)
        setStatus('error')
      },
      onCancelled: () => {
        if (!isCurrent()) return
        finish()
        setStatus('cancelled')
      },
    })
  }, [finish, stopTicking])

  return { status, text, retrying, patch, tokens, promptTokens, completionTokens, elapsedMs, error, run, cancel }
}
