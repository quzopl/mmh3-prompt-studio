import type { FastifyInstance } from 'fastify'
import { LlmSettingsSchema, readSettings, redactSettings, writeSettings } from '../llm/settings.js'

export function registerLlmRoutes(app: FastifyInstance): void {
  app.get('/api/llm/settings', async () =>
    redactSettings(await readSettings(app.dataRoot)))

  app.put('/api/llm/settings', async (request, reply) => {
    const parsed = LlmSettingsSchema.safeParse(request.body)
    if (!parsed.success) {
      // Celowo bez `details: parsed.error.issues` — treść żądania może zawierać
      // klucz API, a komunikat błędu nie może go nigdzie powtórzyć.
      return reply.status(400).send({ error: 'Ustawienia niezgodne ze schematem' })
    }
    // Pusty klucz w żądaniu znaczy „nie zmieniaj", a nie „skasuj" — przeglądarka
    // nigdy nie zna obecnego klucza, bo odczyt go redaguje, więc bez tego każdy
    // zapis ustawień gubiłby klucz wpisany wcześniej.
    const current = await readSettings(app.dataRoot)
    const apiKey = parsed.data.endpoint.apiKey === ''
      ? current.endpoint.apiKey
      : parsed.data.endpoint.apiKey
    await writeSettings(app.dataRoot, {
      ...parsed.data,
      endpoint: { ...parsed.data.endpoint, apiKey },
    })
    return redactSettings(await readSettings(app.dataRoot))
  })
}
