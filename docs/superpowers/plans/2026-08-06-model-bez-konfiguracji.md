# Model bez konfiguracji — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplikacja sama znajduje działający model językowy — wykrywa Ollamę i LM Studio na maszynie, pokazuje zużycie VRAM, a gdy nie ma nic, pobiera silnik llama.cpp i wybrany model i konfiguruje je bez udziału użytkownika.

**Architecture:** Trzy niezależne moduły serwera (`discover.ts`, `gpu.ts`, `install.ts`) na wspólnym fundamencie sondowania (`probe.ts`, wyciągniętym z `unload.ts`) i katalogu (`catalog.ts`). Panel dostawcy zyskuje przycisk skanowania, linijkę VRAM odświeżaną co 5 s i ekran instalacji ze strumieniem postępu — tym samym mechanizmem SSE, którym chodzą zadania modelu.

**Tech Stack:** TypeScript (strict), Zod, Fastify 5, React 18 + Zustand, Vitest, Playwright, npm workspaces. Bez nowych zależności: archiwa rozpakowuje systemowy `tar`, kartę czyta `nvidia-smi` — oba uruchamiane przez `spawn`, tak jak `managed.ts` uruchamia `llama-server`.

## Global Constraints

- **Skanowanie wyłącznie `127.0.0.1`.** Sondowanie cudzych adresów z serwera aplikacji to skaner portów, a aplikacja bywa wystawiona na `0.0.0.0`.
- **Wersja llama.cpp jest PRZYPIĘTA** do `b10295`, nigdy „latest": 2026-08-06 najnowsze wydanie (`b10297`) niosło wyłącznie binaria Windows i „latest" wywróciłby się na Linuksie.
- **`null` znaczy „nie wiem", nie zero.** Brak `nvidia-smi` albo nieparsowalne wyjście → `null`, a interfejs nie pokazuje wtedy linijki VRAM w ogóle.
- **Pobieranie rusza wyłącznie po kliknięciu**, z podanym rozmiarem. Nigdy samo.
- **Rozmiary modeli (zmierzone 2026-08-06):** 7B = 4,4 GB, 14B = 8,4 GB, 32B = 19 GB.
- **Katalog `runtime/` stoi OBOK `projects/`**, nie w środku — to nie są dane projektu.
- Komentarze i nazwy testów po polsku; kod i prompty po angielsku. `README.md` po angielsku.
- Domyślny język interfejsu to `en`; `web/test/setup.ts` ustawia `pl` w testach.
- **Każdy nowy test musi paść po cofnięciu kodu, który sprawdza.** W tym repozytorium cztery testy okazały się dotąd bezczynne albo poprawne wobec złej próbki. Krok weryfikacji odwrotnej jest obowiązkowy.
- Komendy: `npm test`, `npm test --workspace @mmh3/server -- <wzorzec>`, `npm run typecheck`, `npm run e2e` (w `web/`).

---

## Struktura plików

| Plik | Odpowiedzialność |
|---|---|
| `server/src/llm/probe.ts` **(nowy)** | `hostUrl` i `probeOk` wyciągnięte z `unload.ts` + `probeJson`. Wspólny fundament sondowania. |
| `server/src/llm/unload.ts` (modyfikacja) | Przestaje być właścicielem sondowania, importuje je. |
| `server/src/llm/discover.ts` **(nowy)** | Skan trzech portów pętli lokalnej, rozpoznanie dostawcy, lista modeli. |
| `server/src/llm/gpu.ts` **(nowy)** | Odczyt karty przez `nvidia-smi`; `null`, gdy się nie da. |
| `server/src/llm/catalog.ts` **(nowy)** | Lista trzech modeli i mapowanie platforma→wydanie llama.cpp. |
| `server/src/llm/install.ts` **(nowy)** | Pobieranie z wznawianiem, rozpakowanie, weryfikacja binarki, zapis ustawień. |
| `server/src/config.ts` (modyfikacja) | `runtimeRoot` + `MMH3_RUNTIME_ROOT`. |
| `server/src/routes/llm.ts` (modyfikacja) | `GET /discover`, `GET /catalog`, `POST /install` (SSE), pole `gpu` w stanie serwera. |
| `web/src/llm/settingsApi.ts` (modyfikacja) | Typy i wywołania trzech nowych tras. |
| `web/src/llm/ProviderDiscovery.tsx` **(nowy)** | Przycisk skanowania i lista znalezionych dostawców. |
| `web/src/llm/ModelInstall.tsx` **(nowy)** | Lista modeli, pasek postępu, przerwanie. |
| `web/src/llm/LlmPanel.tsx` (modyfikacja) | Linijka VRAM, odpytywanie co 5 s, osadzenie obu nowych komponentów. |
| `web/src/i18n/dict.ts` (modyfikacja) | Klucze `discover.*`, `gpu.*`, `install.*` w `pl` i `en`. |

---

### Task 1: Wspólny fundament sondowania — `probe.ts`

Czysty refaktor. Wyciąga z `unload.ts` dwie funkcje, których potrzebuje też wykrywanie dostawców, żeby nie powstała druga kopia sondowania.

**Files:**
- Create: `server/src/llm/probe.ts`
- Modify: `server/src/llm/unload.ts` (usunięcie przeniesionych definicji, import)
- Test: `server/test/llm/probe.test.ts`

**Interfaces:**
- Produces:
  - `hostUrl(baseUrl: string, path: string): string`
  - `probeOk(baseUrl: string, path: string): Promise<boolean>`
  - `probeJson(baseUrl: string, path: string): Promise<unknown | null>`
  - `PROBE_TIMEOUT_MS: number`

- [ ] **Step 1: Napisz test**

Plik `server/test/llm/probe.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { hostUrl, probeJson, probeOk } from '../../src/llm/probe.js'

let server: Server | null = null

const listen = async (handler: (path: string) => { status: number; body?: string }): Promise<string> => {
  server = createServer((req, res) => {
    const { status, body } = handler(req.url ?? '')
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(body ?? '{}')
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server!.address()
  if (address === null || typeof address === 'string') throw new Error('brak portu')
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  if (server !== null) await new Promise(resolve => server!.close(resolve))
  server = null
})

describe('hostUrl', () => {
  it('zastępuje ścieżkę, zapytanie i fragment, zostawiając host', () => {
    expect(hostUrl('http://localhost:1234/v1?a=1#b', '/api/tags'))
      .toBe('http://localhost:1234/api/tags')
  })
})

describe('probeOk', () => {
  it('odpowiedź 200 to true', async () => {
    const base = await listen(() => ({ status: 200 }))
    expect(await probeOk(base, '/api/tags')).toBe(true)
  })

  it('odpowiedź 404 to false, nie wyjątek', async () => {
    const base = await listen(() => ({ status: 404 }))
    expect(await probeOk(base, '/api/tags')).toBe(false)
  })

  it('port, na którym nic nie stoi, to false, nie wyjątek', async () => {
    // Port 1 na pętli lokalnej — uprzywilejowany i pusty w środowisku testowym.
    expect(await probeOk('http://127.0.0.1:1', '/api/tags')).toBe(false)
  })

  it('adres, którego nie da się sparsować, to false', async () => {
    expect(await probeOk('to nie jest adres', '/api/tags')).toBe(false)
  })
})

describe('probeJson', () => {
  it('zwraca sparsowane ciało przy 200', async () => {
    const base = await listen(() => ({ status: 200, body: JSON.stringify({ models: [{ name: 'qwen' }] }) }))
    expect(await probeJson(base, '/api/tags')).toEqual({ models: [{ name: 'qwen' }] })
  })

  it('zwraca null przy 500 i przy ciele, które nie jest JSON-em', async () => {
    const bad = await listen(() => ({ status: 500 }))
    expect(await probeJson(bad, '/api/tags')).toBeNull()
    if (server !== null) await new Promise(resolve => server!.close(resolve))
    const broken = await listen(() => ({ status: 200, body: '{ to nie jest json' }))
    expect(await probeJson(broken, '/api/tags')).toBeNull()
  })
})
```

- [ ] **Step 2: Uruchom test — ma paść**

Run: `npm test --workspace @mmh3/server -- probe`
Expected: FAIL, `Cannot find module '../../src/llm/probe.js'`

- [ ] **Step 3: Utwórz `probe.ts`**

Przenieś z `unload.ts` **bez zmiany treści** (razem z komentarzami) `hostUrl`, `probeOk` i stałą `PROBE_TIMEOUT_MS`, dodaj `probeJson`:

```ts
/**
 * Sondowanie dostawców modeli — wspólny fundament dwóch funkcji, które muszą
 * wiedzieć o dostawcy to samo: wykrywania możliwości zwolnienia pamięci karty
 * (`unload.ts`) i wykrywania serwerów stojących na maszynie (`discover.ts`).
 * Zanim ten moduł powstał, sondowanie mieszkało wewnątrz `unload.ts` — druga
 * funkcja musiałaby je powtórzyć, a wtedy „czy to Ollama" miałoby dwie
 * odpowiedzi, które zgadzają się tylko z oglądu.
 */
export const PROBE_TIMEOUT_MS = 1500

export function hostUrl(baseUrl: string, path: string): string {
  const url = new URL(baseUrl)
  url.pathname = path
  url.search = ''
  url.hash = ''
  return url.toString()
}

/** Sonda, która NIGDY nie rzuca — adres nieprawidłowy, serwer nieistniejący
 *  albo odpowiedź spoza dwusetki wszystkie kończą się tym samym `false`. */
export async function probeOk(baseUrl: string, path: string): Promise<boolean> {
  try {
    const response = await fetch(hostUrl(baseUrl, path), { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    return response.ok
  } catch {
    return false
  }
}

/** To samo, ale zwraca sparsowane ciało. `null` znaczy „nie udało się" i
 *  obejmuje wszystkie powody naraz: brak serwera, kod spoza dwusetki, ciało,
 *  które nie jest JSON-em. Wołający nie ma po co ich rozróżniać — każdy
 *  oznacza „tego dostawcy tu nie ma". */
export async function probeJson(baseUrl: string, path: string): Promise<unknown | null> {
  try {
    const response = await fetch(hostUrl(baseUrl, path), { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Przestaw `unload.ts` na nowy moduł**

Usuń z `unload.ts` przeniesione definicje i dodaj `import { hostUrl, probeOk } from './probe.js'`. Nie zmieniaj niczego innego — `detectUnloadCapability` i `unloadModel` mają zachować dotychczasowe zachowanie.

- [ ] **Step 5: Uruchom testy**

Run: `npm test --workspace @mmh3/server && npm run typecheck`
Expected: PASS, zero błędów typów. Istniejące testy `unload` mają przejść bez zmian.

- [ ] **Step 6: Weryfikacja odwrotna**

W `probeOk` zamień `return response.ok` na `return true` i uruchom `npm test --workspace @mmh3/server -- probe`. Test „404 to false" musi paść. Cofnij.

- [ ] **Step 7: Commit**

```bash
git add server/src/llm/probe.ts server/src/llm/unload.ts server/test/llm/probe.test.ts
git commit -m "refactor: wspolny fundament sondowania dostawcow"
```

---

### Task 2: Wykrywanie serwerów — `discover.ts`

**Files:**
- Create: `server/src/llm/discover.ts`
- Modify: `server/src/routes/llm.ts` (trasa `GET /api/llm/discover`)
- Test: `server/test/llm/discover.test.ts`

**Interfaces:**
- Consumes: `probeJson` z `probe.js` (Task 1)
- Produces:
  - `type ProviderKind = 'ollama' | 'lmstudio' | 'openai'`
  - `interface FoundProvider { kind: ProviderKind; baseUrl: string; models: string[] }`
  - `discoverProviders(ports?: number[]): Promise<FoundProvider[]>`
  - `SCAN_PORTS: readonly number[]` — `[11434, 1234, 8080]`

- [ ] **Step 1: Napisz testy**

Plik `server/test/llm/discover.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { discoverProviders } from '../../src/llm/discover.js'

const servers: Server[] = []

/** Serwer na losowym porcie, odpowiadający 200 tylko na wskazane ścieżki. */
const listenOn = async (routes: Record<string, unknown>): Promise<number> => {
  const server = createServer((req, res) => {
    const body = routes[(req.url ?? '').split('?')[0] ?? '']
    if (body === undefined) { res.writeHead(404); res.end('{}'); return }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('brak portu')
  return address.port
}

afterEach(async () => {
  await Promise.all(servers.map(s => new Promise(resolve => s.close(resolve))))
  servers.length = 0
})

describe('discoverProviders', () => {
  it('rozpoznaje Ollamę po /api/tags i czyta nazwy modeli', async () => {
    const port = await listenOn({ '/api/tags': { models: [{ name: 'qwen2.5:14b' }, { name: 'llama3' }] } })
    const found = await discoverProviders([port])
    expect(found).toHaveLength(1)
    expect(found[0]?.kind).toBe('ollama')
    expect(found[0]?.models).toEqual(['qwen2.5:14b', 'llama3'])
    expect(found[0]?.baseUrl).toBe(`http://127.0.0.1:${port}`)
  })

  it('rozpoznaje LM Studio po /api/v0/models', async () => {
    const port = await listenOn({ '/api/v0/models': { data: [{ id: 'qwen2.5-7b-instruct' }] } })
    const found = await discoverProviders([port])
    expect(found[0]?.kind).toBe('lmstudio')
    expect(found[0]?.models).toEqual(['qwen2.5-7b-instruct'])
  })

  it('serwer odpowiadający WYŁĄCZNIE na /v1/models to „openai", nie Ollama', async () => {
    const port = await listenOn({ '/v1/models': { data: [{ id: 'local-model' }] } })
    const found = await discoverProviders([port])
    expect(found[0]?.kind).toBe('openai')
  })

  it('serwer odpowiadający i na /api/tags, i na /v1/models to OLLAMA — kolejność sond ma znaczenie', async () => {
    // Ollama i LM Studio udają też API OpenAI. Gdyby sonda ogólna szła
    // pierwsza, każdy dostawca nazywałby się „openai" i użytkownik straciłby
    // informację, od której zależy zwalnianie pamięci karty (`unload.ts`).
    const port = await listenOn({
      '/api/tags': { models: [{ name: 'qwen' }] },
      '/v1/models': { data: [{ id: 'qwen' }] },
    })
    const found = await discoverProviders([port])
    expect(found).toHaveLength(1)
    expect(found[0]?.kind).toBe('ollama')
  })

  it('port, na którym nic nie stoi, nie trafia do wyniku', async () => {
    expect(await discoverProviders([1])).toEqual([])
  })

  it('skanuje wszystkie podane porty i zwraca każdy znaleziony', async () => {
    const a = await listenOn({ '/api/tags': { models: [{ name: 'x' }] } })
    const b = await listenOn({ '/api/v0/models': { data: [{ id: 'y' }] } })
    const found = await discoverProviders([a, b, 1])
    expect(found.map(f => f.kind).sort()).toEqual(['lmstudio', 'ollama'])
  })

  it('dostawca bez czytelnej listy modeli i tak jest zgłoszony, z pustą listą', async () => {
    const port = await listenOn({ '/api/tags': { cokolwiek: true } })
    const found = await discoverProviders([port])
    expect(found[0]?.kind).toBe('ollama')
    expect(found[0]?.models).toEqual([])
  })
})
```

- [ ] **Step 2: Uruchom — mają paść**

Run: `npm test --workspace @mmh3/server -- discover`
Expected: FAIL, brak modułu

- [ ] **Step 3: Napisz `discover.ts`**

```ts
import { probeJson } from './probe.js'

export type ProviderKind = 'ollama' | 'lmstudio' | 'openai'

export interface FoundProvider {
  kind: ProviderKind
  baseUrl: string
  models: string[]
}

/** Porty domyślne trzech dostawców, których naprawdę spotyka się na maszynie
 *  deweloperskiej. Lista jest parametrem `discoverProviders`, żeby test mógł
 *  podstawić porty losowe zamiast zajmować te prawdziwe. */
export const SCAN_PORTS: readonly number[] = [11434, 1234, 8080]

const names = (value: unknown, key: 'name' | 'id', field: 'models' | 'data'): string[] => {
  if (typeof value !== 'object' || value === null) return []
  const list = (value as Record<string, unknown>)[field]
  if (!Array.isArray(list)) return []
  return list
    .map(item => (typeof item === 'object' && item !== null ? (item as Record<string, unknown>)[key] : null))
    .filter((name): name is string => typeof name === 'string')
}

/**
 * KOLEJNOŚĆ MA ZNACZENIE. Ollama i LM Studio wystawiają także API zgodne z
 * OpenAI, więc `/v1/models` odpowiada u wszystkich trzech. Gdyby sonda ogólna
 * szła pierwsza, każdy dostawca zostałby nazwany „openai" — a rozpoznanie
 * Ollamy jest tym, od czego zależy, czy da się zwolnić pamięć karty bez
 * zabijania procesu (`unload.ts`). Ogólna sonda jest ostatnią deską ratunku.
 */
const SIGNATURES = [
  { kind: 'ollama' as const, path: '/api/tags', read: (j: unknown) => names(j, 'name', 'models') },
  { kind: 'lmstudio' as const, path: '/api/v0/models', read: (j: unknown) => names(j, 'id', 'data') },
  { kind: 'openai' as const, path: '/v1/models', read: (j: unknown) => names(j, 'id', 'data') },
]

async function identify(port: number): Promise<FoundProvider | null> {
  const baseUrl = `http://127.0.0.1:${port}`
  for (const signature of SIGNATURES) {
    const body = await probeJson(baseUrl, signature.path)
    if (body === null) continue
    return { kind: signature.kind, baseUrl, models: signature.read(body) }
  }
  return null
}

/**
 * Skan WYŁĄCZNIE pętli lokalnej. Sondowanie cudzych adresów z serwera
 * aplikacji jest skanerem portów, nie wygodą — a ta aplikacja bywa wystawiona
 * na `0.0.0.0` bez uwierzytelniania.
 */
export async function discoverProviders(ports: readonly number[] = SCAN_PORTS): Promise<FoundProvider[]> {
  const found = await Promise.all(ports.map(identify))
  return found.filter((provider): provider is FoundProvider => provider !== null)
}
```

- [ ] **Step 4: Dodaj trasę**

W `server/src/routes/llm.ts`, obok `GET /api/llm/models`:

```ts
  app.get('/api/llm/discover', async () => ({ found: await discoverProviders() }))
```

z importem `import { discoverProviders } from '../llm/discover.js'`.

- [ ] **Step 5: Uruchom — mają przejść**

Run: `npm test --workspace @mmh3/server && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Weryfikacja odwrotna**

Odwróć kolejność w `SIGNATURES` (przenieś wpis `openai` na początek) i uruchom `npm test --workspace @mmh3/server -- discover`. Test „i na /api/tags, i na /v1/models to OLLAMA" musi paść. Cofnij.

- [ ] **Step 7: Commit**

```bash
git add server/src/llm/discover.ts server/src/routes/llm.ts server/test/llm/discover.test.ts
git commit -m "feat: wykrywanie lokalnych serwerow modeli"
```

---

### Task 3: Odczyt karty — `gpu.ts`

**Files:**
- Create: `server/src/llm/gpu.ts`
- Modify: `server/src/llm/managed.ts` (pole `gpu` w `ManagedState`) i `server/src/routes/llm.ts`
- Test: `server/test/llm/gpu.test.ts`

**Interfaces:**
- Produces:
  - `interface GpuInfo { name: string; usedMb: number; totalMb: number }`
  - `readGpu(command?: string): Promise<GpuInfo | null>`
  - `parseGpuLine(line: string): GpuInfo | null`

- [ ] **Step 1: Napisz testy**

Plik `server/test/llm/gpu.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseGpuLine, readGpu } from '../../src/llm/gpu.js'

describe('parseGpuLine', () => {
  it('parsuje prawdziwe wyjście nvidia-smi', () => {
    // Zmierzone na 154.54.100.218 (RTX PRO 6000 Blackwell), format
    // `--format=csv,noheader,nounits`.
    expect(parseGpuLine('NVIDIA RTX PRO 6000 Blackwell Server Edition, 10651, 97887'))
      .toEqual({ name: 'NVIDIA RTX PRO 6000 Blackwell Server Edition', usedMb: 10651, totalMb: 97887 })
  })

  it('nazwa karty z przecinkiem nie rozwala podziału', () => {
    // Ostatnie DWA pola to liczby; wszystko przed nimi jest nazwą.
    expect(parseGpuLine('NVIDIA GeForce RTX 4090, Founders, 1024, 24564'))
      .toEqual({ name: 'NVIDIA GeForce RTX 4090, Founders', usedMb: 1024, totalMb: 24564 })
  })

  it('wyjście bez liczb to null, nie zera', () => {
    expect(parseGpuLine('[N/A], [N/A], [N/A]')).toBeNull()
    expect(parseGpuLine('')).toBeNull()
    expect(parseGpuLine('NVIDIA, 10651')).toBeNull()
  })
})

describe('readGpu', () => {
  it('brak polecenia to null, nie wyjątek', async () => {
    expect(await readGpu('polecenie-ktorego-nie-ma-nigdzie')).toBeNull()
  })

  it('polecenie kończące się błędem to null', async () => {
    expect(await readGpu('false')).toBeNull()
  })
})
```

- [ ] **Step 2: Uruchom — mają paść**

Run: `npm test --workspace @mmh3/server -- gpu`
Expected: FAIL, brak modułu

- [ ] **Step 3: Napisz `gpu.ts`**

```ts
import { spawn } from 'node:child_process'

export interface GpuInfo {
  name: string
  usedMb: number
  totalMb: number
}

const QUERY = ['--query-gpu=name,memory.used,memory.total', '--format=csv,noheader,nounits']

/**
 * Ostatnie DWA pola to liczby, wszystko przed nimi to nazwa. Podział po
 * przecinku z założeniem trzech pól psuje się na kartach, których nazwa sama
 * zawiera przecinek — a nazwy pochodzą od producenta, nie od nas.
 */
export function parseGpuLine(line: string): GpuInfo | null {
  const parts = line.split(',').map(part => part.trim())
  if (parts.length < 3) return null
  const totalMb = Number(parts[parts.length - 1])
  const usedMb = Number(parts[parts.length - 2])
  const name = parts.slice(0, -2).join(', ')
  if (!Number.isFinite(totalMb) || !Number.isFinite(usedMb) || name === '') return null
  return { name, usedMb, totalMb }
}

/**
 * `null` znaczy „nie wiem" i obejmuje wszystkie powody naraz: brak
 * `nvidia-smi`, kod wyjścia inny niż zero, wyjście, którego nie da się
 * sparsować. Interfejs na `null` nie pokazuje linijki VRAM w ogóle — zero
 * udające pomiar jest gorsze niż brak pomiaru (ta sama zasada, którą
 * `useLlmRun` stosuje do liczników tokenów).
 *
 * Nazwa polecenia jest parametrem, żeby test mógł podstawić polecenie
 * nieistniejące i kończące się błędem, nie polegając na tym, czy maszyna
 * testowa ma kartę NVIDIA.
 */
export async function readGpu(command = 'nvidia-smi'): Promise<GpuInfo | null> {
  return new Promise(resolve => {
    let out = ''
    let settled = false
    const done = (value: GpuInfo | null): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const proc = spawn(command, QUERY)
      proc.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString() })
      proc.on('error', () => done(null))
      proc.on('exit', code => {
        if (code !== 0) return done(null)
        const first = out.split('\n').find(line => line.trim() !== '')
        done(first === undefined ? null : parseGpuLine(first))
      })
    } catch {
      done(null)
    }
  })
}
```

- [ ] **Step 4: Dołóż `gpu` do stanu serwera**

W `server/src/llm/managed.ts` rozszerz `ManagedState`:

```ts
export interface ManagedState {
  status: 'stopped' | 'starting' | 'ready' | 'failed'
  logs: string[]
  port: number
  /** `null`, gdy karty nie da się odczytać — patrz `gpu.ts`. */
  gpu: GpuInfo | null
}
```

Trasa `GET /api/llm/managed/state` w `server/src/routes/llm.ts` dokłada odczyt:

```ts
  app.get('/api/llm/managed/state', async () => ({ ...managedState(), gpu: await readGpu() }))
```

Odczyt robi TRASA, nie `managedState()`: stan zarządzanego procesu jest synchroniczny i tylko o procesie, a karta to osobny pomiar, który dotyczy także trybu `endpoint`.

- [ ] **Step 5: Uruchom — mają przejść**

Run: `npm test --workspace @mmh3/server && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Weryfikacja odwrotna**

W `parseGpuLine` zamień `parts.slice(0, -2)` na `parts[0]` (czyli `name = parts[0] ?? ''`) i uruchom `npm test --workspace @mmh3/server -- gpu`. Test o nazwie z przecinkiem musi paść. Cofnij.

- [ ] **Step 7: Commit**

```bash
git add server/src/llm/gpu.ts server/src/llm/managed.ts server/src/routes/llm.ts server/test/llm/gpu.test.ts
git commit -m "feat: odczyt zuzycia pamieci karty"
```

---

### Task 4: Linijka VRAM w panelu

**Files:**
- Modify: `web/src/llm/settingsApi.ts` (pole `gpu` w `ManagedState`)
- Modify: `web/src/llm/LlmPanel.tsx` (linijka + odpytywanie co 5 s)
- Modify: `web/src/i18n/dict.ts`
- Test: `web/test/llm/gpuLine.test.tsx`

**Interfaces:**
- Consumes: `GET /api/llm/managed/state` z polem `gpu` (Task 3)

- [ ] **Step 1: Dodaj klucze tłumaczeń**

W `web/src/i18n/dict.ts`, w obu obiektach obok istniejących `llm.*`:

```ts
  // pl
  'llm.gpuLine': 'VRAM {used} / {total} GB',
  // en
  'llm.gpuLine': 'VRAM {used} / {total} GB',
```

Tekst jest identyczny w obu językach — to liczby i jednostka. Klucz istnieje mimo to, żeby test parytetu słownika (`web/test/i18n.test.tsx`) obejmował go tak samo jak resztę, a przyszła zmiana formatu miała jedno miejsce.

- [ ] **Step 2: Napisz test**

Plik `web/test/llm/gpuLine.test.tsx`. Pomocnik `routedFetch` i `json` skopiuj z `web/test/llm/unloadButton.test.tsx:16-30`.

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { LlmPanel } from '../../src/llm/LlmPanel.js'

// --- `json` i `routedFetch` skopiowane z unloadButton.test.tsx:16-30 ---

const settings = {
  mode: 'endpoint',
  endpoint: { baseUrl: 'http://localhost:1234/v1', apiKey: '', model: 'qwen' },
  managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 8192 },
}

const handlers = (gpu: unknown) => ({
  'GET /api/llm/settings': () => json(settings),
  'GET /api/llm/managed/state': () => json({ status: 'stopped', logs: [], port: 0, gpu }),
  'GET /api/llm/unload/capability': () => json({ capability: 'none' }),
})

afterEach(() => { vi.unstubAllGlobals() })

describe('LlmPanel — linijka VRAM', () => {
  it('pokazuje nazwę karty i pamięć w gigabajtach', async () => {
    vi.stubGlobal('fetch', routedFetch(handlers({
      name: 'NVIDIA RTX PRO 6000', usedMb: 10651, totalMb: 97887,
    })))
    render(<LlmPanel />)

    expect(await screen.findByText(/NVIDIA RTX PRO 6000/)).toBeInTheDocument()
    // 10651 MiB ≈ 10,4 GB, 97887 MiB ≈ 95,6 GB.
    expect(await screen.findByText(/10[.,]4 \/ 95[.,]6 GB/)).toBeInTheDocument()
  })

  it('gdy karty nie da się odczytać, NIE pokazuje linijki ani zer', async () => {
    vi.stubGlobal('fetch', routedFetch(handlers(null)))
    render(<LlmPanel />)

    await screen.findByText(/provider settings|ustawienia dostawcy/i)
    expect(screen.queryByText(/VRAM/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/0 \/ 0/)).not.toBeInTheDocument()
  })

  it('odpytuje stan ponownie, więc liczba się odświeża', async () => {
    let calls = 0
    vi.stubGlobal('fetch', routedFetch({
      ...handlers({ name: 'GPU', usedMb: 1024, totalMb: 8192 }),
      'GET /api/llm/managed/state': () => {
        calls += 1
        return json({
          status: 'stopped', logs: [], port: 0,
          gpu: { name: 'GPU', usedMb: calls === 1 ? 1024 : 4096, totalMb: 8192 },
        })
      },
    }))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<LlmPanel />)

    expect(await screen.findByText(/1[.,]0 \/ 8[.,]0 GB/)).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(5_000)
    await waitFor(() => {
      expect(screen.getByText(/4[.,]0 \/ 8[.,]0 GB/)).toBeInTheDocument()
    })
    vi.useRealTimers()
  })
})
```

- [ ] **Step 3: Uruchom — mają paść**

Run: `npm test --workspace @mmh3/web -- gpuLine`
Expected: FAIL — panel nie renderuje linijki

- [ ] **Step 4: Dodaj pole do typu i odpytywanie**

W `web/src/llm/settingsApi.ts`:

```ts
export interface GpuInfo { name: string; usedMb: number; totalMb: number }

export interface ManagedState {
  status: 'stopped' | 'starting' | 'ready' | 'failed'
  logs: string[]
  port: number
  gpu: GpuInfo | null
}
```

W `LlmPanel.tsx` zamień jednorazowe pobranie stanu na odpytywanie:

```ts
  /**
   * Stan serwera odpytujemy CYKLICZNIE, bo linijka VRAM ma pokazywać zmianę:
   * wzrost po starcie modelu i spadek po kliknięciu „Zwolnij pamięć karty".
   * Wcześniej stan pobierał się dokładnie raz, przy montowaniu — dla samego
   * statusu to wystarczało, dla pomiaru nie.
   *
   * Gdy odczyt karty wraca `null`, przestajemy odpytywać: maszyna bez NVIDII
   * nie ma powodu uruchamiać nieistniejącego polecenia co pięć sekund do końca
   * życia panelu.
   */
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = (): void => {
      settingsApi.getManagedState()
        .then(state => {
          if (cancelled) return
          setManaged(state)
          if (state.gpu !== null) timer = setTimeout(tick, GPU_POLL_MS)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          setManagedStateError(error instanceof Error ? error.message : String(error))
        })
    }
    tick()
    return () => { cancelled = true; if (timer !== null) clearTimeout(timer) }
  }, [])
```

ze stałą `const GPU_POLL_MS = 5_000` obok pozostałych stałych modułu. Usuń poprzednie, jednorazowe wywołanie `settingsApi.getManagedState()` z efektu montującego — ma zostać jedno miejsce, które ten stan pobiera.

Renderowanie linijki, w sekcji ustawień dostawcy pod przełącznikiem trybu:

```tsx
        {managed.gpu !== null && (
          <p className="text-[11px] text-neutral-400">
            {managed.gpu.name} · {t('llm.gpuLine', {
              used: (managed.gpu.usedMb / 1024).toFixed(1),
              total: (managed.gpu.totalMb / 1024).toFixed(1),
            })}
          </p>
        )}
```

- [ ] **Step 5: Uruchom — mają przejść**

Run: `npm test --workspace @mmh3/web && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Weryfikacja odwrotna**

Zamień warunek `managed.gpu !== null` na `true` (renderuj zawsze, z zerami przy braku danych) → test „nie pokazuje linijki ani zer" musi paść. Następnie usuń `setTimeout(tick, GPU_POLL_MS)` → test odświeżania musi paść. Cofnij po każdym.

- [ ] **Step 7: Commit**

```bash
git add web/src/llm/settingsApi.ts web/src/llm/LlmPanel.tsx web/src/i18n/dict.ts web/test/llm/gpuLine.test.tsx
git commit -m "feat: linijka zuzycia VRAM odswiezana co 5 sekund"
```

---

### Task 5: Katalog modeli i wydań — `catalog.ts`

**Files:**
- Create: `server/src/llm/catalog.ts`
- Modify: `server/src/config.ts` (`runtimeRoot`)
- Modify: `server/src/routes/llm.ts` (trasa `GET /api/llm/catalog`)
- Test: `server/test/llm/catalog.test.ts`

**Interfaces:**
- Produces:
  - `interface CatalogModel { id: string; label: string; fileName: string; url: string; bytes: number; vramMb: number }`
  - `MODELS: readonly CatalogModel[]`
  - `DEFAULT_MODEL_ID: string` — `'qwen2.5-14b-q4km'`
  - `LLAMA_RELEASE: string` — `'b10295'`
  - `interface EngineAsset { name: string; url: string; archive: 'tar' | 'zip' }`
  - `engineAssetFor(platform: string, arch: string): EngineAsset | null`
- Consumes w Task 6/7: `config.runtimeRoot`

- [ ] **Step 1: Napisz testy**

Plik `server/test/llm/catalog.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_MODEL_ID, engineAssetFor, LLAMA_RELEASE, MODELS } from '../../src/llm/catalog.js'

describe('MODELS', () => {
  it('trzy pozycje, każda z rozmiarem i wymaganym VRAM', () => {
    expect(MODELS).toHaveLength(3)
    for (const model of MODELS) {
      expect(model.bytes).toBeGreaterThan(1e9)
      expect(model.vramMb).toBeGreaterThan(0)
      expect(model.url.startsWith('https://huggingface.co/')).toBe(true)
      expect(model.fileName.endsWith('.gguf')).toBe(true)
    }
  })

  it('domyślny model istnieje w katalogu', () => {
    expect(MODELS.some(model => model.id === DEFAULT_MODEL_ID)).toBe(true)
  })

  it('identyfikatory są unikalne', () => {
    expect(new Set(MODELS.map(m => m.id)).size).toBe(MODELS.length)
  })
})

describe('engineAssetFor', () => {
  it('Linux dostaje wariant Vulkan — działa na NVIDII bez toolkitu CUDA', () => {
    expect(engineAssetFor('linux', 'x64')?.name)
      .toBe(`llama-${LLAMA_RELEASE}-bin-ubuntu-vulkan-x64.tar.gz`)
    expect(engineAssetFor('linux', 'arm64')?.name)
      .toBe(`llama-${LLAMA_RELEASE}-bin-ubuntu-vulkan-arm64.tar.gz`)
  })

  it('macOS i Windows dostają swoje warianty', () => {
    expect(engineAssetFor('darwin', 'arm64')?.name)
      .toBe(`llama-${LLAMA_RELEASE}-bin-macos-arm64.tar.gz`)
    expect(engineAssetFor('darwin', 'x64')?.name)
      .toBe(`llama-${LLAMA_RELEASE}-bin-macos-x64.tar.gz`)
    expect(engineAssetFor('win32', 'x64')?.name)
      .toBe(`llama-${LLAMA_RELEASE}-bin-win-cpu-x64.zip`)
  })

  it('nieobsługiwana kombinacja to null — nie pobieramy 200 MB czegoś, co nie ruszy', () => {
    expect(engineAssetFor('win32', 'arm64')).toBeNull()
    expect(engineAssetFor('freebsd', 'x64')).toBeNull()
  })

  it('adres wskazuje PRZYPIĘTE wydanie, nie „latest"', () => {
    // 2026-08-06 najnowsze wydanie llama.cpp niosło WYŁĄCZNIE binaria Windows,
    // więc „latest" wywróciłby pobieranie na Linuksie.
    const asset = engineAssetFor('linux', 'x64')
    expect(asset?.url).toContain(`/download/${LLAMA_RELEASE}/`)
    expect(asset?.url).not.toContain('latest')
  })
})
```

- [ ] **Step 2: Uruchom — mają paść**

Run: `npm test --workspace @mmh3/server -- catalog`
Expected: FAIL, brak modułu

- [ ] **Step 3: Napisz `catalog.ts`**

```ts
/**
 * Lista kuratorowana zamiast pola na URL — wzorzec przeniesiony ze słownika
 * `CAPTIONERS` w `ideogram4-flux2-lora-studio` (`backend/captioner.py`), gdzie
 * użytkownik wybiera opisaną pozycję, a nie wkleja adresu. Rozmiary poniżej są
 * ZMIERZONE nagłówkiem HTTP 2026-08-06, nie przepisane z opisu repozytorium.
 */
export interface CatalogModel {
  id: string
  label: string
  fileName: string
  url: string
  bytes: number
  /** Ile pamięci karty potrzeba, żeby model zmieścił się w całości. */
  vramMb: number
}

const hf = (repo: string, file: string): string =>
  `https://huggingface.co/bartowski/${repo}/resolve/main/${file}`

export const MODELS: readonly CatalogModel[] = [
  {
    id: 'qwen2.5-7b-q4km',
    label: 'Qwen2.5 7B Instruct Q4_K_M',
    fileName: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    url: hf('Qwen2.5-7B-Instruct-GGUF', 'Qwen2.5-7B-Instruct-Q4_K_M.gguf'),
    bytes: 4_700_000_000,
    vramMb: 6_144,
  },
  {
    id: 'qwen2.5-14b-q4km',
    label: 'Qwen2.5 14B Instruct Q4_K_M',
    fileName: 'Qwen2.5-14B-Instruct-Q4_K_M.gguf',
    url: hf('Qwen2.5-14B-Instruct-GGUF', 'Qwen2.5-14B-Instruct-Q4_K_M.gguf'),
    bytes: 8_988_110_976,
    vramMb: 11_264,
  },
  {
    id: 'qwen2.5-32b-q4km',
    label: 'Qwen2.5 32B Instruct Q4_K_M',
    fileName: 'Qwen2.5-32B-Instruct-Q4_K_M.gguf',
    url: hf('Qwen2.5-32B-Instruct-GGUF', 'Qwen2.5-32B-Instruct-Q4_K_M.gguf'),
    bytes: 19_900_000_000,
    vramMb: 22_528,
  },
]

/** Ten model przeszedł wszystkie testy prozy na serwerze 2026-08-05 i 08-06. */
export const DEFAULT_MODEL_ID = 'qwen2.5-14b-q4km'

/**
 * Wersja PRZYPIĘTA, nigdy „latest". 2026-08-06 najnowsze wydanie llama.cpp
 * (`b10297`) niosło wyłącznie binaria Windows — pobieranie „latest" wywróciłoby
 * się na Linuksie. Podniesienie tej stałej ma być świadomą zmianą w kodzie, nie
 * loterią zależną od dnia.
 */
export const LLAMA_RELEASE = 'b10295'

export interface EngineAsset {
  name: string
  url: string
  archive: 'tar' | 'zip'
}

const ASSETS: Record<string, string> = {
  'linux:x64': 'ubuntu-vulkan-x64.tar.gz',
  'linux:arm64': 'ubuntu-vulkan-arm64.tar.gz',
  'darwin:arm64': 'macos-arm64.tar.gz',
  'darwin:x64': 'macos-x64.tar.gz',
  'win32:x64': 'win-cpu-x64.zip',
}

/**
 * Linux dostaje wariant VULKAN, nie `ubuntu-x64`: ten drugi jest wyłącznie CPU,
 * a Vulkan działa na NVIDII bez instalowania toolkitu CUDA — sprawdzone wprost
 * na RTX PRO 6000 Blackwell (`llama-server --list-devices` widzi kartę).
 *
 * Windows dostaje wariant CPU świadomie: warianty CUDA wymagają DRUGIEGO
 * pobrania (`cudart-llama-bin-win-cuda-*.zip`), a bez maszyny z Windows nie da
 * się sprawdzić, czy złożenie obu działa. Obiecywanie akceleracji, której nikt
 * nie zweryfikował, byłoby zgadywaniem.
 */
export function engineAssetFor(platform: string, arch: string): EngineAsset | null {
  const suffix = ASSETS[`${platform}:${arch}`]
  if (suffix === undefined) return null
  const name = `llama-${LLAMA_RELEASE}-bin-${suffix}`
  return {
    name,
    url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_RELEASE}/${name}`,
    archive: suffix.endsWith('.zip') ? 'zip' : 'tar',
  }
}
```

- [ ] **Step 4: Dodaj `runtimeRoot` do konfiguracji**

W `server/src/config.ts`, obok `dataRoot`:

```ts
  // Katalog na pobrane pliki stoi OBOK `projects/`, nie w środku: silnik i
  // modele nie są danymi projektu i nie mają wędrować przy kopiowaniu katalogu
  // projektu ani trafiać do kopii zapasowej razem z nim.
  const runtimeRoot = env.MMH3_RUNTIME_ROOT ?? join(home, 'mmh3-studio', 'runtime')
```

i dołóż `runtimeRoot` do zwracanego obiektu oraz do typu `Config`. Udostępnij je aplikacji tak samo, jak udostępniony jest `dataRoot` (`app.dataRoot` w `server/src/app.ts` — dodaj `app.runtimeRoot` tym samym wzorcem).

- [ ] **Step 5: Dodaj trasę katalogu**

```ts
  app.get('/api/llm/catalog', async () => ({
    models: MODELS,
    engine: engineAssetFor(process.platform, process.arch),
  }))
```

- [ ] **Step 6: Uruchom — mają przejść**

Run: `npm test --workspace @mmh3/server && npm run typecheck`
Expected: PASS

- [ ] **Step 7: Weryfikacja odwrotna**

Zamień `LLAMA_RELEASE` na `'latest'` i uruchom `npm test --workspace @mmh3/server -- catalog`. Test o przypiętym wydaniu musi paść. Cofnij.

- [ ] **Step 8: Commit**

```bash
git add server/src/llm/catalog.ts server/src/config.ts server/src/app.ts server/src/routes/llm.ts server/test/llm/catalog.test.ts
git commit -m "feat: katalog modeli i wydan silnika, przypieta wersja"
```

---

### Task 6: Pobieranie z wznawianiem — `install.ts`

**Files:**
- Create: `server/src/llm/install.ts`
- Test: `server/test/llm/install.test.ts`

**Interfaces:**
- Consumes: `MODELS`, `engineAssetFor`, `EngineAsset` (Task 5)
- Produces:
  - `interface InstallProgress { stage: 'engine' | 'model'; received: number; total: number }`
  - `downloadWithResume(url: string, target: string, onProgress: (received: number, total: number) => void, signal: AbortSignal): Promise<void>`
  - `ensureFreeSpace(dir: string, needBytes: number): Promise<void>` — rzuca z komunikatem, gdy za mało
  - `findExecutable(dir: string, name: string): Promise<string | null>`
  - `verifyEngine(binary: string): Promise<boolean>`

- [ ] **Step 1: Napisz testy**

Plik `server/test/llm/install.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import {
  downloadWithResume, ensureFreeSpace, extractArchive, findExecutable, verifyEngine,
} from '../../src/llm/install.js'

let root: string
let server: Server | null = null
const BODY = Buffer.from('0123456789abcdefghij')

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mmh3-install-')) })

afterEach(async () => {
  if (server !== null) await new Promise(resolve => server!.close(resolve))
  server = null
  await rm(root, { recursive: true, force: true })
})

/** Serwer, który obsługuje `Range` — jak HuggingFace. `seen` zbiera nagłówki,
 *  żeby test mógł dowieść, że wznowienie NAPRAWDĘ poprosiło o zakres. */
const listen = async (seen: string[]): Promise<string> => {
  server = createServer((req, res) => {
    const range = req.headers.range
    seen.push(range ?? '(brak)')
    if (typeof range === 'string') {
      const from = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0)
      const slice = BODY.subarray(from)
      res.writeHead(206, {
        'content-length': String(slice.length),
        'content-range': `bytes ${from}-${BODY.length - 1}/${BODY.length}`,
      })
      res.end(slice)
      return
    }
    res.writeHead(200, { 'content-length': String(BODY.length) })
    res.end(BODY)
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server!.address()
  if (address === null || typeof address === 'string') throw new Error('brak portu')
  return `http://127.0.0.1:${address.port}/plik.bin`
}

describe('downloadWithResume', () => {
  it('pobiera plik w całości i zgłasza postęp', async () => {
    const seen: string[] = []
    const url = await listen(seen)
    const target = join(root, 'plik.bin')
    const progress: number[] = []

    await downloadWithResume(url, target, received => progress.push(received), new AbortController().signal)

    expect(await readFile(target)).toEqual(BODY)
    expect(progress.at(-1)).toBe(BODY.length)
    expect(seen[0]).toBe('(brak)')
  })

  it('nie zostawia pliku tymczasowego po sukcesie', async () => {
    const url = await listen([])
    const target = join(root, 'plik.bin')
    await downloadWithResume(url, target, () => {}, new AbortController().signal)
    await expect(stat(`${target}.part`)).rejects.toThrow()
  })

  it('wznawia od miejsca przerwania zamiast pobierać od nowa', async () => {
    const seen: string[] = []
    const url = await listen(seen)
    const target = join(root, 'plik.bin')
    // Połowa pliku już na dysku — dokładnie stan po restarcie maszyny w trakcie
    // pobierania, który zdarzył się przy stawianiu serwera 2026-08-06.
    await writeFile(`${target}.part`, BODY.subarray(0, 10))

    await downloadWithResume(url, target, () => {}, new AbortController().signal)

    expect(seen[0]).toBe('bytes=10-')
    expect(await readFile(target)).toEqual(BODY)
  })

  it('przerwanie sygnałem zostawia część pobraną do wznowienia', async () => {
    const url = await listen([])
    const target = join(root, 'plik.bin')
    const controller = new AbortController()
    controller.abort()

    await expect(downloadWithResume(url, target, () => {}, controller.signal)).rejects.toThrow()
    await expect(stat(target)).rejects.toThrow()
  })
})

describe('ensureFreeSpace', () => {
  it('przepuszcza, gdy miejsca jest dużo', async () => {
    await expect(ensureFreeSpace(root, 1024)).resolves.toBeUndefined()
  })

  it('odmawia PRZED pobraniem, gdy miejsca brak, i podaje obie liczby', async () => {
    await expect(ensureFreeSpace(root, Number.MAX_SAFE_INTEGER))
      .rejects.toThrow(/miejsca/i)
  })
})

describe('findExecutable', () => {
  it('znajduje plik w podkatalogu rozpakowanego wydania', async () => {
    await mkdir(join(root, 'llama-b10295'), { recursive: true })
    await writeFile(join(root, 'llama-b10295', 'llama-server'), '#!/bin/sh\n')
    expect(await findExecutable(root, 'llama-server'))
      .toBe(join(root, 'llama-b10295', 'llama-server'))
  })

  it('zwraca null, gdy pliku nie ma', async () => {
    expect(await findExecutable(root, 'llama-server')).toBeNull()
  })
})

describe('extractArchive', () => {
  it('rozpakowuje archiwum i USUWA je po sobie', async () => {
    // Archiwum budujemy systemowym `tar`, tym samym, którym je rozpakujemy —
    // test sprawdza nasze wywołanie, nie implementację tara.
    const src = join(root, 'src')
    await mkdir(src, { recursive: true })
    await writeFile(join(src, 'llama-server'), 'binarka')
    const archive = join(root, 'wydanie.tar.gz')
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('tar', ['-czf', archive, '-C', src, '.'])
      proc.on('exit', code => (code === 0 ? resolve() : reject(new Error(`tar ${String(code)}`))))
    })

    const into = join(root, 'engine')
    await extractArchive(archive, into)

    expect(await readFile(join(into, 'llama-server'), 'utf8')).toBe('binarka')
    // Archiwum zajmuje kilkaset megabajtów — zostawienie go po rozpakowaniu
    // podwaja miejsce zajęte przez silnik bez żadnego powodu.
    await expect(stat(archive)).rejects.toThrow()
  })

  it('uszkodzone archiwum kończy się błędem, nie cichym sukcesem', async () => {
    const archive = join(root, 'zepsute.tar.gz')
    await writeFile(archive, 'to nie jest archiwum')
    await expect(extractArchive(archive, join(root, 'engine'))).rejects.toThrow()
  })
})

describe('verifyEngine', () => {
  it('binarka, która kończy się zerem, przechodzi', async () => {
    expect(await verifyEngine('/bin/true')).toBe(true)
  })

  it('binarka, która się nie uruchamia, NIE przechodzi', async () => {
    // Weryfikacja istnieje właśnie po to: przy ręcznym stawianiu skopiowana
    // sama binarka bez bibliotek obok nie startowała, a wyszło to dopiero przy
    // pierwszym zadaniu użytkownika.
    expect(await verifyEngine(join(root, 'nie-ma-takiego-pliku'))).toBe(false)
  })
})
```

- [ ] **Step 2: Uruchom — mają paść**

Run: `npm test --workspace @mmh3/server -- install`
Expected: FAIL, brak modułu

- [ ] **Step 3: Napisz `install.ts`**

```ts
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface InstallProgress {
  stage: 'engine' | 'model'
  received: number
  total: number
}

/** Zapas ponad rozmiar pobrania. Zapełnienie dysku w połowie 19 GB jest gorsze
 *  niż niezaczęcie pobierania. */
const FREE_SPACE_MARGIN = 1_073_741_824

export async function ensureFreeSpace(dir: string, needBytes: number): Promise<void> {
  await mkdir(dir, { recursive: true })
  const fs = await statfs(dir)
  const free = fs.bavail * fs.bsize
  const need = needBytes + FREE_SPACE_MARGIN
  if (free < need) {
    const gb = (bytes: number): string => (bytes / 1e9).toFixed(1)
    throw new Error(`Za mało miejsca: potrzeba ${gb(need)} GB, wolne ${gb(free)} GB`)
  }
}

/**
 * Pobieranie do pliku `.part` i `rename` na koniec — ten sam powód co w
 * `projectStore.ts`: przerwanie nie ma zostawić pliku, który wygląda na
 * kompletny.
 *
 * Wznawianie nie jest ostrożnością na zapas. Przy stawianiu serwera 2026-08-06
 * maszyna zrestartowała się w połowie 8,4 GB; bez nagłówka `Range` całe
 * pobieranie zaczynałoby się od zera.
 */
export async function downloadWithResume(
  url: string,
  target: string,
  onProgress: (received: number, total: number) => void,
  signal: AbortSignal,
): Promise<void> {
  const part = `${target}.part`
  let already = 0
  try {
    already = (await stat(part)).size
  } catch {
    already = 0
  }

  const headers: Record<string, string> = {}
  if (already > 0) headers.range = `bytes=${already}-`

  const response = await fetch(url, { headers, signal })
  if (!response.ok) throw new Error(`Pobieranie nie powiodło się: ${response.status}`)
  if (response.body === null) throw new Error('Odpowiedź bez treści')

  // Serwer, który zignorował `Range` i odpowiedział 200, wysyła plik OD ZERA —
  // dopisanie tego do istniejącego ogona dałoby plik uszkodzony.
  const resuming = response.status === 206
  const total = Number(response.headers.get('content-length') ?? 0) + (resuming ? already : 0)
  let received = resuming ? already : 0

  const sink = createWriteStream(part, { flags: resuming ? 'a' : 'w' })
  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  source.on('data', (chunk: Buffer) => {
    received += chunk.length
    onProgress(received, total)
  })
  await pipeline(source, sink)
  await rename(part, target)
}

/** Szuka pliku w rozpakowanym wydaniu. Wydanie llama.cpp trzyma binarki w
 *  podkatalogu z nazwą wersji, a jego układ nie jest gwarantowany między
 *  wydaniami — szukamy zamiast zgadywać ścieżkę. */
export async function findExecutable(dir: string, name: string): Promise<string | null> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return path
    if (entry.isDirectory()) {
      const found = await findExecutable(path, name)
      if (found !== null) return found
    }
  }
  return null
}

/**
 * Uruchomienie `--version` jako dowód, że binarka NAPRAWDĘ działa na tej
 * maszynie. Przy ręcznym stawianiu serwera skopiowałem samą binarkę bez
 * bibliotek stojących obok niej i nie uruchamiała się — a wyszło to dopiero
 * przy pierwszym zadaniu użytkownika. Dlatego rozpakowujemy CAŁE wydanie i
 * sprawdzamy je od razu.
 */
export async function verifyEngine(binary: string): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    const done = (value: boolean): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const proc = spawn(binary, ['--version'])
      proc.on('error', () => done(false))
      proc.on('exit', code => done(code === 0))
    } catch {
      done(false)
    }
  })
}

/** Rozpakowanie systemowym `tar`. Windows 10+ dostarcza `tar.exe` (bsdtar),
 *  który radzi sobie także z archiwami ZIP — dzięki temu nie dokładamy
 *  zależności tylko po to, żeby raz rozpakować archiwum. */
export async function extractArchive(archive: string, into: string): Promise<void> {
  await mkdir(into, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('tar', ['-xf', archive, '-C', into])
    proc.on('error', reject)
    proc.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`Rozpakowanie nie powiodło się (kod ${String(code)})`))
    })
  })
  await rm(archive, { force: true })
}
```

- [ ] **Step 4: Uruchom — mają przejść**

Run: `npm test --workspace @mmh3/server -- install`
Expected: PASS (13 testów)

- [ ] **Step 5: Weryfikacja odwrotna — trzy osobne**

1. Usuń nagłówek `Range` (`headers` zawsze puste) → test wznawiania musi paść.
2. Zamień `rename(part, target)` na kopiowanie bez usuwania `.part` → test „nie zostawia pliku tymczasowego" musi paść.
3. W `verifyEngine` zwróć zawsze `true` → test o binarce, która się nie uruchamia, musi paść.

Cofnij po każdym sprawdzeniu.

- [ ] **Step 6: Commit**

```bash
git add server/src/llm/install.ts server/test/llm/install.test.ts
git commit -m "feat: pobieranie z wznawianiem, rozpakowanie i weryfikacja silnika"
```

---

### Task 7: Trasa instalacji ze strumieniem postępu

**Files:**
- Modify: `server/src/llm/install.ts` (orkiestracja `installEngineAndModel`)
- Modify: `server/src/routes/llm.ts` (`POST /api/llm/install`)
- Test: `server/test/routes/install.test.ts`

**Interfaces:**
- Consumes: wszystko z Tasków 5 i 6; `writeSettings` z `server/src/llm/settings.js`
- Produces: `installEngineAndModel(opts: { runtimeRoot: string; dataRoot: string; modelId: string; onProgress: (p: InstallProgress) => void; signal: AbortSignal }): Promise<{ serverBinary: string; modelPath: string }>`

- [ ] **Step 1: Napisz orkiestrację**

W `install.ts`:

```ts
/**
 * Kolejność jest celowa: najpierw silnik, potem model. Silnik waży ~200 MB, a
 * model do 19 GB — jeśli coś ma nie wyjść (nieobsługiwana platforma, binarka,
 * która się nie uruchamia), lepiej, żeby wyszło po dwustu megabajtach niż po
 * dziewiętnastu gigabajtach.
 */
export async function installEngineAndModel(opts: {
  runtimeRoot: string
  dataRoot: string
  modelId: string
  onProgress: (progress: InstallProgress) => void
  signal: AbortSignal
}): Promise<{ serverBinary: string; modelPath: string }> {
  const model = MODELS.find(candidate => candidate.id === opts.modelId)
  if (model === undefined) throw new Error(`Nie znam modelu "${opts.modelId}"`)

  const asset = engineAssetFor(process.platform, process.arch)
  if (asset === null) {
    throw new Error(
      `Brak gotowego silnika dla ${process.platform}/${process.arch}. `
      + 'Pobierz llama.cpp ręcznie i wskaż binarkę w ustawieniach.',
    )
  }

  const engineDir = join(opts.runtimeRoot, 'engine')
  const modelsDir = join(opts.runtimeRoot, 'models')

  let serverBinary = await findExecutable(engineDir, ENGINE_BINARY)
  if (serverBinary === null) {
    await ensureFreeSpace(engineDir, 400_000_000)
    const archive = join(engineDir, asset.name)
    await downloadWithResume(asset.url, archive, (received, total) => {
      opts.onProgress({ stage: 'engine', received, total })
    }, opts.signal)
    await extractArchive(archive, engineDir)
    serverBinary = await findExecutable(engineDir, ENGINE_BINARY)
    if (serverBinary === null) throw new Error('W pobranym wydaniu nie ma llama-server')
    await chmod(serverBinary, 0o755)
  }

  if (!await verifyEngine(serverBinary)) {
    throw new Error('Pobrany llama-server nie uruchamia się na tej maszynie')
  }

  const modelPath = join(modelsDir, model.fileName)
  if (!await exists(modelPath)) {
    await ensureFreeSpace(modelsDir, model.bytes)
    await downloadWithResume(model.url, modelPath, (received, total) => {
      opts.onProgress({ stage: 'model', received, total })
    }, opts.signal)
  }

  // Ustawienia zapisujemy DOPIERO tutaj — po weryfikacji silnika i po
  // kompletnym pobraniu modelu. Zapis wcześniej zostawiłby konfigurację
  // wskazującą na pliki, których nie ma albo które nie działają.
  const settings = await readSettings(opts.dataRoot)
  await writeSettings(opts.dataRoot, {
    ...settings,
    mode: 'managed',
    managed: { ...settings.managed, serverBinary, modelPath, gpuLayers: 99, contextSize: 8192 },
  })

  return { serverBinary, modelPath }
}
```

ze stałą `const ENGINE_BINARY = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'`, pomocnikiem `exists` (`stat` w `try`/`catch`) oraz importami `chmod` z `node:fs/promises`, `MODELS`/`engineAssetFor` z `./catalog.js` i `readSettings`/`writeSettings` z `./settings.js`.

- [ ] **Step 2: Napisz test trasy**

Plik `server/test/routes/install.test.ts`. Pomocniki `buildApp` i rozcinanie SSE skopiuj z `server/test/routes/llmChat.test.ts`.

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { readSettings } from '../../src/llm/settings.js'

let root: string
let app: FastifyInstance

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-install-route-'))
  app = await buildApp({ dataRoot: root })
})

afterEach(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('POST /api/llm/install', () => {
  it('nieznany model odrzucany jest kodem 400, zanim cokolwiek się pobierze', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/llm/install', payload: { modelId: 'nie-ma-takiego' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('ciało bez modelId to 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/llm/install', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('nieudana instalacja NIE zapisuje ustawień', async () => {
    // Adres wydania wskazuje port, na którym nic nie stoi — pobranie silnika
    // pada, a ustawienia mają zostać nietknięte.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('brak sieci') }))
    const before = await readSettings(root)

    const res = await app.inject({
      method: 'POST', url: '/api/llm/install', payload: { modelId: 'qwen2.5-14b-q4km' },
    })
    expect(res.payload).toContain('event: error')
    expect(await readSettings(root)).toEqual(before)
  })
})

describe('GET /api/llm/catalog', () => {
  it('zwraca trzy modele i wskazanie silnika dla tej platformy', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/llm/catalog' })
    expect(res.statusCode).toBe(200)
    expect(res.json().models).toHaveLength(3)
    // Środowisko testowe to Linux x64 — gdyby plan uruchamiano gdzie indziej,
    // `engine` może być `null` i to też jest poprawna odpowiedź.
    expect(res.json()).toHaveProperty('engine')
  })
})

describe('GET /api/llm/discover', () => {
  it('odpowiada listą, także pustą, bez błędu', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/llm/discover' })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json().found)).toBe(true)
  })
})
```

- [ ] **Step 3: Uruchom — mają paść**

Run: `npm test --workspace @mmh3/server -- install.test`
Expected: FAIL — trasa nie istnieje

- [ ] **Step 4: Dodaj trasę**

W `server/src/routes/llm.ts`:

```ts
  const InstallBody = z.object({ modelId: z.string().min(1) })

  app.post('/api/llm/install', async (request, reply) => {
    const parsed = InstallBody.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Żądanie niezgodne ze schematem' })
    if (!MODELS.some(model => model.id === parsed.data.modelId)) {
      return reply.status(400).send({ error: `Nie znam modelu "${parsed.data.modelId}"` })
    }

    // Ten sam układ co `POST /api/llm/run`: sprawdzenia zwracające 4xx MUSZĄ
    // rozstrzygnąć się PRZED `reply.hijack()`, bo po przejęciu odpowiedzi nie da
    // się już ustawić kodu ani nagłówków.
    const { signal, release } = abortSignalFor(request)
    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    })
    reply.raw.flushHeaders()

    const send = (event: 'progress' | 'done' | 'error', data: unknown): void => {
      if (signal.aborted) return
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      const result = await installEngineAndModel({
        runtimeRoot: app.runtimeRoot,
        dataRoot: app.dataRoot,
        modelId: parsed.data.modelId,
        onProgress: progress => send('progress', progress),
        signal,
      })
      send('done', result)
    } catch (error) {
      send('error', { error: error instanceof Error ? error.message : 'Instalacja nie powiodła się' })
    } finally {
      release()
      reply.raw.end()
    }
  })
```

- [ ] **Step 5: Uruchom — mają przejść**

Run: `npm test --workspace @mmh3/server && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Weryfikacja odwrotna**

Przenieś zapis ustawień na początek `installEngineAndModel` (przed pobraniem silnika) → test „nieudana instalacja NIE zapisuje ustawień" musi paść. Cofnij.

- [ ] **Step 7: Commit**

```bash
git add server/src/llm/install.ts server/src/routes/llm.ts server/test/routes/install.test.ts
git commit -m "feat: trasa instalacji silnika i modelu ze strumieniem postepu"
```

---

### Task 8: Interfejs — wykrywanie i instalacja

**Files:**
- Create: `web/src/llm/ProviderDiscovery.tsx`
- Create: `web/src/llm/ModelInstall.tsx`
- Modify: `web/src/llm/settingsApi.ts`, `web/src/llm/LlmPanel.tsx`, `web/src/i18n/dict.ts`
- Test: `web/test/llm/discovery.test.tsx`, `web/test/llm/modelInstall.test.tsx`

**Interfaces:**
- Consumes: `GET /api/llm/discover`, `GET /api/llm/catalog`, `POST /api/llm/install` (SSE)
- Produces: `ProviderDiscovery({ onPick })`, `ModelInstall({ freeVramMb })`

- [ ] **Step 1: Dodaj klucze tłumaczeń**

W `web/src/i18n/dict.ts`, w obu słownikach:

```ts
  // pl
  'llm.discoverScan': 'Szukaj lokalnych serwerów',
  'llm.discoverScanning': 'Szukam…',
  'llm.discoverNone': 'Nie znaleziono żadnego serwera modeli na tej maszynie.',
  'llm.discoverUse': 'Użyj',
  'llm.discoverModels': '{count} modeli',
  'llm.installTitle': 'Pobierz model',
  'llm.installHint': 'Nie masz jeszcze modelu. Aplikacja pobierze silnik i wybrany model, i skonfiguruje je sama.',
  'llm.installStart': 'Pobierz i skonfiguruj',
  'llm.installCancel': 'Przerwij',
  'llm.installEngine': 'Silnik',
  'llm.installModel': 'Model',
  'llm.installDone': 'Gotowe. Kliknij „Uruchom serwer”.',
  'llm.installTooBig': 'Więcej niż wolny VRAM — zadziała, ale wolniej.',
  'llm.installNoEngine': 'Dla tego systemu nie mamy gotowego silnika. Pobierz llama.cpp ręcznie i wskaż binarkę.',

  // en
  'llm.discoverScan': 'Find local servers',
  'llm.discoverScanning': 'Searching…',
  'llm.discoverNone': 'No model server found on this machine.',
  'llm.discoverUse': 'Use',
  'llm.discoverModels': '{count} models',
  'llm.installTitle': 'Download a model',
  'llm.installHint': 'You have no model yet. The app will download the engine and the model you pick, and configure both for you.',
  'llm.installStart': 'Download and configure',
  'llm.installCancel': 'Cancel',
  'llm.installEngine': 'Engine',
  'llm.installModel': 'Model',
  'llm.installDone': 'Done. Click "Start server".',
  'llm.installTooBig': 'Larger than free VRAM — it will work, but slower.',
  'llm.installNoEngine': 'No prebuilt engine for this system. Download llama.cpp yourself and point the app at the binary.',
```

- [ ] **Step 2: Napisz testy wykrywania**

Plik `web/test/llm/discovery.test.tsx` (pomocniki `json`/`routedFetch` jak w Tasku 4):

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProviderDiscovery } from '../../src/llm/ProviderDiscovery.js'

// --- `json` i `routedFetch` skopiowane z unloadButton.test.tsx:16-30 ---

afterEach(() => { vi.unstubAllGlobals() })

describe('ProviderDiscovery', () => {
  it('po skanie pokazuje znalezione serwery z liczbą modeli', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/llm/discover': () => json({
        found: [{ kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', models: ['a', 'b'] }],
      }),
    }))
    render(<ProviderDiscovery onPick={() => {}} />)

    await user.click(screen.getByRole('button', { name: /szukaj lokalnych serwerów/i }))

    expect(await screen.findByText(/ollama/i)).toBeInTheDocument()
    expect(await screen.findByText(/2 modeli/)).toBeInTheDocument()
  })

  it('brak wyników to zdanie, nie błąd', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', routedFetch({ 'GET /api/llm/discover': () => json({ found: [] }) }))
    render(<ProviderDiscovery onPick={() => {}} />)

    await user.click(screen.getByRole('button', { name: /szukaj lokalnych serwerów/i }))
    expect(await screen.findByText(/nie znaleziono żadnego serwera/i)).toBeInTheDocument()
  })

  it('kliknięcie „Użyj" oddaje adres znalezionego serwera', async () => {
    const user = userEvent.setup()
    const picked: string[] = []
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/llm/discover': () => json({
        found: [{ kind: 'lmstudio', baseUrl: 'http://127.0.0.1:1234', models: ['x'] }],
      }),
    }))
    render(<ProviderDiscovery onPick={base => picked.push(base)} />)

    await user.click(screen.getByRole('button', { name: /szukaj lokalnych serwerów/i }))
    await user.click(await screen.findByRole('button', { name: /użyj/i }))

    expect(picked).toEqual(['http://127.0.0.1:1234'])
  })
})
```

- [ ] **Step 3: Napisz testy instalacji**

Plik `web/test/llm/modelInstall.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelInstall } from '../../src/llm/ModelInstall.js'

// --- `json` i `routedFetch` skopiowane z unloadButton.test.tsx:16-30 ---

const catalog = {
  models: [
    { id: 'm7', label: 'Qwen2.5 7B', fileName: 'a.gguf', url: 'u', bytes: 4_700_000_000, vramMb: 6_144 },
    { id: 'm14', label: 'Qwen2.5 14B', fileName: 'b.gguf', url: 'u', bytes: 8_988_110_976, vramMb: 11_264 },
  ],
  engine: { name: 'llama-b10295-bin-ubuntu-vulkan-x64.tar.gz', url: 'u', archive: 'tar' },
}

const sse = (lines: string): Response =>
  new Response(lines, { headers: { 'content-type': 'text/event-stream' } })

afterEach(() => { vi.unstubAllGlobals() })

describe('ModelInstall', () => {
  it('pokazuje rozmiar każdego modelu, żeby decyzja o 9 GB była świadoma', async () => {
    vi.stubGlobal('fetch', routedFetch({ 'GET /api/llm/catalog': () => json(catalog) }))
    render(<ModelInstall freeVramMb={null} />)

    expect(await screen.findByText(/4[.,]7 GB/)).toBeInTheDocument()
    expect(await screen.findByText(/9[.,]0 GB/)).toBeInTheDocument()
  })

  it('ostrzega przy modelu większym niż wolny VRAM, ale go nie blokuje', async () => {
    vi.stubGlobal('fetch', routedFetch({ 'GET /api/llm/catalog': () => json(catalog) }))
    render(<ModelInstall freeVramMb={8_192} />)

    expect(await screen.findByText(/wolny VRAM/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pobierz i skonfiguruj/i })).toBeEnabled()
  })

  it('pokazuje postęp z podziałem na etapy', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/llm/catalog': () => json(catalog),
      'POST /api/llm/install': () => sse(
        `event: progress\ndata: ${JSON.stringify({ stage: 'engine', received: 50, total: 100 })}\n\n`
        + `event: progress\ndata: ${JSON.stringify({ stage: 'model', received: 25, total: 100 })}\n\n`
        + `event: done\ndata: {}\n\n`,
      ),
    }))
    render(<ModelInstall freeVramMb={null} />)

    await user.click(await screen.findByRole('button', { name: /pobierz i skonfiguruj/i }))

    expect(await screen.findByText(/gotowe/i)).toBeInTheDocument()
  })

  it('gdy dla tego systemu nie ma silnika, mówi to zamiast oferować pobranie', async () => {
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/llm/catalog': () => json({ ...catalog, engine: null }),
    }))
    render(<ModelInstall freeVramMb={null} />)

    expect(await screen.findByText(/nie mamy gotowego silnika/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pobierz i skonfiguruj/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Uruchom — mają paść**

Run: `npm test --workspace @mmh3/web -- "discovery|modelInstall"`
Expected: FAIL, brak modułów

- [ ] **Step 5: Napisz komponenty i wepnij je w panel**

**`ProviderDiscovery.tsx`** — trzy stany i lista wyników:

```tsx
export function ProviderDiscovery({ onPick }: { onPick: (baseUrl: string) => void }) {
  const t = useT()
  const [state, setState] = useState<'idle' | 'scanning' | 'done'>('idle')
  const [found, setFound] = useState<FoundProvider[]>([])

  const scan = (): void => {
    setState('scanning')
    void settingsApi.discover()
      .then(res => { setFound(res.found); setState('done') })
      // Nieudany skan kończy się pustą listą, nie komunikatem błędu: „nic nie
      // znalazłem" i „nie udało mi się poszukać" prowadzą użytkownika do tego
      // samego następnego kroku — skonfigurować dostawcę ręcznie.
      .catch(() => { setFound([]); setState('done') })
  }

  return (
    <div className="flex flex-col gap-1">
      <ActionButton
        label={state === 'scanning' ? t('llm.discoverScanning') : t('llm.discoverScan')}
        onClick={scan}
        disabled={state === 'scanning'}
      />
      {state === 'done' && found.length === 0 && (
        <span className="text-[11px] text-neutral-500">{t('llm.discoverNone')}</span>
      )}
      {found.map(provider => (
        <div key={provider.baseUrl} className="flex items-center justify-between gap-2 text-xs">
          <span>{provider.kind} · {provider.baseUrl}</span>
          <span className="text-neutral-500">{t('llm.discoverModels', { count: provider.models.length })}</span>
          <ActionButton label={t('llm.discoverUse')} onClick={() => onPick(provider.baseUrl)} />
        </div>
      ))}
    </div>
  )
}
```

**`ModelInstall.tsx`** — katalog, rozmiary, postęp. Odczyt strumienia jest tu
wypisany w całości, bo to jedyny nieoczywisty fragment: `fetch` z `POST` zwraca
`ReadableStream`, którego bloki SSE rozdziela pusta linia, a bloki potrafią
przyjść pocięte w połowie — dlatego trzymamy ogon w `buffer`.

```tsx
export function ModelInstall({ freeVramMb }: { freeVramMb: number | null }) {
  const t = useT()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    void settingsApi.catalog().then(setCatalog).catch(() => setCatalog(null))
  }, [])

  const start = (modelId: string): void => {
    const controller = new AbortController()
    abort.current = controller
    setError(null)
    setDone(false)
    void (async () => {
      const response = await fetch('/api/llm/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelId }),
        signal: controller.signal,
      })
      const reader = response.body?.getReader()
      if (reader === undefined) return
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done: finished, value } = await reader.read()
        if (finished) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        // Ostatni element to ogon bez zamykającej pustej linii — zostaje w
        // buforze do następnej porcji.
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          const event = /event: (\w+)/.exec(block)?.[1]
          const data = /data: (.*)/.exec(block)?.[1]
          if (event === undefined || data === undefined) continue
          if (event === 'progress') setProgress(JSON.parse(data) as InstallProgress)
          if (event === 'done') setDone(true)
          if (event === 'error') setError((JSON.parse(data) as { error: string }).error)
        }
      }
    })().catch(() => { /* przerwanie użytkownika — stan zostaje jak był */ })
  }

  if (catalog === null) return null
  if (catalog.engine === null) {
    return <p className="text-[11px] text-amber-400">{t('llm.installNoEngine')}</p>
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-neutral-500">{t('llm.installTitle')}</span>
      <p className="text-[11px] text-neutral-500">{t('llm.installHint')}</p>
      {catalog.models.map(model => (
        <div key={model.id} className="flex items-center justify-between gap-2 text-xs">
          <span>{model.label}</span>
          <span className="text-neutral-500">{(model.bytes / 1e9).toFixed(1)} GB</span>
          {freeVramMb !== null && model.vramMb > freeVramMb && (
            <span className="text-[11px] text-amber-400">{t('llm.installTooBig')}</span>
          )}
          <ActionButton
            label={t('llm.installStart')}
            onClick={() => { setChosen(model.id); start(model.id) }}
            disabled={chosen !== null && !done && error === null}
          />
        </div>
      ))}
      {progress !== null && !done && (
        <div className="flex items-center gap-2 text-[11px] text-neutral-400">
          <span>{progress.stage === 'engine' ? t('llm.installEngine') : t('llm.installModel')}</span>
          <span>{Math.round((progress.received / Math.max(progress.total, 1)) * 100)}%</span>
          <ActionButton label={t('llm.installCancel')} onClick={() => abort.current?.abort()} />
        </div>
      )}
      {done && <p className="text-[11px] text-emerald-400">{t('llm.installDone')}</p>}
      {error !== null && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  )
}
```

Typy `Catalog`, `FoundProvider` i `InstallProgress` dopisz do
`web/src/llm/settingsApi.ts` jako lustrzane odbicia typów serwera — tym samym
wzorcem, którym leży tam już `ManagedState` (granica pakietów nie pozwala
importować z `server/`), razem z wywołaniami `discover()` i `catalog()`.

W `LlmPanel.tsx`: `ProviderDiscovery` nad przełącznikiem trybu, `ModelInstall` widoczny, gdy `saved.mode !== 'endpoint'` i `managed.serverBinary === ''` — czyli dokładnie wtedy, gdy użytkownik nie ma jeszcze niczego skonfigurowanego. `freeVramMb` liczone jako `managed.gpu === null ? null : managed.gpu.totalMb - managed.gpu.usedMb`.

Wszystkie przyciski przez `ActionButton` z `web/src/llm/ActionButton.js` — natywny `<button>` puszcza spację do `window`, gdzie `useTimelineShortcuts` przełącza nią odtwarzanie.

- [ ] **Step 6: Uruchom — mają przejść**

Run: `npm test --workspace @mmh3/web && npm run typecheck`
Expected: PASS

- [ ] **Step 7: Weryfikacja odwrotna**

Usuń warunek `engine === null` (zawsze oferuj pobranie) → test o braku silnika musi paść. Usuń ostrzeżenie o VRAM → test ostrzeżenia musi paść. Cofnij po każdym.

- [ ] **Step 8: Commit**

```bash
git add web/src/llm/ProviderDiscovery.tsx web/src/llm/ModelInstall.tsx web/src/llm/LlmPanel.tsx \
        web/src/llm/settingsApi.ts web/src/i18n/dict.ts \
        web/test/llm/discovery.test.tsx web/test/llm/modelInstall.test.tsx
git commit -m "feat: interfejs wykrywania serwerow i pobierania modelu"
```

---

### Task 9: Przebieg w przeglądarce i dokumentacja

**Files:**
- Create: `web/e2e/discovery.spec.ts`
- Modify: `web/e2e/screenshots.spec.ts`, `README.md`

- [ ] **Step 1: Napisz przebieg e2e**

Plik `web/e2e/discovery.spec.ts`. W e2e nie stoi żaden dostawca, więc skan ma zwrócić pustą listę — i to jest dobry test, bo sprawdza ścieżkę „nic nie znaleziono", która u użytkownika bez Ollamy jest jedyną, jaką zobaczy.

```ts
import { expect, test } from '@playwright/test'

test('skanowanie lokalnych serwerów kończy się czytelnym wynikiem', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'PL', exact: true }).click()
  await page.getByRole('button', { name: /nowy projekt/i }).click()
  await page.getByLabel(/nazwa projektu/i).fill(`E2E skan ${Date.now()}`)
  await page.getByRole('button', { name: /^T2VA/ }).click()
  await page.getByRole('button', { name: /^utwórz$/i }).click()

  await page.getByRole('button', { name: /szukaj lokalnych serwerów/i }).click()

  // Cokolwiek stoi na maszynie CI, wynik ma być czytelnym zdaniem albo listą —
  // nigdy pustym ekranem ani zawieszonym „Szukam…".
  await expect(
    page.getByText(/nie znaleziono żadnego serwera|ollama|lmstudio|openai/i).first(),
  ).toBeVisible({ timeout: 15_000 })
})
```

- [ ] **Step 2: Uruchom e2e**

Run: `cd web && npm run e2e`
Expected: PASS (9 przebiegów: 8 istniejących + nowy)

- [ ] **Step 3: Dodaj zrzut ekranu**

W `web/e2e/screenshots.spec.ts`, w teście panelu LLM, PRZED wskazaniem dostawcy (gdy panel jest jeszcze nieskonfigurowany) zapisz `docs/screenshots/08-install.png` z widocznym ekranem pobierania modelu.

Run: `cd web && MMH3_SHOTS=1 npx playwright test e2e/screenshots.spec.ts`

- [ ] **Step 4: Uzupełnij README**

W sekcji „Local model assistance", przed opisem dwóch trybów, dopisz po angielsku:

- **Find local servers** — skan `127.0.0.1` po portach Ollamy, LM Studio i llama-server; jedno kliknięcie wypełnia ustawienia. Napisz wprost, że skanowana jest wyłącznie pętla lokalna.
- **Download a model** — co się pobiera (silnik ~200 MB i model do wyboru), że rusza dopiero po kliknięciu, że wznawia się po przerwaniu, i że na Windows silnik jest wariantem CPU (z powodem).
- **VRAM** — jedna linijka o tym, że panel pokazuje zużycie pamięci karty, gdy da się je odczytać.

Zaktualizuj też sekcję „Where your data lives" o katalog `runtime/`:

```
~/mmh3-studio/
    projects/           dane projektów
    runtime/
        engine/         pobrane wydanie llama.cpp
        models/         pobrane pliki .gguf
```

- [ ] **Step 5: Pełny przebieg i commit**

```bash
npm test && npm run typecheck && (cd web && npm run e2e)
git add README.md docs/screenshots/08-install.png web/e2e/discovery.spec.ts web/e2e/screenshots.spec.ts
git commit -m "test: przebieg skanowania w przegladarce i dokumentacja trzech funkcji"
```

---

## Uwaga o wdrożeniu

Po zakończeniu planu wdróż na `154.54.100.218` przez `~/mmh3-run/restart.sh` i sprawdź na prawdziwej maszynie trzy rzeczy, których żaden test nie rozstrzyga: czy linijka VRAM pokazuje spadek po kliknięciu „Zwolnij pamięć karty", czy skan znajduje ComfyUI stojące na `8188` (nie powinien — to nie jest serwer modeli i nie odpowiada na żadną z trzech sond), i czy pobranie modelu 7B kończy się działającą konfiguracją. Model 14B i silnik są tam już pobrane, więc instalacja powinna pominąć oba i tylko dopisać ustawienia — to też warto zobaczyć.
