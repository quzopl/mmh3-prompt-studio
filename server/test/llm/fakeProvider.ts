import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

/**
 * Fałszywy dostawca zgodny z protokołem OpenAI (zadanie 13) — do testu e2e
 * `web/e2e/llm.spec.ts`. Test nie może zależeć od tego, czy na maszynie stoi
 * prawdziwy model lokalny: ten serwer stoi na dowolnym wolnym porcie systemu
 * (`listen(0, …)`), więc dwa przebiegi `npm run e2e` pod rząd nigdy nie walczą
 * o ten sam port, nawet jeśli poprzedni proces nie zamknął go w porę — problem,
 * przed którym `web/playwright.config.ts` ostrzega przy prawdziwym API
 * (`reuseExistingServer: false`, czyszczenie `/tmp/mmh3-e2e`). Mimo to
 * `close()` MUSI być wołane po każdym teście (patrz JSDoc niżej) — inaczej to
 * proces samego Playwrighta nie kończy się, nie port kolejnego przebiegu.
 *
 * Obsługuje wyłącznie ścieżkę, której naprawdę używa trasa serwera:
 * `POST .../chat/completions` ze strumieniem SSE w formacie zgodnym z
 * `readCompletionStream` (`server/src/llm/openai.ts`) — kawałki
 * `choices[0].delta.content`, kawałek z `usage` i zamknięcie `data: [DONE]`.
 * `runTask` (`server/src/llm/run.ts`) woła WYŁĄCZNIE `provider.stream()` przez
 * trasę `/api/llm/run` (`toChunkForwardingProvider` w `server/src/routes/llm.ts`),
 * nigdy `complete()` bez strumienia — więc innej odpowiedzi ten serwer nie
 * musi umieć dać. Każda inna ścieżka (np. sondy `/api/tags`/`/api/v0/models`
 * z wykrywania możliwości zwolnienia pamięci, `server/src/llm/unload.ts`)
 * dostaje szybkie 404, żeby te sondy nie czekały na limit czasu.
 */

/** Treść żądania faktycznie odebranego przez serwer — do asercji w teście, że
 * cała droga (parsowanie, wymuszenie schematu, strumieniowanie) naprawdę
 * przeszła przez prawdziwe HTTP, a nie przez zaślepkę w pamięci. */
export interface FakeChatCompletionRequest {
  model?: unknown
  messages?: unknown
  stream?: unknown
  response_format?: unknown
  max_tokens?: unknown
}

export interface FakeProviderOptions {
  /** Pełny tekst JSON, jaki model „odpowiada" — sklejony z kawałków strumienia
   * u klienta, potem parsowany i walidowany Zodem przez `runTask`. */
  responseText: string
  /** Opóźnienie między kolejnymi kawałkami strumienia w milisekundach.
   * Prawdziwy model lokalny odpowiada rozłożony w czasie, nie w jednej
   * klatce zdarzeń — test anulowania w trakcie (`llm.spec.ts`) potrzebuje na
   * to prawdziwego okna, więc wartość domyślna jest rozmyślnie wyczuwalna, nie
   * błyskawiczna. */
  chunkDelayMs?: number
  /** Liczba kawałków, na które dzielimy `responseText`. */
  chunkCount?: number
}

export interface FakeProviderHandle {
  /** Korzeń do wpisania wprost w pole „Adres endpointu" panelu LLM — bez
   * `/v1`, bo trasa serwera i tak dokleja `/chat/completions` do ścieżki
   * `baseUrl` przez `URL` (`requestUrl` w `openai.ts`), więc korzeń
   * wystarcza i nie udaje żadnego konkretnego, prawdziwego dostawcy. */
  baseUrl: string
  /** Liczba żądań `chat/completions`, jakie serwer faktycznie odebrał. */
  requestCount: () => number
  /** Treść ostatniego odebranego żądania, sparsowana z JSON-a ciała — `null`,
   * dopóki żadne żądanie jeszcze nie przyszło. */
  lastRequest: () => FakeChatCompletionRequest | null
  /** Zamyka serwer i zrywa wszystkie otwarte gniazda (w tym te trzymane przez
   * `keep-alive`) — samo `server.close()` czeka, aż klient sam je zamknie, co
   * przy przerwanym w połowie strumieniu (test anulowania) może się nigdy nie
   * zdarzyć i zawiesić zamknięcie testu. MUSI być wołane w `finally` testu:
   * bez tego proces Playwrighta trzyma otwarty deskryptor portu i albo nie
   * kończy się sam, albo (przy sztywnym porcie) blokuje drugi przebieg — tu
   * port jest losowy (`listen(0, …)`), więc konsekwencją braku wywołania
   * byłby tylko wiszący proces, nie zajęty port, ale i tak nie ma powodu tego
   * ryzykować. */
  close: () => Promise<void>
}

function chunksOf(text: string, count: number): string[] {
  const size = Math.max(1, Math.ceil(text.length / Math.max(1, count)))
  const pieces: string[] = []
  for (let index = 0; index < text.length; index += size) pieces.push(text.slice(index, index + size))
  return pieces.length > 0 ? pieces : ['']
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** Strumieniuje jedną odpowiedź `chat/completions` — dokładnie kształt, jaki
 * `readCompletionStream` po stronie klienta (`server/src/llm/openai.ts`)
 * potrafi rozebrać: kawałki `delta.content`, potem kawałek z `usage`
 * (bez niego licznik tokenów zostałby `null` na zawsze, tak jak przy
 * lokalnym serwerze bez wsparcia dla `stream_options.include_usage`), potem
 * `data: [DONE]`. */
function streamCompletion(res: ServerResponse, pieces: string[], chunkDelayMs: number): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  })

  let cancelled = false
  let index = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  // Klient (Fastify, w imieniu przeglądarki) zrywa połączenie przy anulowaniu
  // zadania — bez tego nasłuchu pętla pisałaby dalej na martwe gniazdo
  // (rzucając) i trzymała otwarty `setTimeout`, więc serwer nigdy by się
  // porządnie nie zamknął.
  const stop = (): void => { cancelled = true; if (timer) clearTimeout(timer) }
  res.on('close', stop)

  const writeNext = (): void => {
    if (cancelled) return
    if (index >= pieces.length) {
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 42, completion_tokens: pieces.length } })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    const delta = pieces[index] ?? ''
    index += 1
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`)
    timer = setTimeout(writeNext, chunkDelayMs)
  }
  writeNext()
}

export async function startFakeProvider(options: FakeProviderOptions): Promise<FakeProviderHandle> {
  const chunkDelayMs = options.chunkDelayMs ?? 150
  const chunkCount = options.chunkCount ?? 10
  const pieces = chunksOf(options.responseText, chunkCount)

  let requestCount = 0
  let lastRequest: FakeChatCompletionRequest | null = null

  const server: Server = createServer((req, res) => {
    const url = req.url ?? ''
    if (req.method !== 'POST' || !url.endsWith('/chat/completions')) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"error":"nieobsługiwana ścieżka fałszywego dostawcy"}')
      return
    }

    readBody(req)
      .then(raw => {
        requestCount += 1
        try {
          lastRequest = JSON.parse(raw) as FakeChatCompletionRequest
        } catch {
          lastRequest = null
        }
        streamCompletion(res, pieces, chunkDelayMs)
      })
      .catch(() => {
        res.writeHead(500)
        res.end()
      })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Fałszywy dostawca nie dostał adresu TCP po starcie.')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requestCount: () => requestCount,
    lastRequest: () => lastRequest,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close(error => (error ? reject(error) : resolve()))
      }),
  }
}
