import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { assertInsideRoot, projectDir } from '../storage/paths.js'
import { readProject, writeProject } from '../storage/projectStore.js'
import { removeAsset, saveAsset } from '../storage/assetStore.js'
import { AssetParams, SlugParams, parseParamsOrReply } from './params.js'

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024

export async function registerAssetRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } })

  app.post('/api/projects/:slug/assets', async (request, reply) => {
    const params = parseParamsOrReply(SlugParams, request.params, reply)
    if (!params) return
    const { slug } = params

    let project
    try {
      project = await readProject(app.dataRoot, slug)
    } catch {
      return reply.status(404).send({ error: `Projekt "${slug}" nie istnieje` })
    }

    const file = await request.file()
    if (!file) return reply.status(400).send({ error: 'Brak pliku w żądaniu' })

    try {
      const asset = await saveAsset(app.dataRoot, slug, {
        fileName: file.filename,
        mime: file.mimetype,
        data: await file.toBuffer(),
      })
      const updated = { ...project, assets: [...project.assets, asset] }
      await writeProject(app.dataRoot, slug, updated)
      return reply.status(201).send({ asset, project: updated })
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.get('/api/projects/:slug/assets/:assetId/raw', async (request, reply) => {
    const params = parseParamsOrReply(AssetParams, request.params, reply)
    if (!params) return
    const { slug, assetId } = params
    let project
    try {
      project = await readProject(app.dataRoot, slug)
    } catch {
      return reply.status(404).send({ error: `Projekt "${slug}" nie istnieje` })
    }
    const asset = project.assets.find(a => a.id === assetId)
    if (!asset) return reply.status(404).send({ error: `Asset "${assetId}" nie istnieje` })
    // `asset.path` pochodzi z `project.json`, a schemat dopuszcza tam dowolny
    // napis — trasa PUT pozwala więc klientowi wstawić `../..`. Korzeniem jest
    // katalog projektu, nie korzeń danych: asset nie ma prawa wyjść nawet do
    // sąsiedniego projektu.
    const home = projectDir(app.dataRoot, slug)
    const resolved = join(home, asset.path)
    try {
      assertInsideRoot(home, resolved)
    } catch {
      return reply.status(400).send({ error: `Ścieżka assetu "${assetId}" wychodzi poza projekt` })
    }
    try {
      return reply.send(await readFile(resolved))
    } catch {
      return reply.status(404).send({ error: `Plik assetu "${assetId}" zniknął z dysku` })
    }
  })

  app.delete('/api/projects/:slug/assets/:assetId', async (request, reply) => {
    const params = parseParamsOrReply(AssetParams, request.params, reply)
    if (!params) return
    const { slug, assetId } = params
    let project
    try {
      project = await readProject(app.dataRoot, slug)
    } catch {
      return reply.status(404).send({ error: `Projekt "${slug}" nie istnieje` })
    }
    await removeAsset(app.dataRoot, slug, assetId)
    const updated = { ...project, assets: project.assets.filter(a => a.id !== assetId) }
    await writeProject(app.dataRoot, slug, updated)
    return { project: updated }
  })
}
