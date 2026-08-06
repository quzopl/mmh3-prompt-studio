import { buildApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const app = await buildApp({ dataRoot: config.dataRoot })

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
