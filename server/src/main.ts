import { buildApp } from './app.js'
import { installShutdownHooks } from './llm/managed.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const app = await buildApp({ dataRoot: config.dataRoot, runtimeRoot: config.runtimeRoot })

// Bez tego zabicie API zostawia osierocony `llama-server` trzymający cały
// model w pamięci karty — patrz komentarz przy `installShutdownHooks`.
installShutdownHooks()

app.listen({ port: config.port, host: config.host })
  .then(address => {
    console.log(`MMH3 Prompt Studio API słucha na ${address}`)
    console.log(`Katalog danych: ${config.dataRoot}`)
    if (config.host !== '127.0.0.1') {
      console.warn(
        `UWAGA: API słucha na ${config.host} bez uwierzytelniania. Każdy, kto `
        + 'dosięgnie tego hosta, może czytać i nadpisywać projekty oraz '
        + 'uruchamiać procesy przez trasę zarządzanego serwera modelu.',
      )
    }
  })
  .catch(err => {
    console.error('Nie udało się wystartować:', err)
    process.exit(1)
  })
