import { readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Asset } from '@mmh3/shared'
import { assertInsideRoot, assetsDir } from './paths.js'

export type AssetKind = Asset['kind']

const THUMBNAIL_WIDTH = 320

const EXTENSION_BY_KIND: Record<AssetKind, string> = {
  image: '.img', video: '.vid', audio: '.aud',
}

export function assetKindFromMime(mime: string): AssetKind | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return null
}

export interface IncomingFile {
  fileName: string
  mime: string
  data: Buffer
}

export async function saveAsset(
  root: string,
  slug: string,
  file: IncomingFile,
): Promise<Asset> {
  const kind = assetKindFromMime(file.mime)
  if (!kind) throw new Error(`Niedozwolony typ pliku: ${file.mime || '(brak)'}`)

  const dir = assetsDir(root, slug)
  assertInsideRoot(root, dir)

  const id = `asset-${randomUUID()}`
  const stored = `${id}${EXTENSION_BY_KIND[kind]}`
  await writeFile(join(dir, stored), file.data)

  if (kind === 'image') await writeThumbnail(dir, id, file.data)

  return { id, kind, path: join('assets', stored), fileName: file.fileName }
}

/**
 * Miniatura jest wygodą, nie warunkiem. Uszkodzony plik albo brak działającego
 * `sharp` nie może przerwać wgrywania assetu.
 */
async function writeThumbnail(dir: string, id: string, data: Buffer): Promise<void> {
  try {
    const { default: sharp } = await import('sharp')
    const thumb = await sharp(data).resize({ width: THUMBNAIL_WIDTH }).webp().toBuffer()
    await writeFile(join(dir, `${id}.thumb.webp`), thumb)
  } catch {
    return
  }
}

export async function removeAsset(root: string, slug: string, assetId: string): Promise<void> {
  const dir = assetsDir(root, slug)
  assertInsideRoot(root, dir)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.startsWith(assetId)) continue
    await rm(join(dir, entry), { force: true })
  }
}
