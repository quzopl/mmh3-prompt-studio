import { buildApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const app = await buildApp({ dataRoot: config.dataRoot })

app.listen({ port: config.port, host: '127.0.0.1' })
  .then(address => {
    console.log(`MMH3 Prompt Studio API słucha na ${address}`)
    console.log(`Katalog danych: ${config.dataRoot}`)
  })
  .catch(err => {
    console.error('Nie udało się wystartować:', err)
    process.exit(1)
  })
