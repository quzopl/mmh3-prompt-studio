import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { LlmSettingsSchema, readSettings, redactSettings, writeSettings } from '../llm/settings.js'
import { createProvider } from '../llm/provider.js'
import { startManaged, stopManaged, managedState } from '../llm/managed.js'
import { runTask } from '../llm/run.js'
import { structureTask, structureToPatch, type StructureInput } from '../llm/tasks/structure.js'
import { readProject } from '../storage/projectStore.js'
import { SlugSchema } from './params.js'

// Ciało PUT ma inny kształt klucza niż to, co trafia na dysk: `apiKey` w
// zapisanych ustawieniach jest zawsze stringiem, ale w żądaniu potrzebujemy
// trzeciej wartości, żeby odróżnić „nie dotykaj" od „wyczyść".
const PutSettingsBody = LlmSettingsSchema.extend({
  endpoint: LlmSettingsSchema.shape.endpoint.extend({
    apiKey: z.string().nullable(),
  }),
})

/**
 * Jedna trasa, `task` rozstrzyga, o które z czterech zadań chodzi — na razie
 * tylko „structure" (zadanie 6) jest zaimplementowane, kolejne trzy (zadania
 * 7–9) dojdą jako kolejne warianty tej samej unii. Tryb i długość projektu
 * ORAZ lista mówców pochodzą z projektu wczytanego po stronie serwera, nie od
 * klienta — klient dostarcza wyłącznie treść, której serwer nie ma skąd wziąć
 * (dwa zdania pomysłu). Dzięki temu model zawsze widzi aktualny stan projektu,
 * a nie kopię, którą przeglądarka mogła przesłać nieaktualną.
 */
const RunBody = z.discriminatedUnion('task', [
  z.object({
    task: z.literal('structure'),
    projectSlug: SlugSchema,
    ideaA: z.string().min(1),
    ideaB: z.string().min(1),
  }),
])

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

  app.get('/api/llm/models', async (_request, reply) => {
    const provider = createProvider(await readSettings(app.dataRoot))
    if (provider === null) return reply.status(409).send({ error: 'Model nie jest skonfigurowany' })
    try {
      return { models: await provider.listModels() }
    } catch (error) {
      return reply.status(502).send({ error: error instanceof Error ? error.message : 'Błąd modelu' })
    }
  })

  app.post('/api/llm/managed/start', async (_request, reply) => {
    const settings = await readSettings(app.dataRoot)
    if (settings.mode !== 'managed') {
      return reply.status(409).send({ error: 'Tryb zarządzanego serwera nie jest ustawiony w konfiguracji' })
    }
    try {
      return await startManaged(settings.managed)
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : 'Nie udało się uruchomić zarządzanego serwera',
      })
    }
  })

  app.post('/api/llm/managed/stop', async () => {
    await stopManaged()
    return managedState()
  })

  app.get('/api/llm/managed/state', async () => managedState())

  app.post('/api/llm/run', async (request, reply) => {
    const parsed = RunBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Żądanie niezgodne ze schematem zadania' })
    }

    const provider = createProvider(await readSettings(app.dataRoot))
    if (provider === null) return reply.status(409).send({ error: 'Model nie jest skonfigurowany' })

    let project
    try {
      project = await readProject(app.dataRoot, parsed.data.projectSlug)
    } catch {
      return reply.status(404).send({ error: `Projekt "${parsed.data.projectSlug}" nie istnieje` })
    }

    const signal = new AbortController().signal
    try {
      switch (parsed.data.task) {
        case 'structure': {
          const input: StructureInput = {
            ideaA: parsed.data.ideaA,
            ideaB: parsed.data.ideaB,
            mode: project.mode,
            durationSeconds: project.video.durationMs / 1000,
            speakers: project.speakers.map(s => ({ code: s.code, characterType: s.characterType })),
          }
          const result = await runTask(provider, structureTask, input, signal)
          return {
            patch: structureToPatch(result.value, project),
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            repaired: result.repaired,
          }
        }
      }
    } catch (error) {
      return reply.status(502).send({ error: error instanceof Error ? error.message : 'Błąd modelu' })
    }
  })
}
