import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, chmod, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import type { FastifyInstance } from 'fastify'

// Podglądamy prawdziwy `spawn`, żeby móc sprawdzić, JAK go wywołujemy
// (binarka + tablica argumentów, nigdy powłoka), nie tylko co produkuje
// `buildArgs`. Owijamy prawdziwą implementację, więc testy cyklu życia
// (`/usr/bin/true`, `/usr/bin/false`) nadal faktycznie uruchamiają procesy.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn(actual.spawn) }
})
import { spawn } from 'node:child_process'

import {
  buildArgs, validateManaged, startManaged, stopManaged, managedState, pickAvailablePort,
} from '../../src/llm/managed.js'
import { writeSettings } from '../../src/llm/settings.js'
import { buildApp } from '../../src/app.js'

let root = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-managed-'))
  vi.mocked(spawn).mockClear()
})
afterEach(async () => { await stopManaged(); await rm(root, { recursive: true, force: true }) })

const settings = (over: Partial<Parameters<typeof validateManaged>[0]> = {}) => ({
  serverBinary: '/usr/bin/true', modelPath: join(root, 'model.gguf'),
  gpuLayers: 20, contextSize: 8192, ...over,
})

describe('walidacja ustawień zarządzanego serwera', () => {
  it('odmawia, gdy plik modelu nie istnieje', async () => {
    await expect(validateManaged(settings())).rejects.toThrow(/model/i)
  })

  it('odmawia, gdy binarka nie istnieje', async () => {
    await writeFile(settings().modelPath, 'x')
    await expect(validateManaged(settings({ serverBinary: '/nie/ma/takiej' }))).rejects.toThrow(/serwer/i)
  })

  it('przyjmuje istniejące ścieżki', async () => {
    await writeFile(settings().modelPath, 'x')
    await expect(validateManaged(settings())).resolves.toBeUndefined()
  })

  it('odmawia, gdy ścieżka modelu jest katalogiem, nie plikiem', async () => {
    const dir = join(root, 'model-jako-katalog.gguf')
    await mkdir(dir)
    await expect(validateManaged(settings({ modelPath: dir }))).rejects.toThrow(/model/i)
  })

  it('odmawia, gdy binarka jest katalogiem, nie plikiem', async () => {
    await writeFile(settings().modelPath, 'x')
    const dir = join(root, 'binarka-jako-katalog')
    await mkdir(dir)
    await expect(validateManaged(settings({ serverBinary: dir }))).rejects.toThrow(/serwer/i)
  })

  it('odmawia, gdy binarka nie ma prawa wykonywania', async () => {
    await writeFile(settings().modelPath, 'x')
    const bin = join(root, 'bez-prawa-wykonywania')
    await writeFile(bin, '#!/bin/sh\necho x\n')
    await chmod(bin, 0o644)
    await expect(validateManaged(settings({ serverBinary: bin }))).rejects.toThrow(/wykonywania/i)
  })
})

describe('budowa argumentów', () => {
  it('podaje model, warstwy GPU, kontekst i port osobnymi elementami tablicy', () => {
    const args = buildArgs(settings(), 9977)
    expect(args).toContain('--model')
    expect(args[args.indexOf('--model') + 1]).toBe(settings().modelPath)
    expect(args[args.indexOf('--n-gpu-layers') + 1]).toBe('20')
    expect(args[args.indexOf('--ctx-size') + 1]).toBe('8192')
    expect(args[args.indexOf('--port') + 1]).toBe('9977')
  })

  it('ścieżka ze spacją zostaje jednym elementem, nie rozpada się na dwa', () => {
    const args = buildArgs(settings({ modelPath: '/a b/model.gguf' }), 1)
    expect(args).toContain('/a b/model.gguf')
  })

  it('ścieżka z podstępną treścią nie tworzy dodatkowych argumentów', () => {
    const args = buildArgs(settings({ modelPath: '/x; rm -rf /' }), 1)
    expect(args.filter(a => a.includes('rm -rf'))).toHaveLength(1)
  })
})

describe('bezpieczeństwo wywołania spawn', () => {
  // Test na samym `buildArgs` (wyżej) nie wystarcza — sprawdza tylko, co
  // funkcja zwraca, a nie jak wynik trafia do `spawn`. Ktoś mógłby podmienić
  // `spawn(settings.serverBinary, buildArgs(...))` na
  // `spawn([binary, ...args].join(' '), [], { shell: true })` i tamten test
  // zostałby zielony. Ten — nie: sprawdza faktyczne wywołanie `spawn`.
  it('spawn dostaje binarkę jako pierwszy argument, tablicę argumentów jako drugi, i nigdy nie włącza powłoki', async () => {
    await writeFile(settings().modelPath, 'x')
    await startManaged(settings({ serverBinary: '/usr/bin/false' }))

    expect(spawn).toHaveBeenCalledTimes(1)
    const call = vi.mocked(spawn).mock.calls[0]
    if (call === undefined) throw new Error('spawn nie został wywołany')
    const [binary, args, options] = call

    expect(binary).toBe('/usr/bin/false')
    expect(Array.isArray(args)).toBe(true)
    expect(args).toContain('--model')
    expect(args).toContain(settings().modelPath)
    // Regresja do `[binary, ...args].join(' ')` dałaby tu string, nie tablicę
    // zawierającą osobno `--model` i ścieżkę — powyższe dwa `toContain`
    // rozjechałyby się same. Trzeci argument sprawdzamy osobno.
    expect(options === undefined || options.shell !== true).toBe(true)
  })
})

describe('wybór portu', () => {
  it('pomija zajęty port i wybiera inny wolny w zakresie', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const busy = createServer()
    try {
      await new Promise<void>((resolve, reject) => {
        busy.once('error', reject)
        busy.listen(9900, '127.0.0.1', () => resolve())
      })
      const port = await pickAvailablePort()
      expect(port).not.toBe(9900)
      expect(port).toBeGreaterThanOrEqual(9900)
      expect(port).toBeLessThanOrEqual(9999)
    } finally {
      randomSpy.mockRestore()
      await new Promise<void>(resolve => busy.close(() => resolve()))
    }
  })
})

describe('cykl życia', () => {
  it('stan bez uruchomienia to zatrzymany', () => {
    expect(managedState().status).toBe('stopped')
  })

  it('zatrzymanie bez uruchomienia nie rzuca', async () => {
    await expect(stopManaged()).resolves.toBeUndefined()
  })

  it('proces, który natychmiast kończy, daje stan failed i log', async () => {
    await writeFile(join(root, 'model.gguf'), 'x')
    await startManaged(settings({ serverBinary: '/usr/bin/false' }))
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(managedState().status).toBe('failed')
    expect(managedState().logs.length).toBeGreaterThan(0)
  })
})

describe('nachodzące na siebie starty', () => {
  // Fikcyjny serwer: nasłuchuje na wskazanym porcie dopiero po `delayMs` i
  // wtedy zaczyna odpowiadać na `/v1/models` — pozwala kontrolowanie
  // symulować proces, który jeszcze się nie wystartował, bez prawdziwego
  // `llama-server`.
  const fakeServerSource = (delayMs: number): string => `#!/usr/bin/env node
import { createServer } from 'node:http'
const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1])
setTimeout(() => {
  createServer((req, res) => {
    if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); return }
    res.writeHead(404); res.end()
  }).listen(port, '127.0.0.1')
}, ${delayMs})
`

  // Proces, który nigdy nie otwiera portu, dopóki go nie zabijemy — modeluje
  // start, który jeszcze trwa (ładuje model) w momencie, gdy nadchodzi
  // kolejne żądanie startu.
  const neverListensSource = `#!/usr/bin/env node
setInterval(() => {}, 1000)
`

  it('wynik drugiego startu przeżywa spóźnione rozstrzygnięcie pierwszego', async () => {
    const stale = join(root, 'stale-server.mjs')
    const fast = join(root, 'fast-server.mjs')
    await writeFile(stale, neverListensSource)
    await writeFile(fast, fakeServerSource(600))
    await chmod(stale, 0o755)
    await chmod(fast, 0o755)

    const modelA = join(root, 'model-a.gguf')
    const modelB = join(root, 'model-b.gguf')
    await writeFile(modelA, 'x')
    await writeFile(modelB, 'x')

    const first = startManaged(settings({ serverBinary: stale, modelPath: modelA }))
    // Daj pierwszemu startowi chwilę na faktyczne uruchomienie procesu i
    // rozpoczęcie sondowania, zanim nadejdzie drugi start.
    await new Promise(resolve => setTimeout(resolve, 50))
    const second = await startManaged(settings({ serverBinary: fast, modelPath: modelB }))

    expect(second.status).toBe('ready')

    // Pierwsze wywołanie w końcu też się rozstrzygnie (jego proces padł od
    // SIGTERM wysłanego przez `stopManaged` wewnątrz drugiego startu) — nie
    // może przy tym nadpisać stanu należącego już do drugiego.
    await first
    expect(managedState().status).toBe('ready')
    expect(managedState().port).toBe(second.port)
  }, 8000)
})

describe('trasy /api/llm/managed/*', () => {
  let apiRoot = ''
  let app: FastifyInstance

  beforeEach(async () => {
    apiRoot = await mkdtemp(join(tmpdir(), 'mmh3-managed-api-'))
    app = await buildApp({ dataRoot: apiRoot })
  })

  afterEach(async () => {
    await app.close()
    await stopManaged()
    await rm(apiRoot, { recursive: true, force: true })
  })

  it('GET /state przed jakimkolwiek startem zwraca status zatrzymany', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/llm/managed/state' })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('stopped')
  })

  it('POST /stop bez uruchomienia nie zawodzi', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/llm/managed/stop' })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('stopped')
  })

  it('POST /start przy trybie innym niż managed zwraca 409', async () => {
    await writeSettings(apiRoot, {
      mode: 'off',
      endpoint: { baseUrl: '', apiKey: '', model: '' },
      managed: { serverBinary: '/usr/bin/true', modelPath: join(apiRoot, 'model.gguf'), gpuLayers: 0, contextSize: 512 },
    })
    const res = await app.inject({ method: 'POST', url: '/api/llm/managed/start' })
    expect(res.statusCode).toBe(409)
    expect(typeof res.json().error).toBe('string')
  })

  it('POST /start z brakującym plikiem modelu zwraca 400 z polskim komunikatem', async () => {
    await writeSettings(apiRoot, {
      mode: 'managed',
      endpoint: { baseUrl: '', apiKey: '', model: '' },
      managed: {
        serverBinary: '/usr/bin/true', modelPath: join(apiRoot, 'nie-ma-takiego.gguf'),
        gpuLayers: 0, contextSize: 512,
      },
    })
    const res = await app.inject({ method: 'POST', url: '/api/llm/managed/start' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/model/i)
  })
})
