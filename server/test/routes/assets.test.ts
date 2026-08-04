import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'

let root: string
let app: FastifyInstance

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const multipart = (fileName: string, mime: string, data: Buffer) => {
  const boundary = '----mmh3test'
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: ${mime}\r\n\r\n`,
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return {
    payload: Buffer.concat([head, data, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-assets-'))
  app = await buildApp({ dataRoot: root })
  await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Assety', mode: 'REF' } })
})

afterEach(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true })
})

describe('POST /api/projects/:slug/assets', () => {
  it('wgrywa obraz i dopisuje go do projektu', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects/assety/assets',
      ...multipart('kadr.png', 'image/png', PNG_1X1),
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().asset.kind).toBe('image')
    expect(res.json().project.assets).toHaveLength(1)
  })

  it('odrzuca niedozwolony typ pliku', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects/assety/assets',
      ...multipart('z.pdf', 'application/pdf', Buffer.from('x')),
    })
    expect(res.statusCode).toBe(400)
  })

  it('zwraca 404 dla nieznanego projektu', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects/nie-ma/assets',
      ...multipart('kadr.png', 'image/png', PNG_1X1),
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /api/projects/:slug/assets/:assetId/raw', () => {
  it('oddaje zapisane bajty', async () => {
    const upload = await app.inject({
      method: 'POST', url: '/api/projects/assety/assets',
      ...multipart('kadr.png', 'image/png', PNG_1X1),
    })
    const id = upload.json().asset.id
    const res = await app.inject({ method: 'GET', url: `/api/projects/assety/assets/${id}/raw` })
    expect(res.statusCode).toBe(200)
    expect(res.rawPayload.equals(PNG_1X1)).toBe(true)
  })

  it('zwraca 404 dla nieznanego assetu', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/assety/assets/asset-x/raw' })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /api/projects/:slug/assets/:assetId', () => {
  it('usuwa asset z projektu i z dysku', async () => {
    const upload = await app.inject({
      method: 'POST', url: '/api/projects/assety/assets',
      ...multipart('kadr.png', 'image/png', PNG_1X1),
    })
    const id = upload.json().asset.id
    const res = await app.inject({ method: 'DELETE', url: `/api/projects/assety/assets/${id}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().project.assets).toEqual([])
  })
})
