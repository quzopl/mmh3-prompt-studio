import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectUnloadCapability, unloadModel } from '../../src/llm/unload.js'
import { startManaged, stopManaged, managedState } from '../../src/llm/managed.js'

// `vi.restoreAllMocks()` samo nie cofa `vi.stubGlobal` — bez `unstubAllGlobals`
// ostatni podmieniony `fetch` przeciekłby do testu trybu zarządzanego niżej,
// który potrzebuje PRAWDZIWEGO żądania sieciowego do fikcyjnego serwera na
// `127.0.0.1` (sondowanie zdrowia w `startManaged`).
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const endpointSettings = (baseUrl: string) => ({
  mode: 'endpoint' as const,
  endpoint: { baseUrl, apiKey: '', model: 'qwen' },
  managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 8192 },
})

describe('wykrywanie sposobu zwolnienia pamięci', () => {
  it('tryb zarządzany zwalnia przez zatrzymanie procesu', async () => {
    const settings = { ...endpointSettings(''), mode: 'managed' as const }
    expect(await detectUnloadCapability(settings)).toBe('managed')
  })

  it('endpoint odpowiadający na /api/tags to Ollama', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('/api/tags') ? new Response('{"models":[]}') : new Response('', { status: 404 })))
    expect(await detectUnloadCapability(endpointSettings('http://localhost:11434/v1'))).toBe('ollama')
  })

  it('endpoint odpowiadający na /api/v0/models to LM Studio', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('/api/v0/models') ? new Response('{"data":[]}') : new Response('', { status: 404 })))
    expect(await detectUnloadCapability(endpointSettings('http://localhost:1234/v1'))).toBe('lmstudio')
  })

  it('endpoint, który nie odpowiada na żadne z nich, nie umie zwolnić pamięci', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    expect(await detectUnloadCapability(endpointSettings('http://localhost:8000/v1'))).toBe('none')
  })

  it('tryb wyłączony nie ma czego zwalniać', async () => {
    expect(await detectUnloadCapability({ ...endpointSettings(''), mode: 'off' })).toBe('none')
  })

  it('nieodpowiadający serwer nie wywraca wykrywania', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    expect(await detectUnloadCapability(endpointSettings('http://localhost:9/v1'))).toBe('none')
  })
})

describe('sondy budują adres z korzenia hosta baseUrl, nie z jego prefiksu (fix round 1/5)', () => {
  // Recenzent: `hostUrl` czyści `search` i `hash` przed sondowaniem, ale bez
  // tych dwóch testów usunięcie tych dwóch linii zostawiało wszystkie
  // pozostałe testy zielone — żaden istniejący `baseUrl` nie niósł parametru
  // zapytania ani prefiksu ścieżki. Oba testy porównują adres DOKŁADNIE
  // (`===`), nie samym `includes` — sonda z doklejonym `?foo=bar` albo
  // prefiksem `/proxy` nie trafiłaby w ten warunek i dostała 404, co
  // faktycznie zmienia wynik wykrywania (nie tylko treść asercji).
  it('baseUrl z parametrem zapytania nie dokleja go do adresu sondy', async () => {
    const seenUrls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seenUrls.push(url)
      return url === 'http://localhost:11434/api/tags' ? new Response('{"models":[]}') : new Response('', { status: 404 })
    }))
    expect(await detectUnloadCapability(endpointSettings('http://localhost:11434/v1?foo=bar'))).toBe('ollama')
    expect(seenUrls).toContain('http://localhost:11434/api/tags')
    expect(seenUrls.some(url => url.includes('foo=bar'))).toBe(false)
  })

  it('baseUrl z prefiksem ścieżki sonduje korzeń hosta, nie prefiks', async () => {
    const seenUrls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seenUrls.push(url)
      return url === 'http://localhost:11434/api/tags' ? new Response('{"models":[]}') : new Response('', { status: 404 })
    }))
    expect(await detectUnloadCapability(endpointSettings('http://localhost:11434/proxy/v1'))).toBe('ollama')
    expect(seenUrls).toContain('http://localhost:11434/api/tags')
    expect(seenUrls.some(url => url.includes('/proxy'))).toBe(false)
  })
})

describe('zwalnianie pamięci', () => {
  it('Ollama dostaje keep_alive równe zero', async () => {
    let body: unknown = null
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/api/tags')) return new Response('{"models":[]}')
      body = JSON.parse(String(init.body))
      return new Response('{}')
    }))
    const result = await unloadModel(endpointSettings('http://localhost:11434/v1'))
    expect(result.freed).toBe(true)
    expect((body as { keep_alive?: number }).keep_alive).toBe(0)
  })

  it('dostawca bez możliwości zwolnienia zwraca freed równe fałsz, a nie rzuca', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    const result = await unloadModel(endpointSettings('http://localhost:8000/v1'))
    expect(result.freed).toBe(false)
    expect(result.how).toBe('none')
  })

  it('błąd po stronie dostawcy daje freed równe fałsz z powodem, nie wyjątek', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('/api/tags') ? new Response('{"models":[]}') : new Response('padło', { status: 500 })))
    await expect(unloadModel(endpointSettings('http://localhost:11434/v1'))).resolves.toMatchObject({ freed: false })
  })
})

describe('zwalnianie pamięci z podaną, już znaną możliwością (fix round 1/5, punkt 3)', () => {
  // Panel zna możliwość z wcześniejszego `GET /unload/capability` — podanie
  // jej wprost ma OSZCZĘDZIĆ powtórne sondowanie (do dwóch sekund) tuż przed
  // samym zwolnieniem. Dowód: sondy (`/api/tags`, `/api/v0/models`) wcale nie
  // odpowiadają w tym mocku — gdyby `unloadModel` mimo to wykrywało od nowa,
  // wynik byłby `none`, nie `ollama`, a `/api/generate` nigdy by nie padło.
  it('podana możliwość pomija ponowne wykrywanie — sondy w ogóle nie są wołane', async () => {
    const calledPaths: string[] = []
    let body: unknown = null
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calledPaths.push(url)
      if (url.includes('/api/tags') || url.includes('/api/v0/models')) return new Response('', { status: 404 })
      body = JSON.parse(String(init.body))
      return new Response('{}')
    }))
    const result = await unloadModel(endpointSettings('http://localhost:11434/v1'), 'ollama')

    expect(result).toEqual({ freed: true, how: 'ollama' })
    expect((body as { keep_alive?: number }).keep_alive).toBe(0)
    expect(calledPaths.some(url => url.includes('/api/tags'))).toBe(false)
    expect(calledPaths.some(url => url.includes('/api/v0/models'))).toBe(false)
  })

  it('bez podanej możliwości wykrywanie zostaje domyślnym zachowaniem (bez regresji istniejącej ścieżki)', async () => {
    let body: unknown = null
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/api/tags')) return new Response('{"models":[]}')
      body = JSON.parse(String(init.body))
      return new Response('{}')
    }))
    const result = await unloadModel(endpointSettings('http://localhost:11434/v1'))
    expect(result).toEqual({ freed: true, how: 'ollama' })
    expect((body as { keep_alive?: number }).keep_alive).toBe(0)
  })
})

describe('zwalnianie pamięci — tryb zarządzany (proces zastępczy jak w managed.test.ts)', () => {
  // Fikcyjny serwer HTTP, uruchamiany zamiast prawdziwego `llama-server` —
  // odpowiada na `/v1/models`, więc `startManaged` uzna go za gotowy, tak
  // samo jak `fakeServerSource` w `server/test/llm/managed.test.ts`.
  const fakeServerSource = `#!/usr/bin/env node
import { createServer } from 'node:http'
const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1])
createServer((req, res) => {
  if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); return }
  res.writeHead(404); res.end()
}).listen(port, '127.0.0.1')
`

  let root = ''
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mmh3-unload-managed-'))
  })
  afterEach(async () => {
    await stopManaged()
    await rm(root, { recursive: true, force: true })
  })

  it('zwolnienie w trybie zarządzanym zatrzymuje serwer — managedState() wraca do stopped', async () => {
    const serverBinary = join(root, 'fake-server.mjs')
    await writeFile(serverBinary, fakeServerSource)
    await chmod(serverBinary, 0o755)
    const modelPath = join(root, 'model.gguf')
    await writeFile(modelPath, 'x')

    const managed = { serverBinary, modelPath, gpuLayers: 0, contextSize: 8192 }
    const started = await startManaged(managed)
    expect(started.status).toBe('ready')

    const settings = {
      mode: 'managed' as const,
      endpoint: { baseUrl: '', apiKey: '', model: '' },
      managed,
    }
    const result = await unloadModel(settings)

    expect(result).toEqual({ freed: true, how: 'managed' })
    expect(managedState().status).toBe('stopped')
  })
})
