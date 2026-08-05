import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'

/**
 * `POST /api/llm/run` to jedyne miejsce, którym wynik modelu naprawdę
 * dociera do klienta — brakowało dla niej jakiegokolwiek testu (runda 1
 * recenzji zadania 6). Rozmowa z modelem sama w sobie jest pokryta przez
 * `run.test.ts` i `openai.test.ts`; tu sprawdzamy trasę: walidację ciała,
 * brak dostawcy, brak projektu, awarię modelu i ścieżkę szczęśliwą.
 */

let root: string
let app: FastifyInstance

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-llm-route-'))
  app = await buildApp({ dataRoot: root })
})

afterEach(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const createProject = async (name: string, mode = 'T2VA') => {
  const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name, mode } })
  return res.json().slug as string
}

/** Włącza dostawcę „endpoint" — reszta ustawień jak wymaga `LlmSettingsSchema`. */
const enableProvider = async () => {
  await app.inject({
    method: 'PUT',
    url: '/api/llm/settings',
    payload: {
      mode: 'endpoint',
      endpoint: { baseUrl: 'http://model.local/v1', apiKey: 'tajne', model: 'qwen' },
      managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 8192 },
    },
  })
}

const mockFetch = (handler: (callIndex: number) => Response) => {
  let call = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    const response = handler(call)
    call += 1
    return response
  }))
}

// Zadanie 9: trasa zawsze rozmawia z modelem przez `Provider.stream` (patrz
// `toChunkForwardingProvider` w `routes/llm.ts`), więc odpowiedź zaślepki
// musi mieć kształt SSE żądania `stream: true` (kawałki `delta.content`,
// końcowy kawałek z `usage`, zamknięcie `[DONE]`) — nie płaski JSON
// `choices[0].message.content` sprzed tego zadania.
const chatResponse = (content: string) => new Response([
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
  `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 22 } })}`,
  'data: [DONE]',
].join('\n\n') + '\n\n')

// Runda 1 recenzji zadania 9: serwer, który nie wspiera
// `stream_options.include_usage` — nigdy nie wysyła kawałka z `usage`.
const chatResponseNoUsage = (content: string) => new Response([
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
  'data: [DONE]',
].join('\n\n') + '\n\n')

const validStructureJson = JSON.stringify({
  shots: [{ startSeconds: 0, composition: 'a wide shot of an empty platform', action: 'a woman waits alone' }],
})

const runBody = (overrides: Record<string, unknown> = {}) => ({
  task: 'structure',
  projectSlug: 'test-projekt',
  ideaA: 'Kobieta czeka na pociąg.',
  ideaB: 'Pociąg nigdy nie przyjeżdża.',
  ...overrides,
})

// Ciała żądań dla pozostałych trzech zadań — używane tylko w bloku „kształt
// odpowiedzi zależny od zadania" niżej. `redact` celuje w `nonDiegeticMusic`
// (domyślnie 'N/A' w świeżym projekcie — patrz `storage/newProject.ts`), bo
// to jedyne pole, które `newProject` zostawia niepuste; cel `style` albo
// `overallSoundscape` dostałby 400 z trasy zanim model w ogóle by odpowiedział.
const structureBody = (slug: string) => ({
  task: 'structure',
  projectSlug: slug,
  ideaA: 'Kobieta czeka na pociąg.',
  ideaB: 'Pociąg nigdy nie przyjeżdża.',
})
const redactBody = (slug: string) => ({
  task: 'redact',
  projectSlug: slug,
  target: { kind: 'audio', field: 'nonDiegeticMusic' },
})
const audioBody = (slug: string) => ({ task: 'audio', projectSlug: slug })
const criticBody = (slug: string) => ({ task: 'critic', projectSlug: slug })

const validRedactJson = JSON.stringify({ english: 'Ambient silence, unscored.' })
const validAudioJson = JSON.stringify({
  soundscape: 'Wind creaks through a chain-link fence beyond the platform.',
  music: 'A slow piano figure repeats over a soft, sustained drone.',
})
// `newProject` (`storage/newProject.ts`) ustawia `id: slug` — więc `slug`
// jest tu jednocześnie identyfikatorem obiektu 'project', na który
// `criticAllowedRefs` zawsze pozwala wskazać, niezależnie od tego, co
// jeszcze projekt zawiera.
const validCriticJson = (slug: string) => JSON.stringify({
  notes: [{ ref: { kind: 'project', id: slug }, message: 'Rozważ dodanie ujęcia ustanawiającego.', severity: 'hint' }],
})

/**
 * Zadanie 9: trasa strumieniuje `text/event-stream` zamiast pojedynczego
 * ciała JSON — `app.inject()` (light-my-request) i tak buforuje wszystko, co
 * trafia na `reply.raw`, niezależnie od `reply.hijack()`, więc dla testów na
 * tym poziomie wystarczy poczekać na całą odpowiedź i rozciąć ją na zdarzenia
 * po fakcie. Rozcina po pustej linii (`\n\n`), tak jak przepisuje to RFC SSE —
 * każdy blok niesie co najwyżej jedną linię `event:` i jedną `data:`.
 */
interface SseEvent { event: string; data: unknown }

function parseSse(payload: string): SseEvent[] {
  return payload
    .split('\n\n')
    .filter(block => block.trim() !== '')
    .map(block => {
      const lines = block.split('\n')
      const eventLine = lines.find(line => line.startsWith('event:'))
      const dataLine = lines.find(line => line.startsWith('data:'))
      return {
        event: eventLine ? eventLine.slice('event:'.length).trim() : 'message',
        data: dataLine ? JSON.parse(dataLine.slice('data:'.length).trim()) : undefined,
      }
    })
}

/** Zdarzenie `done` niesie wynik zadania — dokładnie jedno na odpowiedź w
 * ścieżce szczęśliwej. Rzuca, jeśli go nie ma, żeby błąd testu wskazywał na
 * przyczynę, a nie na `undefined` gdzieś głębiej w asercji. */
function doneData(payload: string): Record<string, unknown> {
  const events = parseSse(payload)
  const done = events.find(e => e.event === 'done')
  if (!done) throw new Error(`brak zdarzenia "done" w odpowiedzi: ${payload}`)
  return done.data as Record<string, unknown>
}

describe('POST /api/llm/run', () => {
  it('zwraca 400 przy ciele niezgodnym ze schematem (brakujące pole)', async () => {
    const slug = await createProject('Test projekt')
    await enableProvider()
    const res = await app.inject({
      method: 'POST', url: '/api/llm/run',
      payload: runBody({ projectSlug: slug, ideaB: undefined }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('zwraca 400 dla nieznanego rodzaju zadania', async () => {
    const slug = await createProject('Test projekt')
    await enableProvider()
    const res = await app.inject({
      method: 'POST', url: '/api/llm/run',
      payload: runBody({ projectSlug: slug, task: 'nieznane' }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('zwraca 409, gdy dostawca modelu nie jest skonfigurowany', async () => {
    const slug = await createProject('Test projekt')
    // Domyślne ustawienia to `mode: 'off'` — dostawcy celowo nie włączamy.
    const res = await app.inject({
      method: 'POST', url: '/api/llm/run',
      payload: runBody({ projectSlug: slug }),
    })
    expect(res.statusCode).toBe(409)
  })

  it('zwraca 404, gdy projekt o podanym slugu nie istnieje', async () => {
    await enableProvider()
    const res = await app.inject({
      method: 'POST', url: '/api/llm/run',
      payload: runBody({ projectSlug: 'nie-ma-takiego' }),
    })
    expect(res.statusCode).toBe(404)
  })

  it('kończy się zdarzeniem "error", gdy model odpowiada błędem po obu próbach — odpowiedź HTTP jest już strumieniem (200)', async () => {
    const slug = await createProject('Test projekt')
    await enableProvider()
    mockFetch(() => chatResponse('to nie jest poprawny JSON'))
    const res = await app.inject({
      method: 'POST', url: '/api/llm/run',
      payload: runBody({ projectSlug: slug }),
    })
    // Kod 200 i nagłówki idą, zanim wiadomo, czy model w ogóle odpowie
    // poprawnie — błąd trafia w treść strumienia jako zdarzenie, nie w kod
    // statusu, którego po `reply.hijack()` nie da się już zmienić.
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    const events = parseSse(res.payload)
    expect(events.some(e => e.event === 'done')).toBe(false)
    const error = events.find(e => e.event === 'error')
    expect(error?.data).toMatchObject({ error: expect.any(String) })
  })

  it('ścieżka szczęśliwa: zwraca łatkę i liczniki tokenów, sumowane, gdy naprawa nie była potrzebna', async () => {
    const slug = await createProject('Test projekt')
    await enableProvider()
    mockFetch(() => chatResponse(validStructureJson))
    const res = await app.inject({
      method: 'POST', url: '/api/llm/run',
      payload: runBody({ projectSlug: slug }),
    })
    expect(res.statusCode).toBe(200)
    const body = doneData(res.payload)
    expect(body.repaired).toBe(false)
    expect(body.promptTokens).toBe(11)
    expect(body.completionTokens).toBe(22)
    const patch = body.patch as { ops: Array<{ kind: string; shots: Array<{ composition: string }> }> }
    expect(patch.ops).toHaveLength(1)
    expect(patch.ops[0]?.kind).toBe('replaceShots')
    expect(patch.ops[0]?.shots[0]?.composition).toBe('a wide shot of an empty platform')
  })

  it('naprawa po jednym błędnym wywołaniu sumuje tokeny z obu prób i zgłasza repaired: true', async () => {
    const slug = await createProject('Test projekt')
    await enableProvider()
    mockFetch(callIndex => (callIndex === 0 ? chatResponse('zepsuty JSON') : chatResponse(validStructureJson)))
    const res = await app.inject({
      method: 'POST', url: '/api/llm/run',
      payload: runBody({ projectSlug: slug }),
    })
    expect(res.statusCode).toBe(200)
    const body = doneData(res.payload)
    expect(body.repaired).toBe(true)
    expect(body.promptTokens).toBe(22)
    expect(body.completionTokens).toBe(44)
  })

  it('strumieniuje kawałki odpowiedzi jako zdarzenia "chunk" przed zdarzeniem "done"', async () => {
    const slug = await createProject('Test projekt')
    await enableProvider()
    mockFetch(() => chatResponse(validStructureJson))
    const res = await app.inject({
      method: 'POST', url: '/api/llm/run',
      payload: runBody({ projectSlug: slug }),
    })
    const events = parseSse(res.payload)
    const doneIndex = events.findIndex(e => e.event === 'done')
    const chunkEvents = events.filter(e => e.event === 'chunk')
    // Guard właściwy zamiast rzutu `as` na dostęp indeksowany (runda 1
    // recenzji zadania 9: rzut na wynik indeksowania to zamaskowana asercja
    // non-null — `noUncheckedIndexedAccess` istnieje właśnie po to, żeby
    // to złapać, a rzut go obchodzi).
    const firstChunk = chunkEvents[0]
    if (firstChunk === undefined) throw new Error('brak zdarzenia "chunk" w odpowiedzi')
    // "done" niesie łatkę i musi przyjść PO wszystkich kawałkach — łatka
    // budowana jest dopiero po zamknięciu strumienia (brief zadania 9), nie
    // wcześniej.
    expect(events.indexOf(firstChunk)).toBeLessThan(doneIndex)
  })

  // Runda 1 recenzji zadania 9: `repair` sygnalizuje start drugiej próby —
  // bez tego przerwa między nieudaną pierwszą odpowiedzią a drugim
  // zapytaniem do modelu nie miałaby żadnego zdarzenia.
  it('wysyła zdarzenie "repair" dokładnie raz, między kawałkami pierwszej a drugiej próby, przed "done"', async () => {
    const slug = await createProject('Test projekt')
    await enableProvider()
    mockFetch(callIndex => (callIndex === 0 ? chatResponse('zepsuty JSON') : chatResponse(validStructureJson)))
    const res = await app.inject({
      method: 'POST', url: '/api/llm/run',
      payload: runBody({ projectSlug: slug }),
    })

    const events = parseSse(res.payload)
    const repairEvents = events.filter(e => e.event === 'repair')
    expect(repairEvents).toHaveLength(1)

    const repairIndex = events.findIndex(e => e.event === 'repair')
    const doneIndex = events.findIndex(e => e.event === 'done')
    const chunkIndices = events.map((e, i) => (e.event === 'chunk' ? i : -1)).filter(i => i !== -1)
    const firstChunkIndex = chunkIndices[0]
    const lastChunkIndex = chunkIndices[chunkIndices.length - 1]
    if (firstChunkIndex === undefined || lastChunkIndex === undefined) {
      throw new Error('brak zdarzeń "chunk" w odpowiedzi')
    }

    // Kawałki płyną przez cały czas trwania zadania (obie próby przez ten
    // sam kanał `onChunk`, patrz `toChunkForwardingProvider`) — "repair"
    // musi więc wypaść GDZIEŚ w środku ciągu kawałków, nie przed pierwszym
    // ani po ostatnim, i zawsze przed "done".
    expect(repairIndex).toBeGreaterThan(firstChunkIndex)
    expect(repairIndex).toBeLessThan(lastChunkIndex)
    expect(repairIndex).toBeLessThan(doneIndex)
  })

  it('NIE wysyła zdarzenia "repair", gdy pierwsza próba od razu przechodzi walidację', async () => {
    const slug = await createProject('Test projekt')
    await enableProvider()
    mockFetch(() => chatResponse(validStructureJson))
    const res = await app.inject({
      method: 'POST', url: '/api/llm/run',
      payload: runBody({ projectSlug: slug }),
    })
    const events = parseSse(res.payload)
    expect(events.some(e => e.event === 'repair')).toBe(false)
  })

  // Runda 1 recenzji zadania 9: serwer, który nigdy nie zgłasza `usage`
  // (nie wspiera `stream_options`), ma dać `null` w zdarzeniu "done", nie
  // ciche zero — zero wygląda jak precyzyjna odpowiedź modelu.
  it('gdy model nigdy nie zgłasza usage, "done" niesie promptTokens/completionTokens jako null, nie zero', async () => {
    const slug = await createProject('Test projekt')
    await enableProvider()
    mockFetch(() => chatResponseNoUsage(validStructureJson))
    const res = await app.inject({
      method: 'POST', url: '/api/llm/run',
      payload: runBody({ projectSlug: slug }),
    })
    const body = doneData(res.payload)
    expect(body.promptTokens).toBeNull()
    expect(body.completionTokens).toBeNull()
  })

  /**
   * Runda 2 recenzji: `app.inject` (`light-my-request`) nie modeluje realnego
   * zerwania gniazda TCP, więc poprzednia wersja tego pliku nie mogła dowieść
   * ani starej usterki (`new AbortController()`, którego nic nie przerywa),
   * ani jej naprawy (`request.signal`, który — jak się okazało — jest martwy
   * z INNEGO powodu: leniwy odczyt po `await` trafia na zdarzenie `close`,
   * które już minęło). Ten test zakłada PRAWDZIWY serwer nasłuchujący na
   * porcie, łączy się prawdziwym klientem `node:http`, i naprawdę niszczy
   * połączenie w trakcie oczekiwania na (zaślepiony) model — dokładnie tak,
   * jak zrobił to recenzent.
   */
  it('sygnał przekazany do modelu przerywa się przy realnym zerwaniu połączenia — i nie wcześniej, gdy klient wciąż czeka', async () => {
    const slug = await createProject('Test projekt')
    await enableProvider()

    let capturedSignal: AbortSignal | undefined
    let resolveFetchCalled: () => void
    const fetchCalled = new Promise<void>(resolve => { resolveFetchCalled = resolve })
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      capturedSignal = init.signal ?? undefined
      resolveFetchCalled()
      // Nigdy się nie kończy — symuluje model, który jeszcze odpowiada, gdy
      // klient zdąży zerwać połączenie.
      return new Promise<Response>(() => {})
    }))

    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address()
    if (address === null || typeof address === 'string') throw new Error('serwer testowy bez adresu')

    const body = JSON.stringify(runBody({ projectSlug: slug }))
    const req = httpRequest({
      host: '127.0.0.1',
      port: address.port,
      path: '/api/llm/run',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    })
    // Bez odbiorcy błędu `destroy()` niżej zgłosiłby niesłuchane zdarzenie
    // `error` (ECONNRESET) i wywalił test procesem — to oczekiwany efekt
    // uboczny zrywania własnego żądania, nie usterka.
    req.on('error', () => {})
    req.write(body)
    req.end()

    await fetchCalled

    // Klient wciąż połączony, czeka na odpowiedź modelu — sygnał ma być cały.
    expect(capturedSignal?.aborted).toBe(false)

    req.destroy()

    // `close` na surowym żądaniu serwera i przejście przez onRequestAbort nie
    // są synchroniczne z `destroy()` klienta — odczekujemy, aż się rozejdą.
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(capturedSignal?.aborted).toBe(true)
  }, 10000)
})

/**
 * Runda 1 fixów recenzji zadania 8: `POST /api/llm/run` odpowiada dwoma
 * różnymi kształtami — `{ patch }` dla trzech zadań, `{ notes }` dla krytyka
 * — i to jest jedyne miejsce, w którym ta różnica naprawdę dociera do
 * klienta (panel walidacji rozdzieli uwagi od reguł na podstawie właśnie
 * tego kształtu). Dotąd testowała to na tym poziomie tylko gałąź
 * `structure` (patrz „ścieżka szczęśliwa" wyżej) — reszta trzech gałęzi
 * `switch` w `routes/llm.ts` była sprawdzona tylko przez lekturę.
 */
describe('POST /api/llm/run — kształt odpowiedzi zależny od zadania', () => {
  it('structure: odpowiedź niesie "patch" (z tablicą "ops"), nie niesie "notes"', async () => {
    const slug = await createProject('Test structure ksztalt')
    await enableProvider()
    mockFetch(() => chatResponse(validStructureJson))
    const res = await app.inject({ method: 'POST', url: '/api/llm/run', payload: structureBody(slug) })
    expect(res.statusCode).toBe(200)
    const body = doneData(res.payload)
    expect(Array.isArray((body.patch as { ops: unknown[] }).ops)).toBe(true)
    expect(body.notes).toBeUndefined()
  })

  it('redact: odpowiedź niesie "patch" (z tablicą "ops"), nie niesie "notes"', async () => {
    const slug = await createProject('Test redact ksztalt')
    await enableProvider()
    mockFetch(() => chatResponse(validRedactJson))
    const res = await app.inject({ method: 'POST', url: '/api/llm/run', payload: redactBody(slug) })
    expect(res.statusCode).toBe(200)
    const body = doneData(res.payload)
    expect(Array.isArray((body.patch as { ops: unknown[] }).ops)).toBe(true)
    expect(body.notes).toBeUndefined()
  })

  it('audio: odpowiedź niesie "patch" (z tablicą "ops"), nie niesie "notes"', async () => {
    const slug = await createProject('Test audio ksztalt')
    await enableProvider()
    mockFetch(() => chatResponse(validAudioJson))
    const res = await app.inject({ method: 'POST', url: '/api/llm/run', payload: audioBody(slug) })
    expect(res.statusCode).toBe(200)
    const body = doneData(res.payload)
    const patch = body.patch as { ops: unknown[] }
    expect(Array.isArray(patch.ops)).toBe(true)
    expect(patch.ops).toHaveLength(2)
    expect(body.notes).toBeUndefined()
  })

  it('critic: odpowiedź niesie "notes" (tablicę uwag), nie niesie "patch"', async () => {
    const slug = await createProject('Test critic ksztalt')
    await enableProvider()
    mockFetch(() => chatResponse(validCriticJson(slug)))
    const res = await app.inject({ method: 'POST', url: '/api/llm/run', payload: criticBody(slug) })
    expect(res.statusCode).toBe(200)
    const body = doneData(res.payload)
    const notes = body.notes as Array<{ ref: unknown }>
    expect(Array.isArray(notes)).toBe(true)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.ref).toEqual({ kind: 'project', id: slug })
    expect(body.patch).toBeUndefined()
  })
})
