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

const chatResponse = (content: string) => new Response(JSON.stringify({
  choices: [{ message: { content } }],
  usage: { prompt_tokens: 11, completion_tokens: 22 },
}))

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

  it('zwraca 502, gdy model odpowiada błędem po obu próbach', async () => {
    const slug = await createProject('Test projekt')
    await enableProvider()
    mockFetch(() => chatResponse('to nie jest poprawny JSON'))
    const res = await app.inject({
      method: 'POST', url: '/api/llm/run',
      payload: runBody({ projectSlug: slug }),
    })
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toBeTypeOf('string')
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
    const body = res.json()
    expect(body.repaired).toBe(false)
    expect(body.promptTokens).toBe(11)
    expect(body.completionTokens).toBe(22)
    expect(body.patch.ops).toHaveLength(1)
    expect(body.patch.ops[0].kind).toBe('replaceShots')
    expect(body.patch.ops[0].shots[0].composition).toBe('a wide shot of an empty platform')
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
    const body = res.json()
    expect(body.repaired).toBe(true)
    expect(body.promptTokens).toBe(22)
    expect(body.completionTokens).toBe(44)
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
    const body = res.json()
    expect(Array.isArray(body.patch.ops)).toBe(true)
    expect(body.notes).toBeUndefined()
  })

  it('redact: odpowiedź niesie "patch" (z tablicą "ops"), nie niesie "notes"', async () => {
    const slug = await createProject('Test redact ksztalt')
    await enableProvider()
    mockFetch(() => chatResponse(validRedactJson))
    const res = await app.inject({ method: 'POST', url: '/api/llm/run', payload: redactBody(slug) })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body.patch.ops)).toBe(true)
    expect(body.notes).toBeUndefined()
  })

  it('audio: odpowiedź niesie "patch" (z tablicą "ops"), nie niesie "notes"', async () => {
    const slug = await createProject('Test audio ksztalt')
    await enableProvider()
    mockFetch(() => chatResponse(validAudioJson))
    const res = await app.inject({ method: 'POST', url: '/api/llm/run', payload: audioBody(slug) })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body.patch.ops)).toBe(true)
    expect(body.patch.ops).toHaveLength(2)
    expect(body.notes).toBeUndefined()
  })

  it('critic: odpowiedź niesie "notes" (tablicę uwag), nie niesie "patch"', async () => {
    const slug = await createProject('Test critic ksztalt')
    await enableProvider()
    mockFetch(() => chatResponse(validCriticJson(slug)))
    const res = await app.inject({ method: 'POST', url: '/api/llm/run', payload: criticBody(slug) })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body.notes)).toBe(true)
    expect(body.notes).toHaveLength(1)
    expect(body.notes[0].ref).toEqual({ kind: 'project', id: slug })
    expect(body.patch).toBeUndefined()
  })
})
