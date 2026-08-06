import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { discoverProviders } from '../../src/llm/discover.js'

/**
 * Wykrywanie serwerów modeli. Atrapy to prawdziwe serwery HTTP na losowych
 * portach — dzięki temu test nie walczy o porty 11434/1234/8080 z tym, co
 * akurat stoi na maszynie, i nie zależy od kolejności uruchamiania testów.
 */

const servers: Server[] = []

/** Serwer odpowiadający 200 tylko na wskazane ścieżki, 404 na wszystkie inne. */
const listenOn = async (routes: Record<string, unknown>): Promise<number> => {
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? ''
    const body = routes[path]
    if (body === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{}')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('brak portu')
  return address.port
}

afterEach(async () => {
  await Promise.all(servers.map(s => new Promise(resolve => s.close(resolve))))
  servers.length = 0
})

describe('discoverProviders', () => {
  it('rozpoznaje Ollamę po /api/tags i czyta nazwy modeli', async () => {
    const port = await listenOn({ '/api/tags': { models: [{ name: 'qwen2.5:14b' }, { name: 'llama3' }] } })
    const found = await discoverProviders([port])
    expect(found).toHaveLength(1)
    expect(found[0]?.kind).toBe('ollama')
    expect(found[0]?.models).toEqual(['qwen2.5:14b', 'llama3'])
    expect(found[0]?.baseUrl).toBe(`http://127.0.0.1:${port}`)
  })

  it('rozpoznaje LM Studio po /api/v0/models', async () => {
    const port = await listenOn({ '/api/v0/models': { data: [{ id: 'qwen2.5-7b-instruct' }] } })
    const found = await discoverProviders([port])
    expect(found[0]?.kind).toBe('lmstudio')
    expect(found[0]?.models).toEqual(['qwen2.5-7b-instruct'])
  })

  it('serwer odpowiadający WYŁĄCZNIE na /v1/models to „openai", nie Ollama', async () => {
    const port = await listenOn({ '/v1/models': { data: [{ id: 'local-model' }] } })
    const found = await discoverProviders([port])
    expect(found[0]?.kind).toBe('openai')
    expect(found[0]?.models).toEqual(['local-model'])
  })

  it('serwer odpowiadający i na /api/tags, i na /v1/models to OLLAMA — kolejność sond ma znaczenie', async () => {
    // Ollama i LM Studio udają też API OpenAI. Gdyby sonda ogólna szła pierwsza,
    // każdy dostawca nazywałby się „openai" i użytkownik straciłby informację,
    // od której zależy zwalnianie pamięci karty (`unload.ts`).
    const port = await listenOn({
      '/api/tags': { models: [{ name: 'qwen' }] },
      '/v1/models': { data: [{ id: 'qwen' }] },
    })
    const found = await discoverProviders([port])
    expect(found).toHaveLength(1)
    expect(found[0]?.kind).toBe('ollama')
  })

  it('port, na którym nic nie stoi, nie trafia do wyniku', async () => {
    expect(await discoverProviders([1])).toEqual([])
  })

  it('skanuje wszystkie podane porty i zwraca każdy znaleziony', async () => {
    const a = await listenOn({ '/api/tags': { models: [{ name: 'x' }] } })
    const b = await listenOn({ '/api/v0/models': { data: [{ id: 'y' }] } })
    const found = await discoverProviders([a, b, 1])
    expect(found.map(f => f.kind).sort()).toEqual(['lmstudio', 'ollama'])
  })

  it('dostawca bez czytelnej listy modeli i tak jest zgłoszony, z pustą listą', async () => {
    const port = await listenOn({ '/api/tags': { cokolwiek: true } })
    const found = await discoverProviders([port])
    expect(found[0]?.kind).toBe('ollama')
    expect(found[0]?.models).toEqual([])
  })

  it('serwer, który NIE jest dostawcą modeli, jest pomijany', async () => {
    // ComfyUI stoi na 8188 i odpowiada na własne ścieżki — żadna z trzech sond
    // nie ma prawa uznać go za serwer modeli.
    const port = await listenOn({ '/system_stats': { comfy: true }, '/prompt': {} })
    expect(await discoverProviders([port])).toEqual([])
  })
})
