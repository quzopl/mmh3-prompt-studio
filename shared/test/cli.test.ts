import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { newProject } from './fixtures/newProject.js'

// `cli.ts` jest skryptem z efektami ubocznymi na poziomie modułu (process.exit),
// więc jedyny sposób, żeby przetestować to, co faktycznie widzi użytkownik
// `mmh3c`, to uruchomić go jako osobny proces — import wywalałby test runner.
const sharedRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxBin = join(sharedRoot, '..', 'node_modules', '.bin', 'tsx')

let dir = ''
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mmh3-cli-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('mmh3c (CLI)', () => {
  it('otwiera projekt z powtórzonym id ujęcia i drukuje prompt zamiast kończyć błędem walidacji', async () => {
    const project = newProject()
    const first = project.shots[0]
    if (!first) throw new Error('fixture bez ujęć')
    const path = join(dir, 'project.json')
    await writeFile(
      path,
      JSON.stringify({ ...project, shots: [first, { ...first, startMs: 4000 }] }),
    )

    const result = spawnSync(tsxBin, ['src/cli.ts', path], { cwd: sharedRoot, encoding: 'utf8' })

    expect(result.stderr).not.toMatch(/Nie udało się wczytać projektu/)
    expect(result.stdout).toContain('integrated_multimodal_description:')
    expect(result.status).not.toBe(2)
  })
})
