import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir, chmod, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { readSettings, writeSettings, redactSettings, type LlmSettings } from '../../src/llm/settings.js'
import { buildApp } from '../../src/app.js'
import { createProject, listProjects } from '../../src/storage/projectStore.js'

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

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

  it('katalog w miejscu pliku ustawień nie wywraca odczytu — wraca tryb wyłączony', async () => {
    await mkdir(settingsPath(root))
    expect((await readSettings(root)).mode).toBe('off')
  })

  // chmod 000 nic nie daje dla roota — omija uprawnienia plikowe, więc test
  // przeszedłby niezależnie od tego, czy kod obsługuje EACCES. Pomijamy go
  // wtedy w całości, żeby zielony wynik zawsze znaczył, że coś sprawdzono.
  it.skipIf(isRoot)('plik bez prawa odczytu nie wywraca odczytu — wraca tryb wyłączony', async () => {
    await writeSettings(root, withKey)
    await chmod(settingsPath(root), 0o000)
    try {
      expect((await readSettings(root)).mode).toBe('off')
    } finally {
      await chmod(settingsPath(root), 0o600)
    }
  })

  it('plik ustawień leży obok katalogu projektu, nie w jego wnętrzu, i nie trafia na listę projektów', async () => {
    const { slug } = await createProject(root, 'Testowy', 'T2VA')
    await writeSettings(root, withKey)

    // Rodzeństwo katalogu projektu w drzewie katalogów, nie jego zawartość.
    const entries = await readdir(root, { withFileTypes: true })
    const settingsEntry = entries.find(entry => entry.name === 'llm-settings.json')
    expect(settingsEntry?.isFile()).toBe(true)
    const projectEntry = entries.find(entry => entry.name === slug)
    expect(projectEntry?.isDirectory()).toBe(true)

    // Regresja, która zagnieździłaby plik w katalogu projektu, ma się tu wywrócić.
    await expect(readFile(join(root, slug, 'llm-settings.json'), 'utf8')).rejects.toThrow()

    // I nie pojawia się na liście projektów.
    const projects = await listProjects(root)
    expect(projects.map(project => project.slug)).not.toContain('llm-settings.json')
    expect(projects.map(project => project.slug)).toEqual([slug])
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

  it('PUT z null w apiKey czyści klucz', async () => {
    await writeSettings(apiRoot, withKey)

    const res = await app.inject({
      method: 'PUT',
      url: '/api/llm/settings',
      payload: {
        mode: 'endpoint',
        endpoint: { baseUrl: 'http://localhost:1234/v1', apiKey: null, model: 'qwen' },
        managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 4096 },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().endpoint.apiKey).toBe('')

    const onDisk = JSON.parse(await readFile(settingsPath(apiRoot), 'utf8')) as LlmSettings
    expect(onDisk.endpoint.apiKey).toBe('')
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

describe('trasa /api/llm/models', () => {
  let apiRoot: string
  let app: FastifyInstance

  beforeEach(async () => {
    apiRoot = await mkdtemp(join(tmpdir(), 'mmh3-llm-models-'))
    app = await buildApp({ dataRoot: apiRoot })
  })

  afterEach(async () => {
    await app.close()
    vi.restoreAllMocks()
    await rm(apiRoot, { recursive: true, force: true })
  })

  it('bez skonfigurowanego modelu zwraca 409, nie 500 — brak konfiguracji to stan, nie awaria', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/llm/models' })
    expect(res.statusCode).toBe(409)
  })

  it('gdy model skonfigurowany, listuje modele z endpointu', async () => {
    await writeSettings(apiRoot, {
      mode: 'endpoint',
      endpoint: { baseUrl: 'http://model.local/v1', apiKey: '', model: 'qwen' },
      managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 4096 },
    })
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: 'qwen' }] }))))

    const res = await app.inject({ method: 'GET', url: '/api/llm/models' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ models: ['qwen'] })
  })

  it('gdy serwer modelu nie odpowiada poprawnie, zwraca 502 — to błąd modelu, nie naszego serwera', async () => {
    await writeSettings(apiRoot, {
      mode: 'endpoint',
      endpoint: { baseUrl: 'http://model.local/v1', apiKey: '', model: 'qwen' },
      managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 4096 },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('padło', { status: 500 })))

    const res = await app.inject({ method: 'GET', url: '/api/llm/models' })
    expect(res.statusCode).toBe(502)
  })
})
