import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { buildPrompt } from '@mmh3/shared'
import { readProject } from '../storage/projectStore.js'
import { injectPrompt } from '../export/comfyWorkflow.js'
import { SlugParams, parseParamsOrReply } from './params.js'

const ComfyBody = z.object({
  workflow: z.unknown(),
  nodeId: z.string().min(1),
  field: z.string().min(1),
})

export function registerExportRoutes(app: FastifyInstance): void {
  const load = async (slug: string) => readProject(app.dataRoot, slug)

  app.get('/api/projects/:slug/export/prompt', async (request, reply) => {
    const params = parseParamsOrReply(SlugParams, request.params, reply)
    if (!params) return
    const { slug } = params
    try {
      const { text } = buildPrompt(await load(slug))
      return reply.type('text/plain; charset=utf-8').send(text)
    } catch {
      return reply.status(404).send({ error: `Projekt "${slug}" nie istnieje` })
    }
  })

  app.get('/api/projects/:slug/export/project', async (request, reply) => {
    const params = parseParamsOrReply(SlugParams, request.params, reply)
    if (!params) return
    const { slug } = params
    try {
      return await load(slug)
    } catch {
      return reply.status(404).send({ error: `Projekt "${slug}" nie istnieje` })
    }
  })

  app.post('/api/projects/:slug/export/comfy', async (request, reply) => {
    const params = parseParamsOrReply(SlugParams, request.params, reply)
    if (!params) return
    const { slug } = params
    const parsed = ComfyBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Brakuje workflow, identyfikatora węzła albo pola' })
    }
    let text: string
    try {
      text = buildPrompt(await load(slug)).text
    } catch {
      return reply.status(404).send({ error: `Projekt "${slug}" nie istnieje` })
    }
    try {
      return injectPrompt(parsed.data.workflow, parsed.data.nodeId, parsed.data.field, text)
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })
}
