import type { LlmSettings } from './settings.js'
import { stopManaged } from './managed.js'

/**
 * Sposób zwolnienia pamięci karty zależy od dostawcy i żaden nie jest
 * uniwersalny — patrz brief zadania 14. `'none'` znaczy „nie ma czego
 * zawołać", nie „coś poszło nie tak".
 */
export type UnloadCapability = 'managed' | 'ollama' | 'lmstudio' | 'none'

export interface UnloadResult {
  freed: boolean
  how: UnloadCapability
  /** Obecny wyłącznie, gdy `freed` jest fałszywe — powód, żeby użytkownik
   * mógł zdiagnozować problem, zamiast dostać ciche „nie udało się". */
  reason?: string
}

/** Sondy nie mogą trzymać użytkownika klikającego przycisk aż do wyczerpania
 * systemowego limitu czasu przez dwa nieistniejące endpointy — dwie sekundy
 * wystarczają lokalnemu serwerowi na tej samej maszynie, żeby odpowiedzieć. */
const PROBE_TIMEOUT_MS = 2_000

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function authHeader(apiKey: string): Record<string, string> {
  // Ollama i LM Studio zwykle nie wymagają klucza — pusty nagłówek
  // "Bearer " bywa odrzucany, więc nagłówka po prostu nie ma bez klucza,
  // tak samo jak w `openai.ts`.
  return apiKey === '' ? {} : { authorization: `Bearer ${apiKey}` }
}

/** Buduje adres w KORZENIU hosta z `baseUrl`, nie doklejając ścieżki do
 * istniejącego prefiksu (np. `/v1`) — Ollama wystawia `/api/tags`, a LM
 * Studio `/api/v0/models`/`/api/v1/...` w korzeniu, nie pod `/v1`. `URL`
 * zamiast konkatenacji stringów, tak jak `requestUrl` w `openai.ts` po
 * poprawce z zadania 2. */
function hostUrl(baseUrl: string, path: string): string {
  const url = new URL(baseUrl)
  url.pathname = path
  url.search = ''
  url.hash = ''
  return url.toString()
}

/** Sonda, która NIGDY nie rzuca — adres nieprawidłowy, serwer nieistniejący
 * albo odpowiedź spoza dwusetki wszystkie kończą się tym samym `false`.
 * Wykrywanie możliwości nie jest operacją krytyczną, więc żaden z tych
 * przypadków nie ma prawa wywrócić reszty. */
async function probeOk(baseUrl: string, path: string): Promise<boolean> {
  try {
    const response = await fetch(hostUrl(baseUrl, path), { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Wykrywa, czym da się zwolnić pamięć karty dla bieżącego dostawcy.
 *
 * Tryb zarządzany nie wymaga sondowania — zatrzymanie procesu jest zawsze
 * dostępne, niezależnie od tego, czy serwer akurat odpowiada na żądania
 * zdrowia. Dla endpointu obie sondy lecą RÓWNOLEGLE (`Promise.all`), nie po
 * kolei — inaczej dwa nieistniejące adresy sumowałyby swoje limity czasu.
 */
export async function detectUnloadCapability(settings: LlmSettings): Promise<UnloadCapability> {
  if (settings.mode === 'managed') return 'managed'
  if (settings.mode !== 'endpoint') return 'none'

  const baseUrl = settings.endpoint.baseUrl
  const [ollama, lmstudio] = await Promise.all([
    probeOk(baseUrl, '/api/tags'),
    probeOk(baseUrl, '/api/v0/models'),
  ])
  if (ollama) return 'ollama'
  if (lmstudio) return 'lmstudio'
  return 'none'
}

/** Ten sam kompromis co `throwIfNotOk` w `openai.ts`: gdy klucz API jest
 * skonfigurowany, treść odpowiedzi w ogóle nie trafia do powodu błędu —
 * mogłaby wyciekać przez nią zakodowana czy inaczej sformatowana. Bez klucza
 * nie ma czego chronić, a treść jest jedyną diagnostyką pod ręką. */
async function failureReason(response: Response, apiKey: string): Promise<string> {
  if (apiKey !== '') {
    return `Odpowiedź ${response.status}. Sprawdź log serwera modelu po szczegóły.`
  }
  const body = await response.text()
  return `Odpowiedź ${response.status}: ${body.slice(0, 200)}`
}

/** Ollama przyjmuje `keep_alive: 0` przy żądaniu do `/api/generate` i
 * wyładowuje model z pamięci karty zaraz po jego zakończeniu — pusty
 * `prompt`, bo nie chodzi o wygenerowanie czegokolwiek, tylko o samo
 * zdarzenie żądania z tym polem. */
async function unloadOllama(endpoint: LlmSettings['endpoint']): Promise<{ freed: boolean; reason?: string }> {
  try {
    const response = await fetch(hostUrl(endpoint.baseUrl, '/api/generate'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(endpoint.apiKey) },
      body: JSON.stringify({ model: endpoint.model, prompt: '', keep_alive: 0 }),
    })
    if (!response.ok) return { freed: false, reason: await failureReason(response, endpoint.apiKey) }
    return { freed: true }
  } catch (error) {
    return { freed: false, reason: messageOf(error) }
  }
}

/** Wpis listy instancji LM Studio (`GET /api/v1/models/list`) — pola inne niż
 * `instance_id` sprawdzane są elastycznie (`model`/`id`/`path`), bo to, pod
 * którym z nich znajdzie się identyfikator modelu skonfigurowany u nas, nie
 * jest udokumentowane jednoznacznie. */
interface LmStudioModelEntry {
  instance_id?: unknown
  model?: unknown
  id?: unknown
  path?: unknown
}

/**
 * LM Studio nie ma pola typu `keep_alive` — wyładowanie idzie przez jego
 * własne REST API (`/api/v1/models/unload`), które wymaga `instance_id`
 * konkretnie wczytanej instancji, nie samej nazwy modelu. Stąd dwa kroki:
 * najpierw lista wczytanych instancji (`/api/v1/models/list`), potem
 * dopasowanie po identyfikatorze modelu z ustawień i dopiero wyładowanie
 * znalezionej instancji. Brak dopasowania albo błąd na którymkolwiek kroku
 * kończy się `freed: false` z powodem — nigdy zgadywaniem sukcesu.
 */
async function unloadLmStudio(endpoint: LlmSettings['endpoint']): Promise<{ freed: boolean; reason?: string }> {
  try {
    const listResponse = await fetch(hostUrl(endpoint.baseUrl, '/api/v1/models/list'), {
      headers: authHeader(endpoint.apiKey),
    })
    if (!listResponse.ok) return { freed: false, reason: await failureReason(listResponse, endpoint.apiKey) }

    const payload = await listResponse.json() as { data?: LmStudioModelEntry[] } | LmStudioModelEntry[]
    const entries = Array.isArray(payload) ? payload : payload.data ?? []
    const match = entries.find(entry =>
      [entry.model, entry.id, entry.path].some(field => field === endpoint.model))
    const instanceId = match?.instance_id
    if (typeof instanceId !== 'string') {
      return { freed: false, reason: 'Nie znaleziono wczytanej instancji tego modelu w LM Studio' }
    }

    const unloadResponse = await fetch(hostUrl(endpoint.baseUrl, '/api/v1/models/unload'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(endpoint.apiKey) },
      body: JSON.stringify({ instance_id: instanceId }),
    })
    if (!unloadResponse.ok) return { freed: false, reason: await failureReason(unloadResponse, endpoint.apiKey) }
    return { freed: true }
  } catch (error) {
    return { freed: false, reason: messageOf(error) }
  }
}

/**
 * Zwalnia pamięć karty sposobem właściwym dla wykrytego dostawcy. Nigdy nie
 * rzuca do wołającego — to operacja pomocnicza, jej niepowodzenie nie ma
 * prawa wywrócić panelu, więc każda ścieżka kończy się zwykłym wynikiem.
 *
 * Tryb zarządzany woła `stopManaged()` i nic więcej — VRAM zwalnia się razem
 * z zatrzymanym procesem `llama-server`; to pełne zwolnienie, bo po nim
 * serwer w ogóle przestaje działać.
 */
export async function unloadModel(settings: LlmSettings): Promise<UnloadResult> {
  const how = await detectUnloadCapability(settings)

  if (how === 'none') return { freed: false, how }

  if (how === 'managed') {
    try {
      await stopManaged()
      return { freed: true, how }
    } catch (error) {
      return { freed: false, how, reason: messageOf(error) }
    }
  }

  const outcome = how === 'ollama'
    ? await unloadOllama(settings.endpoint)
    : await unloadLmStudio(settings.endpoint)
  return { how, ...outcome }
}
