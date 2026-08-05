import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { LlmSettingsSchema, readSettings, redactSettings, writeSettings } from '../llm/settings.js'
import { createProvider } from '../llm/provider.js'
import { startManaged, stopManaged, managedState } from '../llm/managed.js'
import { runTask } from '../llm/run.js'
import { structureTask, structureToPatch, type StructureInput } from '../llm/tasks/structure.js'
import {
  redactTask, redactToPatch, redactSourceText, RedactTargetSchema, type RedactInput,
} from '../llm/tasks/redact.js'
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
  z.object({
    task: z.literal('redact'),
    projectSlug: SlugSchema,
    target: RedactTargetSchema,
  }),
])

/**
 * Sygnał przerwania na wywołanie modelu, budowany osobno dla każdego żądania.
 *
 * Runda 2 recenzji, dwa ślepe zaułki po drodze, oba sprawdzone gniazdem
 * testowym (`llm.test.ts`), nie samą lekturą dokumentacji:
 *
 * 1. `request.signal` (Fastify 5) to leniwy getter, który podpina się do
 *    zdarzenia `close` surowej wiadomości DOPIERO przy pierwszym odczycie. Od
 *    Node 16 `close` na `IncomingMessage` POSIADAJĄCEJ CIAŁO odpala się, gdy
 *    to ciało zostanie w całości odebrane — NIE dopiero wtedy, gdy gniazdo
 *    faktycznie padnie. Odczyt po paru `await` trafiał więc na `close`, które
 *    już minęło i nigdy się nie powtórzy.
 *
 * 2. Poprawka „użyj haka `onRequestAbort`" (publiczne API tego samego
 *    mechanizmu co własna warstwa routingu Fastify — `req.on('close', …)` +
 *    sprawdzenie `req.aborted`) wygląda na właściwą i jest nią dla żądań BEZ
 *    ciała (tak testuje ją sam pakiet Fastify — `GET` bez treści). Ale
 *    `POST /api/llm/run` ciało ma zawsze, a `close` na `request.raw` dla
 *    żądania z ciałem odpala się RAZ, w chwili, gdy parser JSON skończy je
 *    czytać — czyli prawie natychmiast po starcie handlera, z `req.aborted
 *    === false`, i nigdy więcej, nawet gdy gniazdo realnie potem padnie.
 *    Zmierzone osobnym, minimalnym serwerem Fastify z gniazdem `net.connect`:
 *    hak `onRequestAbort` dla trasy z ciałem JSON nie odpalił się ANI RAZU
 *    w ciągu sekundy po zerwaniu połączenia.
 *
 * Działa nasłuch na SUROWYM GNIEŹDZIE TCP (`request.raw.socket`), nie na
 * `IncomingMessage`: zdarzenie `close` gniazda odpala się dokładnie raz, w
 * chwili realnego zerwania połączenia, niezależnie od tego, czy żądanie miało
 * ciało — to samo zmierzone tym samym gniazdem testowym. Nasłuch jest
 * zdejmowany w `finally`, więc normalne zamknięcie gniazda PO wysłaniu
 * odpowiedzi nigdy nie odpala przerwania, którego już nie ma czego dotyczyć.
 */
function abortSignalFor(request: FastifyRequest): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController()
  const onClose = (): void => controller.abort()
  request.raw.socket.once('close', onClose)
  return {
    signal: controller.signal,
    release: () => request.raw.socket.off('close', onClose),
  }
}

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

    const { signal, release } = abortSignalFor(request)
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
        case 'redact': {
          // Treść wysyłana do modelu pochodzi WYŁĄCZNIE z projektu na dysku,
          // odczytana tym samym `redactSourceText`, którego `redactToPatch`
          // użyje potem do porównania „czy wynik faktycznie coś zmienia" —
          // patrz komentarz w `llm/tasks/redact.ts`.
          const source = redactSourceText(project, parsed.data.target)
          if (source === undefined || source.trim() === '') {
            return reply.status(400).send({ error: 'Wskazane pole nie istnieje albo jest puste' })
          }
          const input: RedactInput = { text: source }
          const result = await runTask(provider, redactTask, input, signal)
          return {
            patch: redactToPatch(result.value, parsed.data.target, project),
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            repaired: result.repaired,
          }
        }
        default: {
          // Wyczerpujące dopasowanie: gdyby unia `RunBody` dostała kolejny
          // wariant zadania (8–9) bez gałęzi tutaj, `parsed.data` przestałby się
          // dać zawęzić do `never` i `tsc --noEmit` przerwałby build — a nie
          // cichy `undefined` z handlera, jak przy `switch` bez `default`.
          //
          // Celowo `parsed.data`, NIE `parsed.data.task`: od dwóch wariantów
          // wzwyż (od tego zadania) TypeScript zawęża w gałęzi `default` CAŁY
          // obiekt dyskryminowanej unii do `never`, a odczyt pojedynczego pola
          // z wartości już zawężonej do `never` sam jest błędem typów
          // ("Property does not exist on type 'never'") — zmierzone wprost
          // (`tsc --strict` na izolowanym przykładzie z jedną vs dwiema
          // gałęziami `case`). Przy jednym wariancie (stan przed tym zadaniem)
          // ten sam kod przechodził przypadkiem, bo `u.task` zawężało się do
          // `never` przez zwykłą analizę przepływu pola, nie przez zawężenie
          // całej unii.
          const exhaustive: never = parsed.data
          return reply.status(500).send({ error: `Nieobsłużone zadanie: ${JSON.stringify(exhaustive)}` })
        }
      }
    } catch (error) {
      return reply.status(502).send({ error: error instanceof Error ? error.message : 'Błąd modelu' })
    } finally {
      release()
    }
  })
}
