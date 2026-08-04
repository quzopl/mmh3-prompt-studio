import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'

let root: string
let app: FastifyInstance

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-export-'))
  app = await buildApp({ dataRoot: root })
  const created = await app.inject({
    method: 'POST', url: '/api/projects', payload: { name: 'Eksport', mode: 'T2VA' },
  })
  const project = { ...created.json().project, style: 'Live-action, cinematic' }
  await app.inject({ method: 'PUT', url: '/api/projects/eksport', payload: { project } })
})

afterEach(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true })
})

describe('GET /api/projects/:slug/export/prompt', () => {
  it('oddaje prompt jako zwykły tekst', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/eksport/export/prompt' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.body).toContain('integrated_multimodal_description:')
  })

  it('zwraca 404 dla nieznanego projektu', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/projects/nie-ma/export/prompt' }))
      .statusCode).toBe(404)
  })

  it('odrzuca slug próbujący wyjść poza katalog danych', async () => {
    for (const slug of ['..', '../..', 'a/../..']) {
      const res = await app.inject({ method: 'GET', url: `/api/projects/${slug}/export/prompt` })
      expect(res.statusCode, slug).toBeGreaterThanOrEqual(400)
      expect(res.statusCode, slug).toBeLessThan(500)
    }
  })
})

describe('GET /api/projects/:slug/export/project', () => {
  it('oddaje projekt jako JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/eksport/export/project' })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('Eksport')
  })

  it('zwraca 404 dla nieznanego projektu', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/projects/nie-ma/export/project' }))
      .statusCode).toBe(404)
  })

  it('odrzuca slug próbujący wyjść poza katalog danych', async () => {
    for (const slug of ['..', '../..', 'a/../..']) {
      const res = await app.inject({ method: 'GET', url: `/api/projects/${slug}/export/project` })
      expect(res.statusCode, slug).toBeGreaterThanOrEqual(400)
      expect(res.statusCode, slug).toBeLessThan(500)
    }
  })
})

describe('POST /api/projects/:slug/export/comfy', () => {
  const workflow = { '3': { class_type: 'CLIPTextEncode', inputs: { text: 'stary' } } }

  it('zwraca workflow z wstawionym promptem', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects/eksport/export/comfy',
      payload: { workflow, nodeId: '3', field: 'text' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()['3'].inputs.text).toContain('integrated_multimodal_description:')
  })

  it('zwraca 400 z czytelnym komunikatem dla złego węzła', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects/eksport/export/comfy',
      payload: { workflow, nodeId: '99', field: 'text' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/99/)
  })

  it('odrzuca slug próbujący wyjść poza katalog danych', async () => {
    for (const slug of ['..', '../..', 'a/../..']) {
      const res = await app.inject({
        method: 'POST', url: `/api/projects/${slug}/export/comfy`,
        payload: { workflow, nodeId: '3', field: 'text' },
      })
      expect(res.statusCode, slug).toBeGreaterThanOrEqual(400)
      expect(res.statusCode, slug).toBeLessThan(500)
    }
  })
})
