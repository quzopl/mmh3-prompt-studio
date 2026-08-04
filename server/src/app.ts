import Fastify, { type FastifyInstance } from 'fastify'
import { registerProjectRoutes } from './routes/projects.js'
import { registerAssetRoutes } from './routes/assets.js'

export const VERSION = '0.1.0'

export interface AppOptions {
  dataRoot: string
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  app.decorate('dataRoot', opts.dataRoot)

  app.get('/api/health', async () => ({ status: 'ok', version: VERSION }))

  registerProjectRoutes(app)
  await registerAssetRoutes(app)

  app.setNotFoundHandler(async (request, reply) => {
    await reply.status(404).send({ error: `Nie znaleziono ścieżki ${request.url}` })
  })

  return app
}

declare module 'fastify' {
  interface FastifyInstance {
    dataRoot: string
  }
}
