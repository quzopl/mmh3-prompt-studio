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

// Plik leży bezpośrednio w katalogu danych (rodzicu wszystkich projektów), a nie
// wewnątrz katalogu żadnego z nich — patrz komentarz przy `readSettings`.
const settingsPath = (dataRoot: string): string => join(dataRoot, 'llm-settings.json')

/**
 * Ustawienia dostawcy leżą obok katalogów projektów, nie w żadnym z nich.
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
