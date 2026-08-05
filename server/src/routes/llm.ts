import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { buildPrompt } from '@mmh3/shared'
import { LlmSettingsSchema, readSettings, redactSettings, writeSettings } from '../llm/settings.js'
import { createProvider } from '../llm/provider.js'
import type { Provider } from '../llm/provider.js'
import { startManaged, stopManaged, managedState } from '../llm/managed.js'
import { detectUnloadCapability, unloadModel } from '../llm/unload.js'
import { runTask } from '../llm/run.js'
import { structureTask, structureToPatch, type StructureInput } from '../llm/tasks/structure.js'
import {
  redactTaskFor, redactToPatch, redactSourceText, RedactTargetSchema, type RedactInput,
} from '../llm/tasks/redact.js'
import { audioTask, audioToPatch, audioInputFromProject } from '../llm/tasks/audio.js'
import { criticTask, criticToNotes, criticAllowedRefs, type CriticInput } from '../llm/tasks/critic.js'
import { runTranslateAll } from '../llm/tasks/translateAll.js'
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
 * Jedna trasa, `task` rozstrzyga, o które z pięciu zadań chodzi — wszystkie
 * pięć są teraz zaimplementowane jako warianty tej samej unii
 * („structure" — zadanie 6, „redact" — zadanie 7, „audio" i „critic" —
 * zadanie 8, „translateAll" — zadanie 15). Tryb, długość projektu, lista
 * mówców, treść ujęć I skompilowany prompt pochodzą z projektu wczytanego po
 * stronie serwera, nie od klienta — klient dostarcza wyłącznie treść, której
 * serwer nie ma skąd wziąć (dwa zdania pomysłu dla „structure"). Dzięki temu
 * model zawsze widzi aktualny stan projektu, a nie kopię, którą przeglądarka
 * mogła przesłać nieaktualną. „audio", „critic" i „translateAll" nie niosą
 * żadnego pola poza `projectSlug` — wszystkie trzy czytają CAŁY projekt, nie
 * fragment wskazany przez klienta (zob. brief zadania 8, ta sama zasada dla
 * zadania 15).
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
  z.object({
    task: z.literal('audio'),
    projectSlug: SlugSchema,
  }),
  z.object({
    task: z.literal('critic'),
    projectSlug: SlugSchema,
  }),
  z.object({
    task: z.literal('translateAll'),
    projectSlug: SlugSchema,
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

/**
 * Adapter podstawiany pod `runTask` (zadanie 6, `llm/run.ts`) zamiast
 * prawdziwego dostawcy: ten sam interfejs `Provider`, ale `complete()` woła
 * pod spodem `stream()` prawdziwego dostawcy i przekazuje każdy kawałek
 * tekstu do `onChunk`, zanim zwróci pełny wynik, którego `runTask` oczekuje
 * z `complete()`. Dzięki temu `runTask` — łącznie z jedną próbą naprawy —
 * działa całkowicie bez zmian: nie wie, że rozmawia ze strumieniem, a obie
 * próby (pierwsza i naprawcza, jeśli w ogóle do niej dojdzie) przechodzą
 * przez ten sam kanał `onChunk`. To rozstrzyga pytanie „co widzi użytkownik
 * w trakcie naprawy" z briefu zadania 9: kawałki lecą bez przerwy przez cały
 * czas trwania zadania, więc naprawa nie wygląda jak zawieszenie — wygląda
 * jak dalszy ciąg tej samej odpowiedzi.
 *
 * `listModels` i `stream` przechodzą bez zmian — `runTask` nigdy ich nie
 * woła, ale muszą tu być, żeby obiekt nadal spełniał `Provider`.
 */
function toChunkForwardingProvider(provider: Provider, onChunk: (text: string) => void): Provider {
  return {
    listModels: provider.listModels,
    complete: req => provider.stream(req, onChunk),
    stream: provider.stream,
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

  // Wykrywanie i samo zwolnienie zawsze odpowiadają dwusetką — niepowodzenie
  // zwolnienia (dostawca bez takiej możliwości, błąd po jego stronie) to
  // WYNIK operacji, który klient ma pokazać, nie awaria protokołu HTTP.
  app.get('/api/llm/unload/capability', async () => {
    const settings = await readSettings(app.dataRoot)
    return { capability: await detectUnloadCapability(settings) }
  })

  app.post('/api/llm/unload', async () => {
    const settings = await readSettings(app.dataRoot)
    return await unloadModel(settings)
  })

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

    // Wejście każdego zadania — i sprawdzenia, które jeszcze mogą zwrócić
    // zwykłą odpowiedź 4xx/5xx (np. puste pole do redakcji, nieobsłużony
    // wariant zadania) — muszą się rozstrzygnąć TERAZ, zanim odpowiedź
    // zostanie przejęta pod SSE (`reply.hijack()` niżej). Kod statusu i
    // nagłówki da się ustawić tylko raz, przed pierwszym `write` na surowej
    // odpowiedzi — po hijacku jest już za późno na `reply.status(...)`.
    const resolved: {
      ok: true
      run: (fwd: Provider, signal: AbortSignal, onRepairStart: () => void) => Promise<Record<string, unknown>>
    } | { ok: false; status: number; error: string } = (() => {
      switch (parsed.data.task) {
        case 'structure': {
          const input: StructureInput = {
            ideaA: parsed.data.ideaA,
            ideaB: parsed.data.ideaB,
            mode: project.mode,
            durationSeconds: project.video.durationMs / 1000,
            speakers: project.speakers.map(s => ({ code: s.code, characterType: s.characterType })),
          }
          return {
            ok: true,
            run: async (fwd, signal, onRepairStart) => {
              const result = await runTask(fwd, structureTask, input, signal, onRepairStart)
              return {
                patch: structureToPatch(result.value, project),
                promptTokens: result.promptTokens,
                completionTokens: result.completionTokens,
                repaired: result.repaired,
              }
            },
          }
        }
        case 'redact': {
          // Treść wysyłana do modelu pochodzi WYŁĄCZNIE z projektu na dysku,
          // odczytana tym samym `redactSourceText`, którego `redactToPatch`
          // użyje potem do porównania „czy wynik faktycznie coś zmienia" —
          // patrz komentarz w `llm/tasks/redact.ts`.
          const source = redactSourceText(project, parsed.data.target)
          if (source === undefined || source.trim() === '') {
            return { ok: false, status: 400, error: 'Wskazane pole nie istnieje albo jest puste' }
          }
          const input: RedactInput = { text: source }
          const target = parsed.data.target
          return {
            ok: true,
            run: async (fwd, signal, onRepairStart) => {
              const result = await runTask(fwd, redactTaskFor(target), input, signal, onRepairStart)
              return {
                patch: redactToPatch(result.value, target, project),
                promptTokens: result.promptTokens,
                completionTokens: result.completionTokens,
                repaired: result.repaired,
              }
            },
          }
        }
        case 'audio': {
          const input = audioInputFromProject(project)
          return {
            ok: true,
            run: async (fwd, signal, onRepairStart) => {
              const result = await runTask(fwd, audioTask, input, signal, onRepairStart)
              return {
                patch: audioToPatch(result.value, project),
                promptTokens: result.promptTokens,
                completionTokens: result.completionTokens,
                repaired: result.repaired,
              }
            },
          }
        }
        case 'critic': {
          // Krytyk nie zwraca łatki — `notes`, nie `patch`, żeby odpowiedź tej
          // trasy sama w sobie odróżniała się od pozostałych trzech zadań i
          // klient (panel walidacji) nie mógł jej pomylić z operacjami do
          // przyjęcia/odrzucenia.
          const allowedRefs = criticAllowedRefs(project)
          const input: CriticInput = { promptText: buildPrompt(project).text, allowedRefs }
          return {
            ok: true,
            run: async (fwd, signal, onRepairStart) => {
              const result = await runTask(fwd, criticTask, input, signal, onRepairStart)
              return {
                notes: criticToNotes(result.value, allowedRefs),
                promptTokens: result.promptTokens,
                completionTokens: result.completionTokens,
                repaired: result.repaired,
              }
            },
          }
        }
        case 'translateAll': {
          // `runTranslateAll` (zadanie 15, `llm/tasks/translateAll.ts`)
          // niesie CAŁĄ orkiestrację — zbiera pola projektu, tnie je na
          // partie i woła `runTask` raz na partię — bo jedno wywołanie
          // `runTask` odpowiada JEDNEMU zapytaniu do modelu, a projekt z
          // kilkunastoma ujęciami może potrzebować więcej niż jednego.
          return {
            ok: true,
            run: async (fwd, signal, onRepairStart) => {
              const result = await runTranslateAll(fwd, project, signal, onRepairStart)
              return {
                patch: result.patch,
                promptTokens: result.promptTokens,
                completionTokens: result.completionTokens,
                repaired: result.repaired,
              }
            },
          }
        }
        default: {
          // Wyczerpujące dopasowanie: gdyby unia `RunBody` dostała kolejny
          // wariant zadania bez gałęzi tutaj, `parsed.data` przestałby się
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
          return { ok: false, status: 500, error: `Nieobsłużone zadanie: ${JSON.stringify(exhaustive)}` }
        }
      }
    })()

    if (!resolved.ok) return reply.status(resolved.status).send({ error: resolved.error })

    const { signal, release } = abortSignalFor(request)

    // Od tego miejsca odpowiedź jest w całości nasza — Fastify już nic do niej
    // nie doda ani nie zamknie jej sam. `chunk` pokazuje, że coś się dzieje, i
    // karmi licznik tokenów po stronie klienta; `repair` (round 1 recenzji
    // zadania 9) odpala się dokładnie raz, tylko jeśli pierwsza próba nie
    // przeszła walidacji — bez niego przerwa między pierwszą (nieudaną) a
    // drugą próbą nie miałaby żadnego zdarzenia, a cisza w środku zadania nie
    // różni się od modelu, który wciąż myśli; `done` niesie łatkę (albo uwagi
    // krytyka), zbudowaną DOPIERO gdy `run()` się rozstrzygnie — czyli po
    // zamknięciu strumienia, nigdy w jego trakcie (brief zadania 9:
    // częściowego JSON-a nie da się zwalidować, a półgotowa łatka zaprasza do
    // przyjęcia czegoś, co jeszcze nie istnieje).
    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    })
    reply.raw.flushHeaders()

    // Zerknięcie na `signal.aborted` przed każdym zapisem: gdy klient już
    // zniknął (gniazdo padło — ten sam sygnał, który przerywa zapytanie do
    // modelu, patrz `abortSignalFor`), pisanie na martwe gniazdo nie ma sensu
    // i mogłoby rzucić. Przerwanie ma naprawdę zatrzymać pracę, nie tylko
    // przestać ją pokazywać — dlatego to ten sam `signal`, który idzie niżej
    // do `runTask` i do samego zapytania HTTP w `openai.ts`.
    const send = (event: 'chunk' | 'repair' | 'done' | 'error', data: unknown): void => {
      if (signal.aborted) return
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }
    const forwardingProvider = toChunkForwardingProvider(provider, text => send('chunk', { text }))

    try {
      const payload = await resolved.run(forwardingProvider, signal, () => send('repair', {}))
      send('done', payload)
    } catch (error) {
      // Przerwanie klienta nie jest błędem do zaraportowania — nie ma już
      // komu go zaraportować. Każdy inny błąd (obie próby modelu zawiodły,
      // padło połączenie z serwerem modelu) ma dać zdarzenie `error`, nie
      // ciszę nie do odróżnienia od modelu, który wciąż myśli.
      if (!signal.aborted) {
        send('error', { error: error instanceof Error ? error.message : 'Błąd modelu' })
      }
    } finally {
      release()
      if (!signal.aborted) reply.raw.end()
    }
  })
}
