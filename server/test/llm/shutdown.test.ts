import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installShutdownHooks, managedState, startManaged, stopManaged } from '../../src/llm/managed.js'

/**
 * Osobny plik, BEZ mocka `spawn` — `managed.test.ts` go podmienia, a ten
 * scenariusz musi uruchomić prawdziwy proces potomny i sprawdzić, czy naprawdę
 * ginie. Z atrapą sprawdzałby wyłącznie, czy zawołano funkcję.
 */

let root = ''

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mmh3-shutdown-')) })
afterEach(async () => {
  await stopManaged()
  await rm(root, { recursive: true, force: true })
  process.removeAllListeners('SIGTERM')
  process.removeAllListeners('SIGINT')
})

/** `startManaged` przyjmuje PODOBIEKT `managed`, nie całe ustawienia. */
const settingsFor = (binary: string) => ({
  serverBinary: binary,
  modelPath: join(root, 'model.gguf'),
  gpuLayers: 0,
  contextSize: 8192,
})

/** Atrapa serwera, która NIE kończy się sama — dokładnie jak prawdziwy
 *  `llama-server`, i dlatego jedyna, na której ten test coś znaczy. */
const fakeServer = async (): Promise<string> => {
  const bin = join(root, 'fake-server.sh')
  await writeFile(bin, '#!/bin/sh\nwhile true; do sleep 1; done\n')
  await chmod(bin, 0o755)
  await writeFile(join(root, 'model.gguf'), 'x')
  return bin
}

describe('installShutdownHooks', () => {
  it('SIGTERM zatrzymuje zarządzany serwer, zamiast zostawić go sierotą', async () => {
    // Powód istnienia tego testu, zmierzony na serwerze 2026-08-06: po dwóch
    // wdrożeniach na karcie stały DWA osierocone `llama-server` z PPID 1, po
    // 9,9 GB każdy. Zabicie API nie zabija dziecka — init je przygarnia — a
    // nowe API nie ma do nich uchwytu, więc „Zwolnij pamięć karty" nie ma
    // czego zatrzymać.
    const bin = await fakeServer()
    // `startManaged` czeka na sondę zdrowia, której atrapa nie obsłuży —
    // uruchamiamy bez czekania i sprawdzamy sam fakt istnienia procesu.
    void startManaged(settingsFor(bin))
    await vi.waitFor(() => {
      expect(['starting', 'ready', 'failed']).toContain(managedState().status)
    }, { timeout: 5_000 })

    let finished = false
    installShutdownHooks(() => { finished = true })
    process.emit('SIGTERM')

    await vi.waitFor(() => { expect(finished).toBe(true) }, { timeout: 15_000 })
    expect(managedState().status).toBe('stopped')
  }, 30_000)

  it('SIGINT działa tak samo — Ctrl+C w terminalu też nie ma zostawiać sieroty', async () => {
    const bin = await fakeServer()
    void startManaged(settingsFor(bin))
    await vi.waitFor(() => {
      expect(['starting', 'ready', 'failed']).toContain(managedState().status)
    }, { timeout: 5_000 })

    let finished = false
    installShutdownHooks(() => { finished = true })
    process.emit('SIGINT')

    await vi.waitFor(() => { expect(finished).toBe(true) }, { timeout: 15_000 })
    expect(managedState().status).toBe('stopped')
  }, 30_000)

  it('SIGTERM, a zaraz po nim SIGINT, zamyka RAZ, nie dwa razy', async () => {
    // To sprawdza straż `closing`, a nie `process.once`. Dwa SIGTERM-y pod rząd
    // niczego by nie dowiodły: `once` sam zdejmuje nasłuch po pierwszym
    // wywołaniu, więc test przechodziłby także bez straży (sprawdzone wprost —
    // pierwsza wersja tego testu była bezczynna). Prawdziwym zagrożeniem są
    // DWA RÓŻNE sygnały, bo to dwa osobne nasłuchy.
    let calls = 0
    installShutdownHooks(() => { calls += 1 })
    process.emit('SIGTERM')
    process.emit('SIGINT')
    await vi.waitFor(() => { expect(calls).toBe(1) }, { timeout: 5_000 })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(calls).toBe(1)
  }, 15_000)
})
