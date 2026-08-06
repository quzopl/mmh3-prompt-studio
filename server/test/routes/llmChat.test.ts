import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { readChats } from '../../src/llm/chatStore.js'

/**
 * Wariant `fieldChat` trasy `POST /api/llm/run` (zadanie 4). Pomocniki są tym
 * samym zestawem, którego używa `routes/llm.test.ts` dla pozostałych pięciu
 * zadań — kształt odpowiedzi SSE, włączenie dostawcy i rozcinanie zdarzeń.
 *
 * Sprawdzamy tu to, czego nie widać ani z testu samego zadania, ani z testu
 * magazynu: że historia naprawdę dojeżdża do modelu, że tura zapisuje się
 * DOPIERO po sukcesie i że proza jedzie obok łatki, a nie zamiast niej.
 */

let root: string
let app: FastifyInstance

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-chatroute-'))
  app = await buildApp({ dataRoot: root })
})

afterEach(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const createProject = async (name: string): Promise<string> => {
  const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name, mode: 'T2VA' } })
  return res.json().slug as string
}

const enableProvider = async (): Promise<void> => {
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

const chatResponse = (content: string): Response => new Response([
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
  `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 22 } })}`,
  'data: [DONE]',
].join('\n\n') + '\n\n')

const doneData = (payload: string): Record<string, unknown> => {
  const block = payload.split('\n\n').find(part => part.startsWith('event: done'))
  if (block === undefined) throw new Error(`brak zdarzenia "done" w odpowiedzi: ${payload}`)
  const line = block.split('\n').find(l => l.startsWith('data:')) ?? ''
  return JSON.parse(line.slice('data:'.length).trim()) as Record<string, unknown>
}

const chatJson = JSON.stringify({
  reply: 'Dodałem deszcz.',
  english: 'Live-action, rain on cold asphalt',
})

const chatBody = (slug: string, message = 'dodaj deszcz') => ({
  task: 'fieldChat',
  projectSlug: slug,
  target: { kind: 'style' },
  message,
})

describe('POST /api/llm/run — fieldChat', () => {
  it('udana tura zapisuje pytanie i odpowiedź do chats.json', async () => {
    const slug = await createProject('Projekt')
    await enableProvider()
    vi.stubGlobal('fetch', vi.fn(async () => chatResponse(chatJson)))

    const res = await app.inject({ method: 'POST', url: '/api/llm/run', payload: chatBody(slug) })
    expect(res.statusCode).toBe(200)

    const threads = await readChats(root, slug)
    expect(threads).toHaveLength(1)
    expect(threads[0]?.key).toBe('style')
    expect(threads[0]?.messages.map(m => m.role)).toEqual(['user', 'assistant'])
    expect(threads[0]?.messages[0]?.text).toBe('dodaj deszcz')
    expect(threads[0]?.messages[1]?.text).toBe('Dodałem deszcz.')
    expect(threads[0]?.messages[1]?.english).toBe('Live-action, rain on cold asphalt')
  })

  it('wynik niesie prozę OBOK łatki, nie zamiast niej', async () => {
    const slug = await createProject('Projekt')
    await enableProvider()
    vi.stubGlobal('fetch', vi.fn(async () => chatResponse(chatJson)))

    const res = await app.inject({ method: 'POST', url: '/api/llm/run', payload: chatBody(slug) })
    const done = doneData(res.payload)
    expect(done.reply).toBe('Dodałem deszcz.')
    expect((done.patch as { ops: unknown[] }).ops).toHaveLength(1)
  })

  it('błąd modelu nie zapisuje niczego — nie ma czego zapisać', async () => {
    const slug = await createProject('Projekt')
    await enableProvider()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nie działa', { status: 500 })))

    await app.inject({ method: 'POST', url: '/api/llm/run', payload: chatBody(slug) })
    expect(await readChats(root, slug)).toEqual([])
  })

  it('druga tura widzi pierwszą — historia naprawdę jedzie do modelu', async () => {
    const slug = await createProject('Projekt')
    await enableProvider()
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      sent.push(typeof init?.body === 'string' ? init.body : '')
      return chatResponse(chatJson)
    }))

    await app.inject({ method: 'POST', url: '/api/llm/run', payload: chatBody(slug, 'dodaj deszcz') })
    await app.inject({ method: 'POST', url: '/api/llm/run', payload: chatBody(slug, 'mocniej') })

    expect(sent).toHaveLength(2)
    // Pierwsze zapytanie nie może znać drugiego polecenia — inaczej test
    // mierzyłby cokolwiek innego niż narastanie historii.
    expect(sent[0]).not.toContain('mocniej')
    expect(sent[1]).toContain('dodaj deszcz')
    expect(sent[1]).toContain('Dodałem deszcz.')
    expect(sent[1]).toContain('mocniej')
  })

  it('historia jedzie jako tury z rolą assistant, nie zlepiona w jedną wiadomość', async () => {
    const slug = await createProject('Projekt')
    await enableProvider()
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      sent.push(typeof init?.body === 'string' ? init.body : '')
      return chatResponse(chatJson)
    }))

    await app.inject({ method: 'POST', url: '/api/llm/run', payload: chatBody(slug, 'dodaj deszcz') })
    await app.inject({ method: 'POST', url: '/api/llm/run', payload: chatBody(slug, 'mocniej') })

    const second = JSON.parse(sent[1] ?? '{}') as { messages: Array<{ role: string }> }
    expect(second.messages.map(m => m.role)).toEqual(['system', 'user', 'user', 'assistant', 'user'])
  })

  it('puste pole nie blokuje rozmowy — inaczej niż redakcja', async () => {
    // Świeży projekt ma pusty `style`. Redakcja odrzuca to kodem 400, bo nie ma
    // czego tłumaczyć; rozmowa o pustym polu to normalny pierwszy ruch.
    const slug = await createProject('Projekt')
    await enableProvider()
    vi.stubGlobal('fetch', vi.fn(async () => chatResponse(chatJson)))

    const chat = await app.inject({ method: 'POST', url: '/api/llm/run', payload: chatBody(slug) })
    expect(chat.statusCode).toBe(200)

    const redact = await app.inject({
      method: 'POST',
      url: '/api/llm/run',
      payload: { task: 'redact', projectSlug: slug, target: { kind: 'style' } },
    })
    expect(redact.statusCode).toBe(400)
  })

  it('pusta wiadomość jest odrzucona przez schemat żądania', async () => {
    const slug = await createProject('Projekt')
    await enableProvider()
    const res = await app.inject({ method: 'POST', url: '/api/llm/run', payload: chatBody(slug, '') })
    expect(res.statusCode).toBe(400)
  })

  it('nieistniejący projekt zwraca 404, zanim cokolwiek pójdzie do modelu', async () => {
    await enableProvider()
    const res = await app.inject({
      method: 'POST', url: '/api/llm/run', payload: chatBody('nie-ma-takiego'),
    })
    expect(res.statusCode).toBe(404)
  })
})
