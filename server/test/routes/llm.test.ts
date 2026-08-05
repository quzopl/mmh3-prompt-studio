import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
})
