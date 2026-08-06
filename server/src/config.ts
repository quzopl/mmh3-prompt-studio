import { join } from 'node:path'

export interface Config {
  dataRoot: string
  /** Katalog na PLIKI POBRANE przez aplikację: silnik llama.cpp i modele. */
  runtimeRoot: string
  port: number
  host: string
}

const DEFAULT_PORT = 8899

/**
 * Domyślnie tylko pętla zwrotna. API nie ma uwierzytelniania, a trasa
 * `POST /api/llm/managed/start` uruchamia binarkę ze wskazanej ścieżki — na
 * otwartym interfejsie jest to wykonanie dowolnego kodu przez każdego, kto
 * dosięgnie hosta. Wystawienie na `0.0.0.0` musi być świadomą decyzją
 * wyrażoną przez `MMH3_HOST`, a nie stanem domyślnym.
 */
const DEFAULT_HOST = '127.0.0.1'

/**
 * Konfiguracja z zmiennych środowiskowych. `MMH3_DATA_ROOT` istnieje przede
 * wszystkim po to, żeby testy mogły pracować na katalogu tymczasowym.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const home = env.HOME ?? ''
  const dataRoot = env.MMH3_DATA_ROOT ?? join(home, 'mmh3-studio', 'projects')
  // Pobrane pliki stoją OBOK `projects/`, nie w środku: silnik i modele nie są
  // danymi projektu, nie mają wędrować przy kopiowaniu katalogu projektu ani
  // trafiać do kopii zapasowej razem z nim. Osobna zmienna z tego samego
  // powodu co `MMH3_DATA_ROOT` — żeby testy mogły pracować na katalogu
  // tymczasowym.
  const runtimeRoot = env.MMH3_RUNTIME_ROOT ?? join(home, 'mmh3-studio', 'runtime')

  let port = DEFAULT_PORT
  if (env.MMH3_PORT !== undefined) {
    const parsed = Number(env.MMH3_PORT)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`MMH3_PORT musi być dodatnią liczbą całkowitą, otrzymano: ${env.MMH3_PORT}`)
    }
    port = parsed
  }

  return { dataRoot, runtimeRoot, port, host: env.MMH3_HOST ?? DEFAULT_HOST }
}
