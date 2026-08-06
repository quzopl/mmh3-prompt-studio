import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { readSettings } from '../../src/llm/settings.js'

let root: string
let app: FastifyInstance

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-install-route-'))
  app = await buildApp({ dataRoot: root, runtimeRoot: join(root, 'runtime') })
})

afterEach(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('POST /api/llm/install', () => {
  it('nieznany model odrzucany jest kodem 400, zanim cokolwiek się pobierze', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/llm/install', payload: { modelId: 'nie-ma-takiego' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('ciało bez modelId to 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/llm/install', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('nieudana instalacja NIE zapisuje ustawień', async () => {
    // Sieć niedostępna — pobranie silnika pada, a ustawienia mają zostać
    // nietknięte. Zapis przed weryfikacją zostawiłby konfigurację wskazującą
    // na pliki, których nie ma.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('brak sieci') }))
    const before = await readSettings(root)

    const res = await app.inject({
      method: 'POST', url: '/api/llm/install', payload: { modelId: 'qwen2.5-14b-q4km' },
    })

    expect(res.payload).toContain('event: error')
    expect(await readSettings(root)).toEqual(before)
  })
})

describe('GET /api/llm/catalog', () => {
  it('zwraca trzy modele i wskazanie silnika dla tej platformy', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/llm/catalog' })
    expect(res.statusCode).toBe(200)
    expect(res.json().models).toHaveLength(3)
    expect(res.json()).toHaveProperty('engine')
  })

  it('katalog nie pyta sieci — odpowiada także bez internetu', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('brak sieci') }))
    const res = await app.inject({ method: 'GET', url: '/api/llm/catalog' })
    expect(res.statusCode).toBe(200)
    expect(res.json().models).toHaveLength(3)
  })
})

describe('GET /api/llm/discover', () => {
  it('odpowiada listą, także pustą, bez błędu', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/llm/discover' })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json().found)).toBe(true)
  })
})
