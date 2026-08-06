import { ApiError } from '../api/client.js'

export type LlmMode = 'off' | 'endpoint' | 'managed'

/** Lustrzane odbicie `LlmSettings` z `server/src/llm/settings.ts` — nie da
 * się go stamtąd zaimportować (kod serwera nie trafia do paczki
 * przeglądarki), więc kształt jest zduplikowany tutaj, tak jak inne typy
 * odpowiedzi API w `web/src/api/`. */
export interface LlmSettings {
  mode: LlmMode
  endpoint: { baseUrl: string; apiKey: string; model: string }
  managed: { serverBinary: string; modelPath: string; gpuLayers: number; contextSize: number }
}

/**
 * Kształt ciała `PUT` — jak `LlmSettings`, ale `endpoint.apiKey` przyjmuje
 * też `null`. Trasa (`server/src/routes/llm.ts`) czyta trzy znaczenia:
 * niepusty ciąg ustawia klucz, pusty `''` zostawia obecny bez zmian
 * (przeglądarka nigdy nie zna klucza — `GET` go redaguje), `null` czyści.
 * Panel wysyła `''`, dopóki użytkownik nie wpisze nowej wartości.
 */
export interface LlmSettingsInput {
  mode: LlmMode
  endpoint: { baseUrl: string; apiKey: string | null; model: string }
  managed: { serverBinary: string; modelPath: string; gpuLayers: number; contextSize: number }
}

export interface GpuInfo {
  name: string
  usedMb: number
  totalMb: number
}

export interface ManagedState {
  status: 'stopped' | 'starting' | 'ready' | 'failed'
  logs: string[]
  port: number
  /** `null`, gdy karty nie da się odczytać — lustrzane odbicie `readGpu`
   *  (`server/src/llm/gpu.ts`). Panel wtedy nie pokazuje linijki VRAM. */
  gpu: GpuInfo | null
}

/** Lustrzane odbicie `UnloadCapability`/`UnloadResult` z `server/src/llm/unload.ts`
 * — ten sam powód duplikacji co przy `LlmSettings` wyżej. */
export type UnloadCapability = 'managed' | 'ollama' | 'lmstudio' | 'none'

export interface UnloadResult {
  freed: boolean
  how: UnloadCapability
  reason?: string
}

/** Ten sam kształt obsługi błędu co `web/src/api/uploadAsset.ts` — osobny
 * moduł, więc osobna (mała) kopia zamiast wyciągania współdzielonego helpera
 * z `client.ts`, którego ten plik nie modyfikuje. */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  })
  if (!response.ok) {
    let message = `Serwer odpowiedział kodem ${response.status}`
    try {
      const body = await response.json() as { error?: string }
      if (body.error) message = body.error
    } catch {
      // Odpowiedź bez JSON-a — zostaje komunikat z kodem statusu.
    }
    throw new ApiError(message, response.status)
  }
  return await response.json() as T
}

export const settingsApi = {
  /** Klucz w odpowiedzi jest zawsze pusty — `redactSettings` po stronie
   * serwera. */
  getSettings: () => request<LlmSettings>('/api/llm/settings'),

  putSettings: (input: LlmSettingsInput) =>
    request<LlmSettings>('/api/llm/settings', { method: 'PUT', body: JSON.stringify(input) }),

  getManagedState: () => request<ManagedState>('/api/llm/managed/state'),

  /** Odpowiedź przychodzi dopiero po rozstrzygnięciu sondowania zdrowia
   * (`ready`/`failed`) po stronie serwera — nie trzeba dopytywać stanu
   * osobno zaraz po starcie. */
  startManaged: () => request<ManagedState>('/api/llm/managed/start', { method: 'POST' }),

  stopManaged: () => request<ManagedState>('/api/llm/managed/stop', { method: 'POST' }),

  getUnloadCapability: () => request<{ capability: UnloadCapability }>('/api/llm/unload/capability'),

  /** Odpowiada dwusetką nawet wtedy, gdy zwolnienie się nie udało (`freed`
   * fałszywe) — to WYNIK operacji, nie błąd protokołu; `request` rzuciłby
   * tylko przy prawdziwym błędzie HTTP (sieć padła, serwer nie odpowiada).
   *
   * `capability` to możliwość, którą panel JUŻ zna (pokazał ją przy
   * przycisku) — przekazana tutaj oszczędza serwerowi ponownego sondowania
   * dostawcy tuż przed zwolnieniem (do dwóch sekund). Bez niej trasa sama
   * wykrywa, patrz `knownCapability` w `server/src/llm/unload.ts`. */
  unload: (capability?: UnloadCapability) =>
    request<UnloadResult>('/api/llm/unload', { method: 'POST', body: JSON.stringify({ capability }) }),
}
