import Fastify, { type FastifyInstance } from 'fastify'
import { join } from 'node:path'
import { registerProjectRoutes } from './routes/projects.js'
import { registerAssetRoutes } from './routes/assets.js'
import { registerExportRoutes } from './routes/export.js'
import { registerLlmRoutes } from './routes/llm.js'

export const VERSION = '0.1.0'

export interface AppOptions {
  dataRoot: string
  /** Domyślnie `<dataRoot>/../runtime` — testy, które nie pobierają niczego,
   *  nie muszą go podawać. */
  runtimeRoot?: string
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  app.decorate('dataRoot', opts.dataRoot)
  app.decorate('runtimeRoot', opts.runtimeRoot ?? join(opts.dataRoot, '..', 'runtime'))

  app.get('/api/health', async () => ({ status: 'ok', version: VERSION }))

  registerProjectRoutes(app)
  await registerAssetRoutes(app)
  registerExportRoutes(app)
  registerLlmRoutes(app)

  app.setNotFoundHandler(async (request, reply) => {
    await reply.status(404).send({ error: `Nie znaleziono ścieżki ${request.url}` })
  })

  return app
}

declare module 'fastify' {
  interface FastifyInstance {
    dataRoot: string
    runtimeRoot: string
  }
}
