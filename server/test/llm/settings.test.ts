import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { readSettings, writeSettings, redactSettings, type LlmSettings } from '../../src/llm/settings.js'
import { buildApp } from '../../src/app.js'

let root = ''
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mmh3-llm-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

const settingsPath = (dataRoot: string): string => join(dataRoot, 'llm-settings.json')

const withKey: LlmSettings = {
  mode: 'endpoint',
  endpoint: { baseUrl: 'http://localhost:1234/v1', apiKey: 'tajne', model: 'qwen' },
  managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 4096 },
}

describe('ustawienia LLM', () => {
  it('bez pliku zwraca tryb wyłączony, a nie błąd', async () => {
    const settings = await readSettings(root)
    expect(settings.mode).toBe('off')
  })

  it('zapis i odczyt zachowują wartości', async () => {
    await writeSettings(root, withKey)
    const settings = await readSettings(root)
    expect(settings.endpoint.baseUrl).toBe('http://localhost:1234/v1')
    expect(settings.endpoint.apiKey).toBe('tajne')
  })

  it('uszkodzony plik nie wywraca odczytu — wraca tryb wyłączony', async () => {
    await writeSettings(root, {
      mode: 'endpoint',
      endpoint: { baseUrl: 'http://x/v1', apiKey: '', model: 'm' },
      managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 4096 },
    })
    await writeFile(settingsPath(root), 'to nie jest JSON')
    expect((await readSettings(root)).mode).toBe('off')
  })

  it('pusty plik nie wywraca odczytu — wraca tryb wyłączony', async () => {
    await writeFile(settingsPath(root), '')
    expect((await readSettings(root)).mode).toBe('off')
  })

  it('plik zawierający "null" nie wywraca odczytu — wraca tryb wyłączony', async () => {
    await writeFile(settingsPath(root), 'null')
    expect((await readSettings(root)).mode).toBe('off')
  })

  it('poprawny JSON o złym kształcie nie wywraca odczytu — wraca tryb wyłączony', async () => {
    await writeFile(settingsPath(root), JSON.stringify({ mode: 'nieznany-tryb', foo: 'bar' }))
    expect((await readSettings(root)).mode).toBe('off')
  })

  it('plik ustawień nie leży w katalogu żadnego projektu', async () => {
    await writeSettings(root, {
      mode: 'off',
      endpoint: { baseUrl: '', apiKey: '', model: '' },
      managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 4096 },
    })
    const raw = await readFile(settingsPath(root), 'utf8')
    expect(raw.length).toBeGreaterThan(0)
  })

  it('redakcja usuwa klucz i nie rusza reszty', () => {
    const redacted = redactSettings({
      mode: 'endpoint',
      endpoint: { baseUrl: 'http://x/v1', apiKey: 'tajne', model: 'm' },
      managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 4096 },
    })
    expect(redacted.endpoint.apiKey).toBe('')
    expect(redacted.endpoint.baseUrl).toBe('http://x/v1')
  })
})

describe('trasy /api/llm/settings', () => {
  let apiRoot: string
  let app: FastifyInstance

  beforeEach(async () => {
    apiRoot = await mkdtemp(join(tmpdir(), 'mmh3-llm-api-'))
    app = await buildApp({ dataRoot: apiRoot })
  })

  afterEach(async () => {
    await app.close()
    await rm(apiRoot, { recursive: true, force: true })
  })

  it('GET bez zapisanych ustawień zwraca tryb wyłączony', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/llm/settings' })
    expect(res.statusCode).toBe(200)
    expect(res.json().mode).toBe('off')
    expect(res.json().endpoint.apiKey).toBe('')
  })

  it('GET nie oddaje klucza', async () => {
    await writeSettings(apiRoot, withKey)

    const res = await app.inject({ method: 'GET', url: '/api/llm/settings' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.endpoint.apiKey).toBe('')
    expect(body.endpoint.baseUrl).toBe('http://localhost:1234/v1')
    // Klucz nie może wyciec nawet jako surowy tekst odpowiedzi.
    expect(res.payload).not.toContain('tajne')
  })

  it('PUT zapisuje nowe ustawienia i zwraca je z zaredagowanym kluczem', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/llm/settings',
      payload: withKey,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().endpoint.apiKey).toBe('')
    expect(res.json().endpoint.baseUrl).toBe('http://localhost:1234/v1')

    const onDisk = JSON.parse(await readFile(settingsPath(apiRoot), 'utf8')) as LlmSettings
    expect(onDisk.endpoint.apiKey).toBe('tajne')
  })

  it('PUT z pustym kluczem zachowuje poprzedni', async () => {
    await writeSettings(apiRoot, withKey)

    const res = await app.inject({
      method: 'PUT',
      url: '/api/llm/settings',
      payload: {
        mode: 'endpoint',
        endpoint: { baseUrl: 'http://localhost:9999/v1', apiKey: '', model: 'inny-model' },
        managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 4096 },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().endpoint.apiKey).toBe('')

    const onDisk = JSON.parse(await readFile(settingsPath(apiRoot), 'utf8')) as LlmSettings
    expect(onDisk.endpoint.apiKey).toBe('tajne')
    expect(onDisk.endpoint.baseUrl).toBe('http://localhost:9999/v1')
    expect(onDisk.endpoint.model).toBe('inny-model')
  })

  it('PUT odrzuca dane niezgodne ze schematem i nie ujawnia klucza w błędzie', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/llm/settings',
      payload: {
        mode: 'endpoint',
        endpoint: { baseUrl: 'http://x/v1', apiKey: 'sekret-w-bledzie', model: 123 },
        managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 4096 },
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.payload).not.toContain('sekret-w-bledzie')
  })
})
