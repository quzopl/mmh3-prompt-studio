import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { buildPrompt, ProjectSchema } from '@mmh3/shared'
import {
  createProject, deleteProject, listProjects, readProject, writeProject,
} from '../storage/projectStore.js'

const CreateBody = z.object({
  name: z.string().trim().min(1),
  mode: z.enum(['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF']),
})

const UpdateBody = z.object({ project: ProjectSchema })
const SlugParams = z.object({ slug: z.string().min(1) })

const isMissing = (err: unknown): boolean =>
  err instanceof Error && /nie istnieje/i.test(err.message)

const isDuplicate = (err: unknown): boolean =>
  err instanceof Error && /już istnieje/i.test(err.message)

export function registerProjectRoutes(app: FastifyInstance): void {
  app.get('/api/projects', async () => listProjects(app.dataRoot))

  app.post('/api/projects', async (request, reply) => {
    const parsed = CreateBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Niepoprawne dane projektu', details: parsed.error.issues })
    }
    try {
      const created = await createProject(app.dataRoot, parsed.data.name, parsed.data.mode)
      return reply.status(201).send(created)
    } catch (err) {
      if (isDuplicate(err)) return reply.status(409).send({ error: (err as Error).message })
      throw err
    }
  })

  app.get('/api/projects/:slug', async (request, reply) => {
    const { slug } = SlugParams.parse(request.params)
    try {
      const project = await readProject(app.dataRoot, slug)
      const result = buildPrompt(project)
      return { project, prompt: result.text, tokens: result.tokens, diagnostics: result.diagnostics }
    } catch (err) {
      if (isMissing(err)) return reply.status(404).send({ error: (err as Error).message })
      return reply.status(400).send({ error: `Projekt "${slug}" jest uszkodzony` })
    }
  })

  app.put('/api/projects/:slug', async (request, reply) => {
    const { slug } = SlugParams.parse(request.params)
    const parsed = UpdateBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Projekt niezgodny ze schematem', details: parsed.error.issues })
    }
    try {
      await readProject(app.dataRoot, slug)
    } catch (err) {
      if (isMissing(err)) return reply.status(404).send({ error: (err as Error).message })
      throw err
    }
    const project = parsed.data.project
    await writeProject(app.dataRoot, slug, project)
    const result = buildPrompt(project)
    return { prompt: result.text, tokens: result.tokens, diagnostics: result.diagnostics }
  })

  app.delete('/api/projects/:slug', async (request, reply) => {
    const { slug } = SlugParams.parse(request.params)
    try {
      await deleteProject(app.dataRoot, slug)
      return reply.status(204).send()
    } catch (err) {
      if (isMissing(err)) return reply.status(404).send({ error: (err as Error).message })
      throw err
    }
  })
}
