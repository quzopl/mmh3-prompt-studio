/**
 * Sondowanie dostawców modeli — wspólny fundament dwóch funkcji, które muszą
 * wiedzieć o dostawcy dokładnie to samo: wykrywania możliwości zwolnienia
 * pamięci karty (`unload.ts`) i wykrywania serwerów stojących na maszynie
 * (`discover.ts`).
 *
 * Zanim ten moduł powstał, sondowanie mieszkało wewnątrz `unload.ts`. Druga
 * funkcja musiałaby je powtórzyć — a wtedy pytanie „czy to Ollama" miałoby dwie
 * odpowiedzi, zgodne tylko z oglądu. W tym projekcie ta klasa usterki wracała
 * już trzy razy.
 */

/** Sondy nie mogą trzymać użytkownika klikającego przycisk aż do wyczerpania
 * systemowego limitu czasu przez dwa nieistniejące endpointy — dwie sekundy
 * wystarczają lokalnemu serwerowi na tej samej maszynie, żeby odpowiedzieć. */
export const PROBE_TIMEOUT_MS = 2_000

/** Buduje adres w KORZENIU hosta z `baseUrl`, nie doklejając ścieżki do
 * istniejącego prefiksu (np. `/v1`) — Ollama wystawia `/api/tags`, a LM
 * Studio `/api/v0/models`/`/api/v1/...` w korzeniu, nie pod `/v1`. `URL`
 * zamiast konkatenacji stringów, tak jak `requestUrl` w `openai.ts` po
 * poprawce z zadania 2. */
export function hostUrl(baseUrl: string, path: string): string {
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
export async function probeOk(baseUrl: string, path: string): Promise<boolean> {
  try {
    const response = await fetch(hostUrl(baseUrl, path), { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    return response.ok
  } catch {
    return false
  }
}

/**
 * To samo co `probeOk`, ale zwraca sparsowane ciało odpowiedzi. `null` znaczy
 * „nie udało się" i obejmuje wszystkie powody naraz: brak serwera, kod spoza
 * dwusetki, ciało, które nie jest JSON-em. Wołający nie ma po co ich
 * rozróżniać — każdy znaczy dokładnie tyle samo: „tego dostawcy tu nie ma".
 */
export async function probeJson(baseUrl: string, path: string): Promise<unknown | null> {
  try {
    const response = await fetch(hostUrl(baseUrl, path), { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}
