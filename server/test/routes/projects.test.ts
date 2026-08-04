import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'

let root: string
let app: FastifyInstance

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-api-'))
  app = await buildApp({ dataRoot: root })
})

afterEach(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true })
})

const create = (name: string, mode = 'T2VA') =>
  app.inject({ method: 'POST', url: '/api/projects', payload: { name, mode } })

describe('POST /api/projects', () => {
  it('tworzy projekt i zwraca 201', async () => {
    const res = await create('Piekarnia')
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ slug: 'piekarnia' })
    expect(res.json().project.mode).toBe('T2VA')
  })

  it('odrzuca nieznany tryb', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects', payload: { name: 'X', mode: 'X2VA' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('odrzuca pustą nazwę', async () => {
    const res = await create('   ')
    expect(res.statusCode).toBe(400)
  })

  it('odrzuca duplikat nazwy', async () => {
    await create('Duplikat')
    expect((await create('Duplikat')).statusCode).toBe(409)
  })
})

describe('GET /api/projects', () => {
  it('zwraca listę podsumowań', async () => {
    await create('Pierwszy')
    await create('Drugi', 'REF')
    const res = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(res.statusCode).toBe(200)
    expect(res.json().map((p: { slug: string }) => p.slug).sort()).toEqual(['drugi', 'pierwszy'])
  })
})

describe('GET /api/projects/:slug', () => {
  it('zwraca projekt razem z promptem i diagnostyką', async () => {
    await create('Piekarnia')
    const res = await app.inject({ method: 'GET', url: '/api/projects/piekarnia' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.project.name).toBe('Piekarnia')
    expect(body.prompt).toContain('integrated_multimodal_description:')
    expect(Array.isArray(body.diagnostics)).toBe(true)
    expect(Array.isArray(body.tokens)).toBe(true)
  })

  it('nowy pusty projekt zgłasza brak stylu jako błąd', async () => {
    await create('Pusty')
    const res = await app.inject({ method: 'GET', url: '/api/projects/pusty' })
    expect(res.json().diagnostics.map((d: { ruleId: string }) => d.ruleId))
      .toContain('STYLE_REQUIRED')
  })

  it('zwraca 404 dla nieznanego projektu', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/projects/nie-ma' })).statusCode).toBe(404)
  })
})

describe('PUT /api/projects/:slug', () => {
  it('zapisuje zmieniony projekt i zwraca świeży prompt', async () => {
    const created = (await create('Piekarnia')).json()
    const project = { ...created.project, style: 'Live-action, cinematic' }
    const res = await app.inject({
      method: 'PUT', url: '/api/projects/piekarnia', payload: { project },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().prompt).toContain('Live-action, cinematic')

    const reloaded = await app.inject({ method: 'GET', url: '/api/projects/piekarnia' })
    expect(reloaded.json().project.style).toBe('Live-action, cinematic')
  })

  it('odrzuca projekt niezgodny ze schematem', async () => {
    await create('Piekarnia')
    const res = await app.inject({
      method: 'PUT', url: '/api/projects/piekarnia', payload: { project: { schemaVersion: 1 } },
    })
    expect(res.statusCode).toBe(400)
  })

  it('zwraca 404, gdy projekt nie istnieje', async () => {
    const created = (await create('Istnieje')).json()
    const res = await app.inject({
      method: 'PUT', url: '/api/projects/nie-ma', payload: { project: created.project },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /api/projects/:slug', () => {
  it('usuwa projekt', async () => {
    await create('Do usuniecia')
    expect((await app.inject({ method: 'DELETE', url: '/api/projects/do-usuniecia' })).statusCode)
      .toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/projects' })).json()).toEqual([])
  })

  it('zwraca 404 dla nieznanego projektu', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/projects/nie-ma' })).statusCode)
      .toBe(404)
  })
})
