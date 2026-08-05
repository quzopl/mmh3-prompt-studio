import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { LlmSettingsSchema, readSettings, redactSettings, writeSettings } from '../llm/settings.js'

// Ciało PUT ma inny kształt klucza niż to, co trafia na dysk: `apiKey` w
// zapisanych ustawieniach jest zawsze stringiem, ale w żądaniu potrzebujemy
// trzeciej wartości, żeby odróżnić „nie dotykaj" od „wyczyść".
const PutSettingsBody = LlmSettingsSchema.extend({
  endpoint: LlmSettingsSchema.shape.endpoint.extend({
    apiKey: z.string().nullable(),
  }),
})

export function registerLlmRoutes(app: FastifyInstance): void {
  app.get('/api/llm/settings', async () =>
    redactSettings(await readSettings(app.dataRoot)))

  app.put('/api/llm/settings', async (request, reply) => {
    const parsed = PutSettingsBody.safeParse(request.body)
    if (!parsed.success) {
      // Celowo bez `details: parsed.error.issues` — treść żądania może zawierać
      // klucz API, a komunikat błędu nie może go nigdzie powtórzyć.
      return reply.status(400).send({ error: 'Ustawienia niezgodne ze schematem' })
    }
    // Trzy znaczenia `apiKey` w żądaniu, bo przeglądarka nigdy nie zna
    // obecnego klucza — odczyt go redaguje:
    //   - niepusty string  → ustaw ten klucz;
    //   - pusty string ''  → zostaw obecny klucz bez zmian (formularz go po
    //     prostu nie niósł, nie znaczy to prośby o skasowanie);
    //   - null             → wyczyść klucz — to jedyny sposób, żeby
    //     użytkownik mógł cofnąć klucz wklejony wcześniej na tę maszynę.
    const current = await readSettings(app.dataRoot)
    const requested = parsed.data.endpoint.apiKey
    const apiKey = requested === null
      ? ''
      : requested === ''
        ? current.endpoint.apiKey
        : requested
    await writeSettings(app.dataRoot, {
      ...parsed.data,
      endpoint: { ...parsed.data.endpoint, apiKey },
    })
    return redactSettings(await readSettings(app.dataRoot))
  })
}
