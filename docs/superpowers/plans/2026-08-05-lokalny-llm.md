# Lokalny LLM — plan wdrożenia

> **Dla pracujących agentowo:** WYMAGANA PODUMIEJĘTNOŚĆ: użyj superpowers:subagent-driven-development (zalecane) albo superpowers:executing-plans, żeby wykonać ten plan zadanie po zadaniu. Kroki mają składnię pól wyboru (`- [ ]`).

**Cel:** dołożyć §8 specyfikacji — jedną abstrakcję dostawcy z dwiema implementacjami (endpoint zgodny z OpenAI oraz zarządzany `llama-server` z pliku `.gguf`) i cztery zadania językowe, z których każde zwraca **łatkę do modelu domeny**, nigdy gotowy tekst wyjściowy.

**Architektura:** rozmowa z modelem odbywa się po stronie serwera, nie przeglądarki — bo zarządzany `llama-server` to proces, który backend uruchamia i zatrzymuje, a klucz do endpointu nie ma czego szukać w kodzie strony. Serwer wystawia jedno wejście `POST /api/llm/run`, strumieniuje odpowiedź przez SSE i zwraca ustrukturyzowany wynik. Przeglądarka nie rozmawia z modelem nigdy.

Wynik każdego zadania to `ProjectPatch` — lista nazwanych operacji na modelu, z których każdą da się przyjąć albo odrzucić osobno. Zastosowanie łatki idzie przez `normalizeProject`, więc łatka nie może obejść niezmienników, które zbudował Plan 4.

**Stos:** bez nowych zależności produkcyjnych poza `undici` (jest w Node 22 jako globalne `fetch`, więc i tego nie trzeba). Node 22, Fastify, React 19, TypeScript strict, Vitest 4, Playwright.

## Ograniczenia globalne

- Każdy ciąg widoczny dla użytkownika pochodzi z `web/src/i18n/dict.ts` przez `useT()` i ma postać polską **i** angielską.
- Komentarze w kodzie i komunikaty commitów po polsku; identyfikatory i typy po angielsku.
- `strict` TypeScript z `noUncheckedIndexedAccess`, zero `any`, **zero asercji `!`** w `web/src` i `server/src`.
- **LLM nigdy nie pisze tekstu wyjściowego bezpośrednio.** Zwraca łatkę; użytkownik ją przyjmuje.
- **Akcja interfejsu nie ma prawa wyprodukować diagnostyki walidatora w projekcie, ktory jej nie miał.** Przyjęte wyjątki: `SPEECH_FITS`, `SOUNDSCAPE_NA_ONLY_IF_SILENT`, `SPEAKER_SILENT_NO_ID`, `FL2VA_PREFER_SINGLE_SHOT`. Zastosowanie łatki jest taką akcją.
- **Bez skonfigurowanego modelu aplikacja działa w pełni.** Panel LLM jest wtedy wyszarzony z wyjaśnieniem, a żadna inna funkcja nie może się o to potknąć.
- Klucz do endpointu nie trafia do `project.json`, do eksportu ani do odpowiedzi API.
- YAGNI; test, który przeszedłby na zaślepce, to usterka.
- Każdy zapis do modelu idzie przez `normalizeProject` z `web/src/timeline/normalizeProject.ts`.

## Struktura plików

`server/src/llm/`:

| Plik | Odpowiedzialność |
|---|---|
| `settings.ts` | odczyt i zapis ustawień dostawcy poza katalogiem projektu |
| `provider.ts` | wspólny interfejs dostawcy i wybór implementacji |
| `openai.ts` | klient endpointu zgodnego z OpenAI, w tym `/v1/models` |
| `managed.ts` | uruchamianie, sondowanie i zatrzymywanie `llama-server` |
| `run.ts` | pętla zadania: prompt, wymuszony schemat, walidacja, jedna próba naprawy |
| `tasks/` | cztery zadania: `structure.ts`, `redact.ts`, `audio.ts`, `critic.ts` |

`shared/src/patch/`:

| Plik | Odpowiedzialność |
|---|---|
| `types.ts` | `PatchOp`, `ProjectPatch` |
| `apply.ts` | `applyOps(project, ops)` — czysta funkcja |
| `describe.ts` | opis operacji do pokazania w diffie |

`web/src/llm/`: `LlmPanel.tsx`, `PatchReview.tsx`, `useLlmRun.ts`, `settingsApi.ts`.

---

### Task 1: Ustawienia dostawcy

Ustawienia są własnością maszyny, nie projektu: ten sam endpoint obsługuje wszystkie projekty, a klucz nie ma czego szukać w pliku, który użytkownik eksportuje i wysyła dalej.

**Files:**
- Create: `server/src/llm/settings.ts`
- Create: `server/src/routes/llm.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/llm/settings.test.ts`

**Interfaces:**
- Produces:
  - `interface LlmSettings { mode: 'off' | 'endpoint' | 'managed'; endpoint: { baseUrl: string; apiKey: string; model: string }; managed: { serverBinary: string; modelPath: string; gpuLayers: number; contextSize: number } }`
  - `readSettings(dataRoot: string): Promise<LlmSettings>`
  - `writeSettings(dataRoot: string, next: LlmSettings): Promise<void>`
  - `redactSettings(settings: LlmSettings): LlmSettings` — z pustym `apiKey`
  - trasy `GET /api/llm/settings` i `PUT /api/llm/settings`

- [ ] **Krok 1: Napisz testy**

`server/test/llm/settings.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSettings, writeSettings, redactSettings } from '../../src/llm/settings.js'

let root = ''
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mmh3-llm-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('ustawienia LLM', () => {
  it('bez pliku zwraca tryb wyłączony, a nie błąd', async () => {
    const settings = await readSettings(root)
    expect(settings.mode).toBe('off')
  })

  it('zapis i odczyt zachowują wartości', async () => {
    await writeSettings(root, {
      mode: 'endpoint',
      endpoint: { baseUrl: 'http://localhost:1234/v1', apiKey: 'tajne', model: 'qwen' },
      managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 4096 },
    })
    const settings = await readSettings(root)
    expect(settings.endpoint.baseUrl).toBe('http://localhost:1234/v1')
    expect(settings.endpoint.apiKey).toBe('tajne')
  })

  it('uszkodzony plik nie wywraca odczytu — wraca tryb wyłączony', async () => {
    await writeSettings(root, {
      mode: 'endpoint',
      endpoint: { baseUrl: 'http://x/v1', apiKey: '', model: 'm' },
      managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 4096 },
    })
    const path = join(root, 'llm-settings.json')
    await import('node:fs/promises').then(fs => fs.writeFile(path, 'to nie jest JSON'))
    expect((await readSettings(root)).mode).toBe('off')
  })

  it('plik ustawień nie leży w katalogu żadnego projektu', async () => {
    await writeSettings(root, {
      mode: 'off',
      endpoint: { baseUrl: '', apiKey: '', model: '' },
      managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 4096 },
    })
    const raw = await readFile(join(root, 'llm-settings.json'), 'utf8')
    expect(raw.length).toBeGreaterThan(0)
  })

  it('redakcja usuwa klucz i nie rusza reszty', () => {
    const redacted = redactSettings({
      mode: 'endpoint',
      endpoint: { baseUrl: 'http://x/v1', apiKey: 'tajne', model: 'm' },
      managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 4096 },
    })
    expect(redacted.endpoint.apiKey).toBe('')
    expect(redacted.endpoint.baseUrl).toBe('http://x/v1')
  })
})
```

- [ ] **Krok 2: Uruchom i zobacz czerwony**

Run: `npm test --workspace @mmh3/server -- settings`
Expected: FAIL, brak modułu.

- [ ] **Krok 3: Napisz `settings.ts`**

```ts
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'

export const LlmSettingsSchema = z.object({
  mode: z.enum(['off', 'endpoint', 'managed']),
  endpoint: z.object({
    baseUrl: z.string(),
    apiKey: z.string(),
    model: z.string(),
  }),
  managed: z.object({
    serverBinary: z.string(),
    modelPath: z.string(),
    gpuLayers: z.number().int().min(0),
    contextSize: z.number().int().min(512),
  }),
})

export type LlmSettings = z.infer<typeof LlmSettingsSchema>

const DEFAULTS: LlmSettings = {
  mode: 'off',
  endpoint: { baseUrl: '', apiKey: '', model: '' },
  managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 8192 },
}

const settingsPath = (dataRoot: string): string => join(dataRoot, 'llm-settings.json')

/**
 * Ustawienia dostawcy leżą obok katalogu projektów, nie w żadnym z nich.
 * Ten sam endpoint obsługuje wszystkie projekty, a klucz nie ma czego szukać
 * w pliku, który użytkownik eksportuje i wysyła dalej.
 *
 * Uszkodzony plik nie jest błędem krytycznym: aplikacja ma działać w pełni bez
 * skonfigurowanego modelu, więc nieczytelne ustawienia znaczą „wyłączony", a nie
 * „nie da się otworzyć projektu".
 */
export async function readSettings(dataRoot: string): Promise<LlmSettings> {
  try {
    const raw = await readFile(settingsPath(dataRoot), 'utf8')
    const parsed = LlmSettingsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

export async function writeSettings(dataRoot: string, next: LlmSettings): Promise<void> {
  const path = settingsPath(dataRoot)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(LlmSettingsSchema.parse(next), null, 2)}\n`, 'utf8')
}

/** Klucz nigdy nie wychodzi z serwera — ani do przeglądarki, ani do eksportu. */
export function redactSettings(settings: LlmSettings): LlmSettings {
  return { ...settings, endpoint: { ...settings.endpoint, apiKey: '' } }
}
```

- [ ] **Krok 4: Napisz trasy**

`server/src/routes/llm.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { LlmSettingsSchema, readSettings, redactSettings, writeSettings } from '../llm/settings.js'

export function registerLlmRoutes(app: FastifyInstance): void {
  app.get('/api/llm/settings', async () =>
    redactSettings(await readSettings(app.dataRoot)))

  app.put('/api/llm/settings', async (request, reply) => {
    const parsed = LlmSettingsSchema.safeParse(request.body)
    if (!parsed.success) {
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
```

Zarejestruj `registerLlmRoutes(app)` w `server/src/app.ts` obok pozostałych.

- [ ] **Krok 5: Dopisz test trasy**

W tym samym pliku testowym, wzorem `server/test/routes/projects.test.ts` (podpatrz, jak buduje aplikację i podaje `dataRoot`):

```ts
  it('GET nie oddaje klucza', async () => {
    // zapisz ustawienia z kluczem, potem pobierz przez trasę i sprawdź, że
    // apiKey jest pusty, a baseUrl nie
  })

  it('PUT z pustym kluczem zachowuje poprzedni', async () => {
    // zapisz klucz, wyślij PUT bez klucza, odczytaj plik z dysku i sprawdź,
    // że klucz nadal tam jest
  })
```

Napisz oba w pełni, wzorując strukturę na istniejących testach tras.

- [ ] **Krok 6: Uruchom całość i commit**

```bash
npm test && npm run typecheck
git add server/src/llm/settings.ts server/src/routes/llm.ts server/src/app.ts server/test/llm/settings.test.ts
git commit -m "feat: ustawienia dostawcy LLM poza katalogiem projektu"
```

---

### Task 2: Abstrakcja dostawcy i klient endpointu

Jedna abstrakcja, dwie implementacje mówiące tym samym protokołem. To zadanie robi pierwszą — endpoint zgodny z OpenAI — bez strumieniowania; strumieniowanie dokłada zadanie 4.

**Files:**
- Create: `server/src/llm/provider.ts`
- Create: `server/src/llm/openai.ts`
- Modify: `server/src/routes/llm.ts`
- Test: `server/test/llm/openai.test.ts`

**Interfaces:**
- Produces:
  - `interface ChatMessage { role: 'system' | 'user'; content: string }`
  - `interface CompletionRequest { messages: ChatMessage[]; schema: object; maxTokens: number; signal: AbortSignal }`
  - `interface CompletionResult { text: string; promptTokens: number; completionTokens: number }`
  - `interface Provider { listModels(): Promise<string[]>; complete(req: CompletionRequest): Promise<CompletionResult> }`
  - `createProvider(settings: LlmSettings): Provider | null` — `null` przy trybie wyłączonym
  - trasa `GET /api/llm/models`

- [ ] **Krok 1: Napisz testy**

`server/test/llm/openai.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from 'vitest'
import { createOpenAiProvider } from '../../src/llm/openai.js'

const settings = { baseUrl: 'http://model.local/v1', apiKey: 'tajne', model: 'qwen' }

afterEach(() => { vi.restoreAllMocks() })

const mockFetch = (handler: (url: string, init: RequestInit) => Response) =>
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => handler(url, init)))

describe('klient endpointu OpenAI', () => {
  it('listuje modele z /v1/models', async () => {
    mockFetch(() => new Response(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] })))
    expect(await createOpenAiProvider(settings).listModels()).toEqual(['a', 'b'])
  })

  it('wysyła klucz w nagłówku Authorization', async () => {
    let seen = ''
    mockFetch((_url, init) => {
      const headers = new Headers(init.headers)
      seen = headers.get('authorization') ?? ''
      return new Response(JSON.stringify({ data: [] }))
    })
    await createOpenAiProvider(settings).listModels()
    expect(seen).toBe('Bearer tajne')
  })

  it('pomija nagłówek, gdy klucza nie ma — LM Studio go nie wymaga', async () => {
    let hasHeader = true
    mockFetch((_url, init) => {
      hasHeader = new Headers(init.headers).has('authorization')
      return new Response(JSON.stringify({ data: [] }))
    })
    await createOpenAiProvider({ ...settings, apiKey: '' }).listModels()
    expect(hasHeader).toBe(false)
  })

  it('zwraca treść i liczniki tokenów', async () => {
    mockFetch(() => new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 34 },
    })))
    const result = await createOpenAiProvider(settings).complete({
      messages: [{ role: 'user', content: 'x' }],
      schema: { type: 'object' },
      maxTokens: 100,
      signal: new AbortController().signal,
    })
    expect(result.text).toBe('{"ok":true}')
    expect(result.promptTokens).toBe(12)
    expect(result.completionTokens).toBe(34)
  })

  it('brak liczników w odpowiedzi daje zera, a nie NaN', async () => {
    mockFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })))
    const result = await createOpenAiProvider(settings).complete({
      messages: [{ role: 'user', content: 'x' }],
      schema: { type: 'object' },
      maxTokens: 100,
      signal: new AbortController().signal,
    })
    expect(result.promptTokens).toBe(0)
    expect(Number.isNaN(result.completionTokens)).toBe(false)
  })

  it('odpowiedź spoza dwusetki niesie kod i treść w komunikacie', async () => {
    mockFetch(() => new Response('brak modelu', { status: 404 }))
    await expect(createOpenAiProvider(settings).listModels()).rejects.toThrow(/404/)
  })

  it('przekazuje schemat w response_format', async () => {
    let body: unknown = null
    mockFetch((_url, init) => {
      body = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }))
    })
    await createOpenAiProvider(settings).complete({
      messages: [{ role: 'user', content: 'x' }],
      schema: { type: 'object', properties: {} },
      maxTokens: 10,
      signal: new AbortController().signal,
    })
    const parsed = body as { response_format?: { type?: string } }
    expect(parsed.response_format?.type).toBe('json_schema')
  })
})
```

- [ ] **Krok 2: Uruchom i zobacz czerwony**

Run: `npm test --workspace @mmh3/server -- openai`

- [ ] **Krok 3: Napisz `provider.ts` i `openai.ts`**

`provider.ts` trzyma same typy i wybór implementacji:

```ts
import type { LlmSettings } from './settings.js'
import { createOpenAiProvider } from './openai.js'

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface CompletionRequest {
  messages: ChatMessage[]
  /** Schemat JSON wymuszany na odpowiedzi modelu. */
  schema: object
  maxTokens: number
  signal: AbortSignal
}

export interface CompletionResult {
  text: string
  promptTokens: number
  completionTokens: number
}

export interface Provider {
  listModels: () => Promise<string[]>
  complete: (req: CompletionRequest) => Promise<CompletionResult>
}

/**
 * `null` znaczy „model nie jest skonfigurowany". Aplikacja ma działać w pełni
 * bez modelu, więc brak dostawcy nie jest błędem, tylko stanem.
 */
export function createProvider(settings: LlmSettings): Provider | null {
  if (settings.mode === 'endpoint' && settings.endpoint.baseUrl !== '') {
    return createOpenAiProvider(settings.endpoint)
  }
  return null
}
```

`openai.ts`:

```ts
import type { CompletionRequest, CompletionResult, Provider } from './provider.js'

export interface OpenAiSettings {
  baseUrl: string
  apiKey: string
  model: string
}

const headersFor = (apiKey: string): Record<string, string> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  // LM Studio i llama-server nie wymagają klucza. Wysłanie pustego „Bearer "
  // bywa odrzucane, więc nagłówka po prostu nie ma, gdy klucza nie ma.
  if (apiKey !== '') headers['authorization'] = `Bearer ${apiKey}`
  return headers
}

async function readOrThrow(response: Response): Promise<unknown> {
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Model odpowiedział ${response.status}: ${body.slice(0, 200)}`)
  }
  return response.json()
}

export function createOpenAiProvider(settings: OpenAiSettings): Provider {
  const base = settings.baseUrl.replace(/\/+$/, '')

  return {
    async listModels() {
      const payload = await readOrThrow(await fetch(`${base}/models`, {
        headers: headersFor(settings.apiKey),
      }))
      const data = (payload as { data?: Array<{ id?: unknown }> }).data ?? []
      return data
        .map(entry => entry.id)
        .filter((id): id is string => typeof id === 'string')
    },

    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const payload = await readOrThrow(await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: headersFor(settings.apiKey),
        signal: req.signal,
        body: JSON.stringify({
          model: settings.model,
          messages: req.messages,
          max_tokens: req.maxTokens,
          temperature: 0.4,
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'wynik', strict: true, schema: req.schema },
          },
        }),
      }))

      const body = payload as {
        choices?: Array<{ message?: { content?: unknown } }>
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
      }
      const content = body.choices?.[0]?.message?.content
      const count = (value: unknown): number => typeof value === 'number' ? value : 0

      return {
        text: typeof content === 'string' ? content : '',
        promptTokens: count(body.usage?.prompt_tokens),
        completionTokens: count(body.usage?.completion_tokens),
      }
    },
  }
}
```

- [ ] **Krok 4: Dodaj trasę listowania modeli**

W `server/src/routes/llm.ts`:

```ts
  app.get('/api/llm/models', async (_request, reply) => {
    const provider = createProvider(await readSettings(app.dataRoot))
    if (provider === null) return reply.status(409).send({ error: 'Model nie jest skonfigurowany' })
    try {
      return { models: await provider.listModels() }
    } catch (error) {
      return reply.status(502).send({ error: error instanceof Error ? error.message : 'Błąd modelu' })
    }
  })
```

Kod 409, nie 500: brak konfiguracji to stan, nie awaria. Kod 502 dla błędu po stronie modelu odróżnia „twój serwer modelu nie odpowiada" od „nasz serwer się zepsuł".

- [ ] **Krok 5: Uruchom całość i commit**

```bash
npm test && npm run typecheck
git add server/src/llm/provider.ts server/src/llm/openai.ts server/src/routes/llm.ts server/test/llm/openai.test.ts
git commit -m "feat: klient endpointu zgodnego z OpenAI za wspolna abstrakcja dostawcy"
```

---

### Task 3: Zarządzany `llama-server`

Druga implementacja: backend uruchamia proces ze wskazanego pliku `.gguf`, sonduje jego zdrowie, zbiera logi i potrafi go zatrzymać. Po wstaniu rozmawia z nim ten sam klient co w zadaniu 2 — `llama-server` mówi protokołem OpenAI.

**To zadanie uruchamia proces ze ścieżki podanej przez użytkownika.** Aplikacja jest lokalna i jednoosobowa, więc to nie jest podniesienie uprawnień — ale argumenty muszą iść tablicą, nigdy przez powłokę, a ścieżki muszą być sprawdzone przed uruchomieniem.

**Files:**
- Create: `server/src/llm/managed.ts`
- Modify: `server/src/llm/provider.ts`
- Modify: `server/src/routes/llm.ts`
- Test: `server/test/llm/managed.test.ts`

**Interfaces:**
- Produces:
  - `interface ManagedState { status: 'stopped' | 'starting' | 'ready' | 'failed'; logs: string[]; port: number }`
  - `startManaged(settings: LlmSettings['managed']): Promise<ManagedState>`
  - `stopManaged(): Promise<void>`
  - `managedState(): ManagedState`
  - trasy `POST /api/llm/managed/start`, `POST /api/llm/managed/stop`, `GET /api/llm/managed/state`

- [ ] **Krok 1: Napisz testy**

`server/test/llm/managed.test.ts`. Testy nie uruchamiają prawdziwego `llama-server` — sprawdzają walidację wejścia, budowę listy argumentów i sprzątanie. Uruchomienie prawdziwego procesu należy do ręcznego sprawdzenia i jest opisane w raporcie.

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildArgs, validateManaged, startManaged, stopManaged, managedState } from '../../src/llm/managed.js'

let root = ''
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mmh3-managed-')) })
afterEach(async () => { await stopManaged(); await rm(root, { recursive: true, force: true }) })

const settings = (over: Partial<Parameters<typeof validateManaged>[0]> = {}) => ({
  serverBinary: '/usr/bin/true', modelPath: join(root, 'model.gguf'),
  gpuLayers: 20, contextSize: 8192, ...over,
})

describe('walidacja ustawień zarządzanego serwera', () => {
  it('odmawia, gdy plik modelu nie istnieje', async () => {
    await expect(validateManaged(settings())).rejects.toThrow(/model/i)
  })

  it('odmawia, gdy binarka nie istnieje', async () => {
    await writeFile(settings().modelPath, 'x')
    await expect(validateManaged(settings({ serverBinary: '/nie/ma/takiej' }))).rejects.toThrow(/serwer/i)
  })

  it('przyjmuje istniejące ścieżki', async () => {
    await writeFile(settings().modelPath, 'x')
    await expect(validateManaged(settings())).resolves.toBeUndefined()
  })
})

describe('budowa argumentów', () => {
  it('podaje model, warstwy GPU, kontekst i port osobnymi elementami tablicy', () => {
    const args = buildArgs(settings(), 9977)
    expect(args).toContain('--model')
    expect(args[args.indexOf('--model') + 1]).toBe(settings().modelPath)
    expect(args[args.indexOf('--n-gpu-layers') + 1]).toBe('20')
    expect(args[args.indexOf('--ctx-size') + 1]).toBe('8192')
    expect(args[args.indexOf('--port') + 1]).toBe('9977')
  })

  it('ścieżka ze spacją zostaje jednym elementem, nie rozpada się na dwa', () => {
    const args = buildArgs(settings({ modelPath: '/a b/model.gguf' }), 1)
    expect(args).toContain('/a b/model.gguf')
  })

  it('ścieżka z podstępną treścią nie tworzy dodatkowych argumentów', () => {
    const args = buildArgs(settings({ modelPath: '/x; rm -rf /' }), 1)
    expect(args.filter(a => a.includes('rm -rf'))).toHaveLength(1)
  })
})

describe('cykl życia', () => {
  it('stan bez uruchomienia to zatrzymany', () => {
    expect(managedState().status).toBe('stopped')
  })

  it('zatrzymanie bez uruchomienia nie rzuca', async () => {
    await expect(stopManaged()).resolves.toBeUndefined()
  })

  it('proces, który natychmiast kończy, daje stan failed i log', async () => {
    await writeFile(join(root, 'model.gguf'), 'x')
    await startManaged(settings({ serverBinary: '/usr/bin/false' }))
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(managedState().status).toBe('failed')
    expect(managedState().logs.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Krok 2: Uruchom i zobacz czerwony, potem napisz `managed.ts`**

Wymagania implementacji, z uzasadnieniem — napisz kod sam, trzymając się ich:

- `spawn(binary, args)` z tablicą argumentów, **nigdy** `shell: true`. Ścieżka z średnikiem ma być ścieżką, nie poleceniem.
- `validateManaged` sprawdza `stat` obu ścieżek i rzuca komunikatem po polsku mówiącym, której brakuje.
- Port dobierany z zakresu wysokiego (na przykład 9900–9999); zapamiętany w stanie, żeby klient wiedział, dokąd mówić.
- `stdout` i `stderr` trafiają do bufora logów **ograniczonego** — trzymaj ostatnie 200 linii. Nieograniczony bufor rośnie bez końca przy modelu, który dużo mówi.
- Sondowanie zdrowia: `GET /v1/models` na wybranym porcie, co 500 ms, maksymalnie 60 sekund, potem `failed`. Model 30-gigabajtowy wstaje wolno.
- `stopManaged` wysyła `SIGTERM`, czeka do 5 sekund, potem `SIGKILL`. Zabicie bez ostrzeżenia zostawia plik modelu w pamięci na dłużej.
- Wyjście procesu ma być obsłużone także wtedy, gdy nikt nie wołał `stopManaged` — proces potrafi umrzeć sam.
- Stan modułu jest globalny; to jeden serwer na jedną instancję aplikacji i tak ma być. Napisz to w komentarzu, żeby nikt nie próbował robić z tego puli.

- [ ] **Krok 3: Rozszerz `createProvider`**

Tryb `managed` zwraca klienta OpenAI wskazującego na `http://127.0.0.1:<port>/v1` z pustym kluczem, ale **tylko gdy stan to `ready`**. W przeciwnym razie `null` — bo dostawca, który nie odpowiada, to to samo co brak dostawcy, a wołający już umie obsłużyć `null`.

- [ ] **Krok 4: Dodaj trzy trasy**

`POST /api/llm/managed/start` waliduje, uruchamia i zwraca stan. `POST /api/llm/managed/stop` zatrzymuje. `GET /api/llm/managed/state` oddaje stan wraz z logami. Błąd walidacji to 400 z komunikatem; brak trybu `managed` w ustawieniach to 409.

- [ ] **Krok 5: Sprawdź ręcznie i opisz w raporcie**

Jeśli w systemie jest `llama-server` i jakikolwiek plik `.gguf`, uruchom go przez trasę i zapisz w raporcie, co zobaczyłeś. Jeśli nie ma — napisz to wprost. Nie udawaj, że sprawdziłeś.

- [ ] **Krok 6: Uruchom całość i commit**

```bash
npm test && npm run typecheck
git add server/src/llm/managed.ts server/src/llm/provider.ts server/src/routes/llm.ts server/test/llm/managed.test.ts
git commit -m "feat: zarzadzany llama-server z sondowaniem zdrowia i buforem logow"
```

---

### Task 4: Łatka do modelu domeny

Twarda zasada specyfikacji: **LLM nigdy nie pisze tekstu wyjściowego bezpośrednio**. Zwraca listę nazwanych operacji, z których każdą użytkownik przyjmuje albo odrzuca osobno. To zadanie buduje ten typ i jego zastosowanie, zanim powstanie pierwsze zadanie językowe — bo bez niego każde z czterech wymyśliłoby własny kształt wyniku.

**Files:**
- Create: `shared/src/patch/types.ts`
- Create: `shared/src/patch/apply.ts`
- Create: `shared/src/patch/describe.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/test/patch/apply.test.ts`

**Interfaces:**
- Produces:
  - `type PatchOp` — suma operacji, każda z `id: string` i `label: string`
  - `interface ProjectPatch { ops: PatchOp[] }`
  - `applyOps(project: Project, ops: PatchOp[]): Project`
  - `describeOp(op: PatchOp): { before: string; after: string }`

- [ ] **Krok 1: Ustal zbiór operacji**

Cztery zadania językowe potrzebują dokładnie tylu rodzajów:

```ts
export type PatchOp =
  | { kind: 'replaceShots'; id: string; label: string; shots: Shot[] }
  | { kind: 'setShotText'; id: string; label: string; shotId: string; segmentIndex: number; text: string }
  | { kind: 'setAudio'; id: string; label: string; field: 'overallSoundscape' | 'nonDiegeticMusic'; text: string }
  | { kind: 'setStyle'; id: string; label: string; text: string }
  | { kind: 'setSpeakerDescriptor'; id: string; label: string; speakerId: string; field: 'fullDescriptor' | 'shortDescriptor'; text: string }
```

`replaceShots` jest gruba z rozmysłem: zadanie „pomysł → struktura" buduje całą oś od zera i rozbicie tego na kilkanaście drobnych operacji dałoby użytkownikowi wybór, którego nie da się sensownie użyć — przyjęcie połowy nowej struktury zostawia projekt w stanie, jakiego nikt nie chciał. Pozostałe cztery są drobne, bo tam wybiórcze przyjmowanie ma sens: jedno zdanie po angielsku wolno przyjąć, drugie odrzucić.

**Nie ma operacji dopisującej segment do `body`.** Gdyby była, model mógłby wprowadzić obiekt bez segmentu albo segment bez obiektu — dokładnie ta klasa, która kosztowała Plan 4 pięć rund poprawek. `replaceShots` niesie ujęcia w całości, więc obie strony przychodzą razem.

- [ ] **Krok 2: Napisz testy**

`shared/test/patch/apply.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyOps } from '../../src/patch/apply.js'
import { describeOp } from '../../src/patch/describe.js'
import { newProject } from '../fixtures/newProject.js'
import type { PatchOp } from '../../src/patch/types.js'

const project = () => newProject()

describe('applyOps', () => {
  it('pusta lista zwraca ten sam obiekt', () => {
    const p = project()
    expect(applyOps(p, [])).toBe(p)
  })

  it('setAudio zmienia wskazane pole i nie rusza drugiego', () => {
    const next = applyOps(project(), [
      { kind: 'setAudio', id: 'o1', label: 'x', field: 'overallSoundscape', text: 'rain on glass' },
    ])
    expect(next.audio.overallSoundscape).toBe('rain on glass')
    expect(next.audio.nonDiegeticMusic).toBe(project().audio.nonDiegeticMusic)
  })

  it('operacja o nieznanym celu zwraca projekt bez zmian', () => {
    const p = project()
    expect(applyOps(p, [
      { kind: 'setSpeakerDescriptor', id: 'o1', label: 'x', speakerId: 'brak', field: 'fullDescriptor', text: 'y' },
    ])).toBe(p)
  })

  it('operacje stosują się w kolejności', () => {
    const next = applyOps(project(), [
      { kind: 'setStyle', id: 'o1', label: 'x', text: 'pierwszy' },
      { kind: 'setStyle', id: 'o2', label: 'y', text: 'drugi' },
    ])
    expect(next.style).toBe('drugi')
  })

  it('setShotText poza zakresem segmentów nic nie psuje', () => {
    const p = project()
    const shotId = p.shots[0]?.id ?? ''
    expect(applyOps(p, [
      { kind: 'setShotText', id: 'o1', label: 'x', shotId, segmentIndex: 99, text: 'y' },
    ])).toBe(p)
  })

  it('setShotText na segmencie innego rodzaju niż tekst nic nie zmienia', () => {
    // zbuduj ujęcie, którego segment 0 jest kamerą, i sprawdź, że operacja
    // wskazująca ten indeks zwraca projekt bez zmian — model nie ma prawa
    // zamienić segmentu kamery w tekst
  })

  it('replaceShots podmienia całą listę', () => {
    const p = project()
    const shots = [{ ...(p.shots[0] ?? { id: 'a' }), composition: 'nowe' }] as typeof p.shots
    expect(applyOps(p, [{ kind: 'replaceShots', id: 'o1', label: 'x', shots }])[0]).toBeDefined()
  })
})

describe('describeOp', () => {
  it('opisuje zmianę pola dźwięku po obu stronach', () => {
    const op: PatchOp = { kind: 'setAudio', id: 'o1', label: 'x', field: 'overallSoundscape', text: 'nowe' }
    const described = describeOp(op)
    expect(described.after).toContain('nowe')
  })
})
```

Dopisz w pełni test o segmencie innego rodzaju — jest ważniejszy niż wygląda, bo to jedyna operacja, która pisze w środku `body`.

- [ ] **Krok 3: Napisz implementację**

`applyOps` to czysta funkcja bez zależności od `web/`. Zasady:

- Operacja, która niczego nie zmienia, zwraca **ten sam obiekt** — inaczej zastosowanie łatki tworzy pusty wpis w historii cofania.
- `setShotText` pisze tylko wtedy, gdy segment pod wskazanym indeksem ma `kind === 'text'`.
- Żadna operacja nie tworzy ani nie usuwa segmentów.
- `describeOp` zwraca dwa ciągi do pokazania w diffie; dla `replaceShots` niech to będzie liczba ujęć przed i po, bo pokazywanie całej struktury w diffie tekstowym jest nieczytelne.

- [ ] **Krok 4: Uruchom, wyeksportuj z `shared/src/index.ts`, commit**

```bash
npm test --workspace @mmh3/shared -- patch
npm test && npm run typecheck
git add shared/src/patch shared/src/index.ts shared/test/patch
git commit -m "feat: latka do modelu domeny jako lista nazwanych operacji"
```

---

### Task 5: Pętla zadania — schemat, walidacja, jedna próba naprawy

Wspólny bieg dla wszystkich czterech zadań: zbuduj wiadomości, wymuś schemat, zwaliduj odpowiedź Zodem, a przy niezgodności **spróbuj raz** — pokazując modelowi jego własny błąd — i poddaj się przy drugiej.

**Files:**
- Create: `server/src/llm/run.ts`
- Test: `server/test/llm/run.test.ts`

**Interfaces:**
- Produces:
  - `interface TaskDefinition<T> { name: string; schema: z.ZodType<T>; jsonSchema: object; buildMessages: (input: unknown) => ChatMessage[]; maxTokens: number }`
  - `runTask<T>(provider: Provider, task: TaskDefinition<T>, input: unknown, signal: AbortSignal): Promise<{ value: T; promptTokens: number; completionTokens: number; repaired: boolean }>`

- [ ] **Krok 1: Napisz testy**

`server/test/llm/run.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { runTask } from '../../src/llm/run.js'
import type { Provider } from '../../src/llm/provider.js'

const task = {
  name: 'test',
  schema: z.object({ liczba: z.number() }),
  jsonSchema: { type: 'object' },
  buildMessages: () => [{ role: 'user' as const, content: 'x' }],
  maxTokens: 100,
}

const providerReturning = (...texts: string[]): Provider => {
  let call = 0
  return {
    listModels: async () => [],
    complete: vi.fn(async () => {
      const text = texts[Math.min(call, texts.length - 1)] ?? ''
      call += 1
      return { text, promptTokens: 1, completionTokens: 2 }
    }),
  }
}

describe('runTask', () => {
  it('zwraca zwalidowaną wartość przy poprawnej odpowiedzi', async () => {
    const result = await runTask(providerReturning('{"liczba":5}'), task, {}, new AbortController().signal)
    expect(result.value.liczba).toBe(5)
    expect(result.repaired).toBe(false)
  })

  it('sumuje tokeny z obu prób przy naprawie', async () => {
    const result = await runTask(providerReturning('{"liczba":"nie"}', '{"liczba":5}'), task, {}, new AbortController().signal)
    expect(result.repaired).toBe(true)
    expect(result.promptTokens).toBe(2)
    expect(result.completionTokens).toBe(4)
  })

  it('próbuje dokładnie dwa razy, nie trzy', async () => {
    const provider = providerReturning('{"liczba":"nie"}')
    await expect(runTask(provider, task, {}, new AbortController().signal)).rejects.toThrow()
    expect(provider.complete).toHaveBeenCalledTimes(2)
  })

  it('druga próba niesie komunikat błędu z pierwszej', async () => {
    const provider = providerReturning('{"liczba":"nie"}', '{"liczba":5}')
    await runTask(provider, task, {}, new AbortController().signal)
    const second = vi.mocked(provider.complete).mock.calls[1]?.[0]
    const joined = second?.messages.map(m => m.content).join(' ') ?? ''
    expect(joined).toContain('liczba')
  })

  it('odpowiedź, która nie jest JSON-em, też idzie do naprawy', async () => {
    const result = await runTask(providerReturning('to nie JSON', '{"liczba":7}'), task, {}, new AbortController().signal)
    expect(result.value.liczba).toBe(7)
  })

  it('model owijający JSON w płotek z markdownu jest rozumiany', async () => {
    const result = await runTask(providerReturning('```json\n{"liczba":3}\n```'), task, {}, new AbortController().signal)
    expect(result.value.liczba).toBe(3)
  })

  it('przerwanie przekazuje sygnał do dostawcy', async () => {
    const controller = new AbortController()
    const provider = providerReturning('{"liczba":1}')
    await runTask(provider, task, {}, controller.signal)
    expect(vi.mocked(provider.complete).mock.calls[0]?.[0]?.signal).toBe(controller.signal)
  })
})
```

Test o płotku z markdownu jest istotny: modele lokalne notorycznie owijają JSON mimo `response_format`, a wyrzucenie tego na twarz użytkownikowi jako „model odpowiedział niepoprawnie" byłoby myleniem objawu z przyczyną.

- [ ] **Krok 2: Uruchom, zobacz czerwony, napisz `run.ts`**

Wymagania:

- Wytnij płotek ` ```json ` i ` ``` `, jeśli jest, zanim spróbujesz sparsować.
- Przy niepowodzeniu drugiej próby rzuć błędem, którego komunikat zawiera nazwę zadania i pierwsze zdanie błędu walidacji — użytkownik ma wiedzieć, co poszło nie tak, nie tylko że poszło.
- Wiadomość naprawcza cytuje odpowiedź modelu i błąd Zoda, i prosi o sam JSON.
- Tokeny sumują się przez obie próby.

- [ ] **Krok 3: Uruchom całość i commit**

```bash
npm test && npm run typecheck
git add server/src/llm/run.ts server/test/llm/run.test.ts
git commit -m "feat: petla zadania ze schematem i jedna proba naprawy"
```

---

### Task 6: Zadanie „pomysł → struktura ujęć"

Pierwsze z czterech. Wejście: dwa zdania po polsku, tryb i długość. Wyjście: ujęcia z czasami, ruchami kamery, mówcami i dialogami — jako `replaceShots`.

**Files:**
- Create: `server/src/llm/tasks/structure.ts`
- Modify: `server/src/routes/llm.ts`
- Test: `server/test/llm/tasks/structure.test.ts`

**Interfaces:**
- Produces: `structureTask: TaskDefinition<StructureResult>` oraz `structureToPatch(result: StructureResult, project: Project): ProjectPatch`

- [ ] **Krok 1: Ustal schemat wyjścia**

Model nie zwraca `Shot[]` wprost — zwraca opis, z którego serwer buduje ujęcia. Powód: `Shot` niesie `body: Segment[]`, a segmenty odwołują się do identyfikatorów ruchów, mówców i kwestii, których model nie zna i nie ma jak wymyślić spójnie. Niech opisze treść, a identyfikatory nada kod.

```ts
const StructureSchema = z.object({
  shots: z.array(z.object({
    startSeconds: z.number().min(0),
    composition: z.string().min(1),
    action: z.string().min(1),
    cameraMove: z.enum([...CAMERA_MOTIONS]).optional(),
    speaker: z.string().optional(),
    line: z.string().optional(),
  })).min(1).max(12),
})
```

`CAMERA_MOTIONS` bierz z `shared/` — słownik ruchów już tam jest i model musi wybrać z niego, a nie wymyślić własny.

- [ ] **Krok 2: Napisz testy**

Testuj `structureToPatch`, nie rozmowę z modelem — rozmowa jest pokryta przez zadanie 5. Przypadki, każdy w pełni napisany:

- puste `shots` w odpowiedzi dają łatkę bez operacji, a nie ujęcie zerowej długości;
- czasy zamieniają się na milisekundy przyciągnięte do klatki;
- ujęcia wychodzą posortowane i pierwsze zaczyna się od zera, niezależnie od tego, co zwrócił model;
- ruch kamery spoza słownika nie przechodzi przez schemat (`safeParse` zwraca błąd);
- kwestia bez mówcy nie tworzy `DialogueEvent` bez `speakerIds` — to złamałoby schemat i zepsuło autozapis, jak w Planie 4;
- **łatka zastosowana do czystego projektu nie wprowadza diagnostyki** poza przyjętymi wyjątkami: zbuduj projekt, policz diagnostyki przed i po, porównaj zbiory;
- **wynik przechodzi `parseProject`** — bez tego testu Plan 4 wypuścił usterkę, która psuła autozapis na resztę sesji.

- [ ] **Krok 3: Napisz `structure.ts`**

Prompt systemowy po angielsku (bo model pracuje na angielskim materiale), z instrukcją: opisuj obraz, nie nastrój; jedno ujęcie to jedna myśl; nie wymyślaj mówców, których nie ma w projekcie. Wejście użytkownika po polsku idzie bez tłumaczenia — modele wielojęzyczne radzą sobie, a tłumaczenie przez drugi przebieg gubi intencję.

Budowa ujęć: identyfikatory z maksimum istniejących, segmenty tekstowe z `composition` i `action`, segment kamery i dialogu tylko wtedy, gdy model je podał, mówca dopasowany po nazwie do istniejących w projekcie — a gdy nie pasuje do żadnego, kwestia jest pomijana wraz z komentarzem w `label` operacji, żeby użytkownik wiedział, czego nie wzięliśmy.

- [ ] **Krok 4: Dodaj trasę `POST /api/llm/run` z rodzajem zadania**

Jedna trasa dla wszystkich czterech, rozróżniana polem `task`. Zwraca `{ patch, promptTokens, completionTokens, repaired }`. Brak dostawcy to 409.

- [ ] **Krok 5: Uruchom całość i commit**

```bash
npm test && npm run typecheck
git add server/src/llm/tasks/structure.ts server/src/routes/llm.ts server/test/llm/tasks/structure.test.ts
git commit -m "feat: zadanie pomysl do struktury ujec jako latka replaceShots"
```

---

### Task 7: Zadanie „redakcja PL→EN"

Wejście: pojedyncze pole tekstowe z modelu. Wyjście: ten sam sens po angielsku, w konwencji guide'a. **Treść bloku `<d>` jest nietykalna** — kwestia wypowiadana idzie do modelu wideo dosłownie i tłumaczenie jej byłoby zmianą tego, co postać mówi.

**Files:**
- Create: `server/src/llm/tasks/redact.ts`
- Modify: `server/src/routes/llm.ts`
- Test: `server/test/llm/tasks/redact.test.ts`

**Interfaces:**
- Produces: `redactTask: TaskDefinition<{ english: string }>` oraz `redactToPatch(result, target): ProjectPatch`
- `target` wskazuje, co redagujemy: `{ kind: 'style' } | { kind: 'shotText'; shotId: string; segmentIndex: number } | { kind: 'audio'; field: 'overallSoundscape' | 'nonDiegeticMusic' } | { kind: 'speaker'; speakerId: string; field: 'fullDescriptor' | 'shortDescriptor' }`

- [ ] **Krok 1: Napisz testy**

Cztery rodzaje celu dają cztery rodzaje operacji — po jednym teście na każdy, sprawdzającym, że powstaje właściwa operacja ze wskazanym identyfikatorem. Do tego:

- **żaden cel nie wskazuje na blok dialogu** — sprawdź, że typ `target` nie ma takiego wariantu, testem, który to wymusza: zbuduj projekt z kwestią i potwierdź, że `redactToPatch` nie umie wskazać na `DialogueEvent.text`;
- pusty wynik od modelu nie tworzy operacji zastępującej treść pustką;
- wynik identyczny z wejściem nie tworzy operacji w ogóle — nie ma czego przyjmować;
- łatka zastosowana do czystego projektu nie wprowadza diagnostyki poza przyjętymi wyjątkami;
- wynik przechodzi `parseProject`.

- [ ] **Krok 2: Napisz `redact.ts`**

Prompt systemowy mówi, czym jest konwencja guide'a: obraz zamiast nastroju, teraźniejszy czas, konkret zamiast oceny, bez metafor o emocjach. Podaj modelowi jedno pole i nic więcej — im mniej kontekstu, tym mniejsza pokusa dopisywania.

- [ ] **Krok 3: Uruchom całość i commit**

```bash
npm test && npm run typecheck
git add server/src/llm/tasks/redact.ts server/src/routes/llm.ts server/test/llm/tasks/redact.test.ts
git commit -m "feat: redakcja PL do EN jako latka na pojedyncze pole"
```

---

### Task 8: Zadania „podpowiedź audio" i „krytyk"

Dwa zadania w jednym, bo oba czytają cały projekt i oba są krótkie.

**Podpowiedź audio** dostaje treść ujęć i zwraca pejzaż dźwiękowy (1–4 zdania) oraz muzykę (1–3 zdania), **bez słów o nastroju** — guide tego zabrania i walidator to sprawdza.

**Krytyk** dostaje skompilowany prompt i zwraca listę uwag, każdą ze wskaźnikiem na obiekt. Uwagi **nie są łatką** — nie zmieniają modelu, tylko trafiają do osobnej grupy w panelu walidacji, wyraźnie oddzielone od reguł deterministycznych, bo pochodzą z modelu i mogą być bzdurą.

**Files:**
- Create: `server/src/llm/tasks/audio.ts`
- Create: `server/src/llm/tasks/critic.ts`
- Modify: `server/src/routes/llm.ts`
- Test: `server/test/llm/tasks/audio.test.ts`
- Test: `server/test/llm/tasks/critic.test.ts`

**Interfaces:**
- Produces:
  - `audioTask: TaskDefinition<{ soundscape: string; music: string }>` oraz `audioToPatch(result, project): ProjectPatch` — dwie operacje `setAudio`, przyjmowalne osobno
  - `criticTask: TaskDefinition<{ notes: CriticNote[] }>`, gdzie `interface CriticNote { ref: ObjectRef; message: string; severity: 'hint' | 'warning' }`

- [ ] **Krok 1: Napisz testy audio**

- dwie operacje, jedna na pejzaż i jedna na muzykę, każda ze swoim identyfikatorem;
- puste pole w wyniku nie tworzy operacji dla tego pola;
- **wynik przechodzący przez walidator nie odpala `SOUNDSCAPE_*`**: zbuduj projekt, zastosuj łatkę, porównaj zbiory diagnostyk. Jeśli model zwróci zdanie o nastroju, reguła to zgłosi — i tak ma być, bo to uczciwy sygnał, ale test ma pokazać, że **kod** tego nie wprowadza, więc użyj wyniku bez słów o nastroju;
- projekt z pejzażem `N/A` i podpowiedzią niepustą: łatka zmienia `N/A` na treść, więc `SOUNDSCAPE_NA_ONLY_IF_SILENT` może **zniknąć** — sprawdź, że diagnostyki nie przybywa, a ubycie jest w porządku.

- [ ] **Krok 2: Napisz testy krytyka**

- uwaga ze wskaźnikiem na nieistniejący obiekt jest odrzucana, nie pokazywana — model potrafi wymyślić identyfikator;
- uwaga bez treści jest odrzucana;
- severity spoza dwóch dozwolonych wartości nie przechodzi schematu;
- **krytyk nie zwraca łatki** — sprawdź, że typ wyniku nie ma `ops`, testem konstruktywnym: wywołaj `criticToNotes` i potwierdź, że zwraca listę uwag, a nie `ProjectPatch`.

- [ ] **Krok 3: Napisz oba zadania**

Prompt krytyka dostaje skompilowany prompt **oraz** listę identyfikatorów obiektów, na które wolno wskazać. Bez tego model wymyśla identyfikatory i wszystkie uwagi lądują w koszu.

- [ ] **Krok 4: Uruchom całość i commit**

```bash
npm test && npm run typecheck
git add server/src/llm/tasks/audio.ts server/src/llm/tasks/critic.ts server/src/routes/llm.ts server/test/llm/tasks
git commit -m "feat: podpowiedz audio jako latka i krytyk jako osobne uwagi"
```

---

### Task 9: Strumieniowanie z anulowaniem i licznikami

Model lokalny na dużym pliku odpowiada kilkadziesiąt sekund. Bez strumieniowania panel wygląda na zawieszony, a bez anulowania jedyną drogą wyjścia jest przeładowanie strony.

**Files:**
- Modify: `server/src/llm/openai.ts`
- Modify: `server/src/routes/llm.ts`
- Create: `web/src/llm/useLlmRun.ts`
- Test: `server/test/llm/stream.test.ts`
- Test: `web/test/llm/useLlmRun.test.tsx`

**Interfaces:**
- Produces:
  - `Provider.stream(req: CompletionRequest, onChunk: (text: string) => void): Promise<CompletionResult>`
  - trasa `POST /api/llm/run` odpowiada `text/event-stream` ze zdarzeniami `chunk`, `done`, `error`
  - `useLlmRun()` — `{ status, text, patch, tokens, elapsedMs, run, cancel }`

- [ ] **Krok 1: Napisz testy serwera**

- strumień składa się z kawałków rozdzielonych `data: `, a kawałek `[DONE]` kończy;
- kawałek przecięty w pół między dwoma pakietami sieci jest sklejany, a nie gubiony — to najczęstszy błąd w takim kodzie; zbuduj `ReadableStream` oddający `da`, `ta: {"choices"...`, i sprawdź wynik;
- przerwanie sygnałem kończy strumień i nie woła `onChunk` po przerwaniu;
- błąd w środku strumienia daje zdarzenie `error`, nie ciszę.

- [ ] **Krok 2: Napisz testy haka**

- `status` przechodzi `idle → running → done`;
- `cancel` w trakcie daje `status: 'cancelled'` i nie zostawia otwartego połączenia;
- `elapsedMs` rośnie w trakcie i zatrzymuje się na końcu — użyj sterowanego zegara, jak w testach odtwarzania z Planu 3, a nie prawdziwego czasu;
- błąd serwera daje `status: 'error'` z komunikatem, nie pustkę.

- [ ] **Krok 3: Napisz implementację**

Serwer strumieniuje kawałki do przeglądarki na bieżąco, ale **łatkę buduje dopiero po zamknięciu strumienia** — częściowy JSON nie da się zwalidować, a pokazywanie użytkownikowi półgotowej łatki byłoby zapraszaniem do przyjęcia czegoś, co jeszcze nie istnieje. Kawałki służą do pokazania, że coś się dzieje, i do licznika tokenów.

- [ ] **Krok 4: Uruchom całość i commit**

```bash
npm test && npm run typecheck
git add server/src/llm/openai.ts server/src/routes/llm.ts web/src/llm/useLlmRun.ts server/test/llm/stream.test.ts web/test/llm/useLlmRun.test.tsx
git commit -m "feat: strumieniowanie odpowiedzi z anulowaniem i licznikami"
```

---

### Task 10: Panel LLM

Konfiguracja dostawcy, wybór modelu, cztery przyciski zadań, podgląd strumienia, anulowanie, liczniki. **Bez skonfigurowanego modelu panel jest wyszarzony z wyjaśnieniem** i nic poza nim się o to nie potyka.

**Files:**
- Create: `web/src/llm/LlmPanel.tsx`
- Create: `web/src/llm/settingsApi.ts`
- Modify: `web/src/screens/Editor.tsx`
- Modify: `web/src/i18n/dict.ts`
- Test: `web/test/llm/llmPanel.test.tsx`

- [ ] **Krok 1: Dodaj klucze słownika**

Wszystkie widoczne ciągi po polsku i angielsku: tytuł panelu, trzy tryby, etykiety pól, nazwy czterech zadań, „Model nie jest skonfigurowany", „Anuluj", „Tokeny", „Czas", komunikaty stanu zarządzanego serwera.

- [ ] **Krok 2: Napisz testy**

- w trybie wyłączonym cztery przyciski zadań są nieaktywne i widać wyjaśnienie;
- po ustawieniu endpointu przyciski stają się aktywne;
- pole klucza pokazuje pustkę, gdy klucz jest zapisany — i **test sprawdza, że wartość klucza nigdy nie pojawia się w DOM**;
- kliknięcie zadania woła trasę z właściwym rodzajem;
- anulowanie w trakcie przywraca panel do stanu spoczynku;
- błąd z serwera pokazuje się jako komunikat, a nie znika po cichu;
- panel jest sterowalny z klawiatury, a klawisze, które obsługuje, nie wypływają do globalnych skrótów osi czasu — ta klasa błędu trafiła Plan 4 cztery razy.

- [ ] **Krok 3: Napisz panel, wstaw do edytora, uruchom, commit**

```bash
npm test && npm run typecheck
git add web/src/llm web/src/screens/Editor.tsx web/src/i18n/dict.ts web/test/llm/llmPanel.test.tsx
git commit -m "feat: panel LLM z konfiguracja dostawcy i czterema zadaniami"
```

---

### Task 11: Przegląd łatki z wybiórczym przyjmowaniem

Wynik zadania pokazuje się jako lista operacji z opisem „przed" i „po". Użytkownik zaznacza, które przyjmuje, i zatwierdza. **Nic nie stosuje się samo.**

**Files:**
- Create: `web/src/llm/PatchReview.tsx`
- Modify: `web/src/llm/LlmPanel.tsx`
- Modify: `web/src/i18n/dict.ts`
- Test: `web/test/llm/patchReview.test.tsx`

- [ ] **Krok 1: Napisz testy**

- każda operacja ma własne pole wyboru z nazwą pochodzącą z jej `label`;
- domyślnie **żadna nie jest zaznaczona** — przyjęcie jest decyzją, nie brakiem sprzeciwu;
- zatwierdzenie z pustym zaznaczeniem nic nie zmienia i nie zostawia wpisu w historii cofania;
- zatwierdzenie dwóch z trzech operacji stosuje dokładnie te dwie;
- całość idzie przez `normalizeProject` — sprawdź, że łatka podająca ujęcia w złej kolejności ląduje w modelu uporządkowana;
- **jedno zatwierdzenie to jeden wpis historii cofania**, niezależnie od liczby operacji;
- cofnięcie po zatwierdzeniu przywraca stan sprzed;
- zastosowanie łatki nie wprowadza diagnostyki poza przyjętymi wyjątkami;
- wynik przechodzi `parseProject`.

Ostatnie dwa punkty są tu ważniejsze niż gdziekolwiek indziej: to jedyne miejsce w aplikacji, gdzie do modelu trafia treść wymyślona przez model językowy.

- [ ] **Krok 2: Napisz komponent, uruchom, commit**

```bash
npm test && npm run typecheck
git add web/src/llm/PatchReview.tsx web/src/llm/LlmPanel.tsx web/src/i18n/dict.ts web/test/llm/patchReview.test.tsx
git commit -m "feat: przeglad latki z wybiorczym przyjmowaniem operacji"
```

---

### Task 12: Uwagi krytyka w panelu walidacji

Uwagi z modelu trafiają do **osobnej grupy**, wizualnie i strukturalnie oddzielonej od reguł deterministycznych, z podpisem mówiącym skąd pochodzą. Kliknięcie uwagi zaznacza wskazany obiekt, tak samo jak przy diagnostyce reguły.

**Files:**
- Create: `web/src/store/criticStore.ts`
- Modify: `web/src/panels/ValidationPanel.tsx`
- Modify: `web/src/i18n/dict.ts`
- Test: `web/test/panels/criticNotes.test.tsx`

- [ ] **Krok 1: Napisz testy**

- uwagi renderują się w grupie z własnym nagłówkiem, a nie wymieszane z regułami;
- nagłówek mówi, że pochodzą z modelu językowego;
- kliknięcie uwagi zaznacza obiekt z jej `ref` — przez `same`, jak diagnostyka;
- uruchomienie krytyka po raz drugi **zastępuje** poprzednie uwagi, a nie dokłada;
- zmiana projektu **nie kasuje** uwag automatycznie, ale panel oznacza je jako pochodzące ze starszej wersji — uwaga do promptu sprzed pięciu edycji może już nie mieć sensu, a ciche znikanie byłoby gorsze niż widoczna nieaktualność;
- uwagi nie liczą się do licznika błędów blokujących eksport.

Ostatni punkt jest rozstrzygnięciem, nie szczegółem: uwaga modelu nie ma prawa zablokować eksportu, bo model bywa w błędzie, a reguły deterministyczne są dowodliwe.

- [ ] **Krok 2: Napisz implementację, uruchom, commit**

```bash
npm test && npm run typecheck
git add web/src/store/criticStore.ts web/src/panels/ValidationPanel.tsx web/src/i18n/dict.ts web/test/panels/criticNotes.test.tsx
git commit -m "feat: uwagi krytyka w osobnej grupie panelu walidacji"
```

---

### Task 13: Test end-to-end i praca bez modelu

Ostatnie zadanie planu. Sprawdza dwie rzeczy, których nie sprawdzi nic innego: że cała droga od kliknięcia do zmienionego modelu działa w prawdziwej przeglądarce, i że **bez skonfigurowanego modelu aplikacja działa w pełni**.

**Files:**
- Create: `web/e2e/llm.spec.ts`
- Create: `server/test/llm/fakeProvider.ts`
- Test: `web/e2e/llm.spec.ts`

- [ ] **Krok 1: Zbuduj fałszywego dostawcę**

Test e2e nie może zależeć od tego, czy na maszynie stoi model. Postaw w teście mały serwer HTTP mówiący protokołem OpenAI, zwracający ustalone odpowiedzi, i wskaż na niego ustawienia przez trasę `PUT /api/llm/settings`. To sprawdza całą drogę łącznie z parsowaniem i walidacją — a nie sprawdza tylko jakości modelu, która i tak nie jest przedmiotem testu.

- [ ] **Krok 2: Napisz scenariusz**

- świeży projekt, panel LLM wyszarzony, wszystkie cztery przyciski nieaktywne, reszta aplikacji działa: dodaj ujęcie, przeciągnij granicę, wyeksportuj prompt;
- ustaw endpoint na fałszywego dostawcę, przycisk zadania staje się aktywny;
- uruchom „podpowiedź audio", zobacz strumień, doczekaj listy operacji;
- **żadna operacja nie jest zaznaczona domyślnie**, a prompt jest niezmieniony;
- zaznacz jedną, zatwierdź, zobacz zmianę w prompcie i **brak zmiany w drugim polu**;
- cofnij, sprawdź, że prompt wrócił;
- uruchom zadanie ponownie i anuluj w trakcie — panel wraca do spoczynku, prompt bez zmian;
- **projekt zapisuje się przez cały czas** — przeładuj stronę i sprawdź, że przyjęta zmiana przetrwała. Plan 4 wypuścił usterkę, w której autozapis milczkiem padał na resztę sesji; ta asercja jest po to, żeby to się nie powtórzyło.

- [ ] **Krok 3: Uruchom dwa razy pod rząd**

Run: `npm run e2e` (dwukrotnie)
Expected: oba przebiegi zielone. Fałszywy serwer musi się zamykać po teście, inaczej drugi przebieg nie wstanie na tym samym porcie.

- [ ] **Krok 4: Uruchom całość i commit**

```bash
npm test && npm run typecheck && npm run e2e --workspace @mmh3/web
git add web/e2e/llm.spec.ts server/test/llm/fakeProvider.ts
git commit -m "test: droga od zadania LLM do zmienionego modelu w przegladarce"
```

---

## Uwaga o kolejności

Zadania 1–3 budują dostawcę i są od siebie zależne w tej kolejności. Zadanie 4 (łatka) nie zależy od żadnego z nich i może iść równolegle, ale musi poprzedzać 6–8. Zadanie 5 wymaga 2. Zadania 6, 7 i 8 wymagają 4 i 5, i są od siebie niezależne. Zadanie 9 wymaga 2. Zadania 10–12 wymagają 9 oraz odpowiadających im zadań językowych. Zadanie 13 wymaga wszystkiego.

## Czego ten plan nie robi

- Nie dostraja promptów pod konkretny model. Prompty są napisane pod model przestrzegający `response_format`; słabszy będzie częściej trafiał w próbę naprawy.
- Nie zapamiętuje historii rozmów. Każde zadanie to jeden strzał bez kontekstu poprzednich.
- Nie liczy kosztu ani nie ogranicza zużycia. Model jest lokalny, więc koszt to czas, który i tak widać na liczniku.
