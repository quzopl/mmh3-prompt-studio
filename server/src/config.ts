import { join } from 'node:path'

export interface Config {
  dataRoot: string
  port: number
}

const DEFAULT_PORT = 8899

/**
 * Konfiguracja z zmiennych środowiskowych. `MMH3_DATA_ROOT` istnieje przede
 * wszystkim po to, żeby testy mogły pracować na katalogu tymczasowym.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const home = env.HOME ?? ''
  const dataRoot = env.MMH3_DATA_ROOT ?? join(home, 'mmh3-studio', 'projects')

  let port = DEFAULT_PORT
  if (env.MMH3_PORT !== undefined) {
    const parsed = Number(env.MMH3_PORT)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`MMH3_PORT musi być dodatnią liczbą całkowitą, otrzymano: ${env.MMH3_PORT}`)
    }
    port = parsed
  }

  return { dataRoot, port }
}
