import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { z } from 'zod'
import { projectDir } from '../storage/paths.js'
import { readProject, writeProject } from '../storage/projectStore.js'
import { removeAsset, saveAsset } from '../storage/assetStore.js'

const Params = z.object({ slug: z.string().min(1) })
const AssetParams = z.object({ slug: z.string().min(1), assetId: z.string().min(1) })

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024

export async function registerAssetRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } })

  app.post('/api/projects/:slug/assets', async (request, reply) => {
    const { slug } = Params.parse(request.params)

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
    const { slug, assetId } = AssetParams.parse(request.params)
    let project
    try {
      project = await readProject(app.dataRoot, slug)
    } catch {
      return reply.status(404).send({ error: `Projekt "${slug}" nie istnieje` })
    }
    const asset = project.assets.find(a => a.id === assetId)
    if (!asset) return reply.status(404).send({ error: `Asset "${assetId}" nie istnieje` })
    try {
      return reply.send(await readFile(join(projectDir(app.dataRoot, slug), asset.path)))
    } catch {
      return reply.status(404).send({ error: `Plik assetu "${assetId}" zniknął z dysku` })
    }
  })

  app.delete('/api/projects/:slug/assets/:assetId', async (request, reply) => {
    const { slug, assetId } = AssetParams.parse(request.params)
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
