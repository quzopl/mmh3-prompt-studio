import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildArgs, validateManaged, startManaged, stopManaged, managedState } from '../../src/llm/managed.js'

let root = ''
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mmh3-managed-')) })
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
