import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assetKindFromMime, saveAsset, removeAsset } from '../../src/storage/assetStore.js'
import { createProject } from '../../src/storage/projectStore.js'
import { assetsDir } from '../../src/storage/paths.js'

let root: string
let slug: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-asset-'))
  slug = (await createProject(root, 'Assety', 'REF')).slug
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

// Najmniejszy poprawny PNG 1x1, zapisany na stałe zamiast generowany,
// żeby test nie zależał od biblioteki, którą właśnie sprawdza.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

describe('assetKindFromMime', () => {
  it('rozpoznaje trzy dozwolone rodziny typów', () => {
    expect(assetKindFromMime('image/png')).toBe('image')
    expect(assetKindFromMime('video/mp4')).toBe('video')
    expect(assetKindFromMime('audio/wav')).toBe('audio')
  })

  it('odrzuca typ spoza trzech rodzin', () => {
    expect(assetKindFromMime('application/pdf')).toBeNull()
    expect(assetKindFromMime('')).toBeNull()
  })
})

describe('saveAsset', () => {
  it('zapisuje plik i zwraca metadane', async () => {
    const asset = await saveAsset(root, slug, {
      fileName: 'kadr.png', mime: 'image/png', data: PNG_1X1,
    })
    expect(asset.kind).toBe('image')
    expect(asset.fileName).toBe('kadr.png')
    expect(asset.id).toMatch(/^asset-/)
    const files = await readdir(assetsDir(root, slug))
    expect(files).toContain(`${asset.id}.img`)
  })

  it('nadaje unikalne identyfikatory plikom o tej samej nazwie', async () => {
    const a = await saveAsset(root, slug, { fileName: 'x.png', mime: 'image/png', data: PNG_1X1 })
    const b = await saveAsset(root, slug, { fileName: 'x.png', mime: 'image/png', data: PNG_1X1 })
    expect(a.id).not.toBe(b.id)
  })

  it('odrzuca niedozwolony typ pliku', async () => {
    await expect(saveAsset(root, slug, {
      fileName: 'z.pdf', mime: 'application/pdf', data: Buffer.from('x'),
    })).rejects.toThrow(/typ/i)
  })

  it('zapisuje asset nawet gdy nie da się zrobić miniatury', async () => {
    const asset = await saveAsset(root, slug, {
      fileName: 'uszkodzony.png', mime: 'image/png', data: Buffer.from('to nie jest obraz'),
    })
    expect(asset.kind).toBe('image')
    const files = await readdir(assetsDir(root, slug))
    expect(files).toContain(`${asset.id}.img`)
  })
})

describe('removeAsset', () => {
  it('usuwa plik z dysku', async () => {
    const asset = await saveAsset(root, slug, {
      fileName: 'kadr.png', mime: 'image/png', data: PNG_1X1,
    })
    await removeAsset(root, slug, asset.id)
    const files = await readdir(assetsDir(root, slug))
    expect(files.some(f => f.startsWith(asset.id))).toBe(false)
  })

  it('nie wywraca się na nieistniejącym assecie', async () => {
    await expect(removeAsset(root, slug, 'asset-nie-ma')).resolves.toBeUndefined()
  })

  it('nie kasuje cudzych plików po samym przedrostku', async () => {
    const a = await saveAsset(root, slug, { fileName: 'a.png', mime: 'image/png', data: PNG_1X1 })
    const b = await saveAsset(root, slug, { fileName: 'b.png', mime: 'image/png', data: PNG_1X1 })
    await removeAsset(root, slug, 'asset-')
    const files = await readdir(assetsDir(root, slug))
    expect(files.some(f => f.startsWith(a.id))).toBe(true)
    expect(files.some(f => f.startsWith(b.id))).toBe(true)
  })

  it('kasuje plik assetu razem z miniaturą', async () => {
    const asset = await saveAsset(root, slug, {
      fileName: 'kadr.png', mime: 'image/png', data: PNG_1X1,
    })
    expect(await readdir(assetsDir(root, slug))).toContain(`${asset.id}.thumb.webp`)
    await removeAsset(root, slug, asset.id)
    expect(await readdir(assetsDir(root, slug))).toEqual([])
  })
})
