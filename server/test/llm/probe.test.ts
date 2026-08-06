import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { hostUrl, probeJson, probeOk } from '../../src/llm/probe.js'

/**
 * Sondowanie dostawców. Testy stawiają PRAWDZIWY serwer HTTP na losowym porcie
 * pętli lokalnej — nie podstawiają `fetch` — bo sprawdzana jest droga sieciowa
 * wraz z limitem czasu i obsługą kodów spoza dwusetki, a nie to, czy atrapa
 * została zawołana.
 */

let server: Server | null = null

const listen = async (handler: (path: string) => { status: number; body?: string }): Promise<string> => {
  const created = createServer((req, res) => {
    const { status, body } = handler(req.url ?? '')
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(body ?? '{}')
  })
  server = created
  await new Promise<void>(resolve => created.listen(0, '127.0.0.1', resolve))
  const address = created.address()
  if (address === null || typeof address === 'string') throw new Error('brak portu')
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  const running = server
  server = null
  if (running !== null) await new Promise(resolve => running.close(resolve))
})

describe('hostUrl', () => {
  it('zastępuje ścieżkę, zapytanie i fragment, zostawiając host', () => {
    expect(hostUrl('http://localhost:1234/v1?a=1#b', '/api/tags'))
      .toBe('http://localhost:1234/api/tags')
  })
})

describe('probeOk', () => {
  it('odpowiedź 200 to true', async () => {
    const base = await listen(() => ({ status: 200 }))
    expect(await probeOk(base, '/api/tags')).toBe(true)
  })

  it('odpowiedź 404 to false, nie wyjątek', async () => {
    const base = await listen(() => ({ status: 404 }))
    expect(await probeOk(base, '/api/tags')).toBe(false)
  })

  it('port, na którym nic nie stoi, to false, nie wyjątek', async () => {
    expect(await probeOk('http://127.0.0.1:1', '/api/tags')).toBe(false)
  })

  it('adres, którego nie da się sparsować, to false', async () => {
    expect(await probeOk('to nie jest adres', '/api/tags')).toBe(false)
  })
})

describe('probeJson', () => {
  it('zwraca sparsowane ciało przy 200', async () => {
    const base = await listen(() => ({ status: 200, body: JSON.stringify({ models: [{ name: 'qwen' }] }) }))
    expect(await probeJson(base, '/api/tags')).toEqual({ models: [{ name: 'qwen' }] })
  })

  it('kod spoza dwusetki to null', async () => {
    const base = await listen(() => ({ status: 500 }))
    expect(await probeJson(base, '/api/tags')).toBeNull()
  })

  it('ciało, które nie jest JSON-em, to null — nie wyjątek parsowania', async () => {
    const base = await listen(() => ({ status: 200, body: '{ to nie jest json' }))
    expect(await probeJson(base, '/api/tags')).toBeNull()
  })
})
