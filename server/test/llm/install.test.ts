import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  downloadWithResume, ensureFreeSpace, extractArchive, findExecutable, verifyEngine,
} from '../../src/llm/install.js'

/**
 * Pobieranie i rozpakowanie. Atrapa to PRAWDZIWY serwer HTTP obsługujący
 * nagłówek `Range` — dokładnie tak, jak robi to HuggingFace — bo sprawdzana
 * jest droga sieciowa wraz ze wznowieniem, a nie to, czy zaślepka została
 * zawołana.
 */

let root: string
let server: Server | null = null
const BODY = Buffer.from('0123456789abcdefghij')

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mmh3-install-')) })

afterEach(async () => {
  const running = server
  server = null
  if (running !== null) await new Promise(resolve => running.close(resolve))
  await rm(root, { recursive: true, force: true })
})

const listen = async (seen: string[]): Promise<string> => {
  const created = createServer((req, res) => {
    const range = req.headers.range
    seen.push(typeof range === 'string' ? range : '(brak)')
    if (typeof range === 'string') {
      const from = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0)
      const slice = BODY.subarray(from)
      res.writeHead(206, {
        'content-length': String(slice.length),
        'content-range': `bytes ${from}-${BODY.length - 1}/${BODY.length}`,
      })
      res.end(slice)
      return
    }
    res.writeHead(200, { 'content-length': String(BODY.length) })
    res.end(BODY)
  })
  server = created
  await new Promise<void>(resolve => created.listen(0, '127.0.0.1', resolve))
  const address = created.address()
  if (address === null || typeof address === 'string') throw new Error('brak portu')
  return `http://127.0.0.1:${address.port}/plik.bin`
}

describe('downloadWithResume', () => {
  it('pobiera plik w całości i zgłasza postęp', async () => {
    const seen: string[] = []
    const url = await listen(seen)
    const target = join(root, 'plik.bin')
    const progress: number[] = []

    await downloadWithResume(url, target, received => progress.push(received), new AbortController().signal)

    expect(await readFile(target)).toEqual(BODY)
    expect(progress.at(-1)).toBe(BODY.length)
    expect(seen[0]).toBe('(brak)')
  })

  it('nie zostawia pliku tymczasowego po sukcesie', async () => {
    const url = await listen([])
    const target = join(root, 'plik.bin')
    await downloadWithResume(url, target, () => {}, new AbortController().signal)
    await expect(stat(`${target}.part`)).rejects.toThrow()
  })

  it('wznawia od miejsca przerwania zamiast pobierać od nowa', async () => {
    const seen: string[] = []
    const url = await listen(seen)
    const target = join(root, 'plik.bin')
    // Połowa pliku już na dysku — dokładnie stan po restarcie maszyny w trakcie
    // pobierania, który zdarzył się przy stawianiu serwera 2026-08-06.
    await writeFile(`${target}.part`, BODY.subarray(0, 10))

    await downloadWithResume(url, target, () => {}, new AbortController().signal)

    expect(seen[0]).toBe('bytes=10-')
    expect(await readFile(target)).toEqual(BODY)
  })

  it('przerwanie nie zostawia pliku pod nazwą docelową', async () => {
    const url = await listen([])
    const target = join(root, 'plik.bin')
    const controller = new AbortController()
    controller.abort()

    await expect(downloadWithResume(url, target, () => {}, controller.signal)).rejects.toThrow()
    // Plik docelowy powstaje WYŁĄCZNIE przez `rename` po kompletnym pobraniu —
    // inaczej następne uruchomienie uznałoby ucięty plik za gotowy model.
    await expect(stat(target)).rejects.toThrow()
  })

  it('kod spoza dwusetki kończy się błędem, nie pustym plikiem', async () => {
    const created = createServer((_req, res) => { res.writeHead(404); res.end() })
    server = created
    await new Promise<void>(resolve => created.listen(0, '127.0.0.1', resolve))
    const address = created.address()
    if (address === null || typeof address === 'string') throw new Error('brak portu')
    const target = join(root, 'plik.bin')

    await expect(
      downloadWithResume(`http://127.0.0.1:${address.port}/x`, target, () => {}, new AbortController().signal),
    ).rejects.toThrow(/404/)
    await expect(stat(target)).rejects.toThrow()
  })
})

describe('ensureFreeSpace', () => {
  it('przepuszcza, gdy miejsca jest dużo', async () => {
    await expect(ensureFreeSpace(root, 1024)).resolves.toBeUndefined()
  })

  it('odmawia PRZED pobraniem, gdy miejsca brak', async () => {
    await expect(ensureFreeSpace(root, Number.MAX_SAFE_INTEGER)).rejects.toThrow(/miejsca/i)
  })
})

describe('findExecutable', () => {
  it('znajduje plik w podkatalogu rozpakowanego wydania', async () => {
    await mkdir(join(root, 'llama-b10295'), { recursive: true })
    await writeFile(join(root, 'llama-b10295', 'llama-server'), '#!/bin/sh\n')
    expect(await findExecutable(root, 'llama-server'))
      .toBe(join(root, 'llama-b10295', 'llama-server'))
  })

  it('zwraca null, gdy pliku nie ma', async () => {
    expect(await findExecutable(root, 'llama-server')).toBeNull()
  })

  it('nieistniejący katalog to null, nie wyjątek', async () => {
    expect(await findExecutable(join(root, 'nie-ma'), 'llama-server')).toBeNull()
  })
})

describe('extractArchive', () => {
  it('rozpakowuje archiwum i USUWA je po sobie', async () => {
    const src = join(root, 'src')
    await mkdir(src, { recursive: true })
    await writeFile(join(src, 'llama-server'), 'binarka')
    const archive = join(root, 'wydanie.tar.gz')
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('tar', ['-czf', archive, '-C', src, '.'])
      proc.on('exit', code => (code === 0 ? resolve() : reject(new Error(`tar ${String(code)}`))))
    })

    const into = join(root, 'engine')
    await extractArchive(archive, into)

    expect(await readFile(join(into, 'llama-server'), 'utf8')).toBe('binarka')
    // Archiwum waży kilkaset megabajtów — zostawienie go podwaja miejsce zajęte
    // przez silnik bez żadnego powodu.
    await expect(stat(archive)).rejects.toThrow()
  })

  it('uszkodzone archiwum kończy się błędem, nie cichym sukcesem', async () => {
    const archive = join(root, 'zepsute.tar.gz')
    await writeFile(archive, 'to nie jest archiwum')
    await expect(extractArchive(archive, join(root, 'engine'))).rejects.toThrow()
  })
})

describe('verifyEngine', () => {
  it('binarka, która kończy się zerem, przechodzi', async () => {
    expect(await verifyEngine('/bin/true')).toBe(true)
  })

  it('binarka, która się nie uruchamia, NIE przechodzi', async () => {
    // Weryfikacja istnieje właśnie po to: przy ręcznym stawianiu skopiowana
    // sama binarka bez bibliotek obok nie startowała, a wyszło to dopiero przy
    // pierwszym zadaniu użytkownika.
    expect(await verifyEngine(join(root, 'nie-ma-takiego-pliku'))).toBe(false)
  })

  it('binarka kończąca się błędem NIE przechodzi', async () => {
    expect(await verifyEngine('/bin/false')).toBe(false)
  })
})
