import { probeJson } from './probe.js'

export type ProviderKind = 'ollama' | 'lmstudio' | 'openai'

export interface FoundProvider {
  kind: ProviderKind
  baseUrl: string
  models: string[]
}

/**
 * Porty domyślne trzech dostawców, których naprawdę spotyka się na maszynie
 * deweloperskiej. Lista jest PARAMETREM `discoverProviders`, a nie stałą
 * czytaną w środku, żeby test mógł podstawić porty losowe zamiast walczyć o te
 * prawdziwe z tym, co akurat stoi na maszynie testowej.
 */
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
 * KOLEJNOŚĆ MA ZNACZENIE i jest sprawdzana testem.
 *
 * Ollama i LM Studio wystawiają TAKŻE API zgodne z OpenAI, więc `/v1/models`
 * odpowiada u wszystkich trzech. Gdyby sonda ogólna szła pierwsza, każdy
 * dostawca zostałby nazwany „openai" — a rozpoznanie Ollamy jest tym, od czego
 * zależy, czy da się zwolnić pamięć karty bez zabijania procesu
 * (`detectUnloadCapability` w `unload.ts`). Sonda ogólna jest ostatnią deską
 * ratunku, nie pierwszym pytaniem.
 */
const SIGNATURES = [
  { kind: 'ollama' as const, path: '/api/tags', read: (body: unknown) => names(body, 'name', 'models') },
  { kind: 'lmstudio' as const, path: '/api/v0/models', read: (body: unknown) => names(body, 'id', 'data') },
  { kind: 'openai' as const, path: '/v1/models', read: (body: unknown) => names(body, 'id', 'data') },
]

async function identify(port: number): Promise<FoundProvider | null> {
  const baseUrl = `http://127.0.0.1:${port}`
  for (const signature of SIGNATURES) {
    const body = await probeJson(baseUrl, signature.path)
    if (body === null) continue
    // Dostawca bez czytelnej listy modeli i tak jest zgłoszony, z pustą listą:
    // stoi i da się go użyć, a kształt jego odpowiedzi to osobna sprawa.
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
