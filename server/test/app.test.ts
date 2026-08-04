import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  it('domyślnie celuje w katalog projektów w katalogu domowym i port 8899', () => {
    const config = loadConfig({ HOME: '/home/tester' })
    expect(config.dataRoot).toBe('/home/tester/mmh3-studio/projects')
    expect(config.port).toBe(8899)
  })

  it('pozwala nadpisać katalog danych i port', () => {
    const config = loadConfig({
      HOME: '/home/tester',
      MMH3_DATA_ROOT: '/tmp/dane',
      MMH3_PORT: '9100',
    })
    expect(config.dataRoot).toBe('/tmp/dane')
    expect(config.port).toBe(9100)
  })

  it('odrzuca nieliczbowy port zamiast po cichu wracać do domyślnego', () => {
    expect(() => loadConfig({ HOME: '/home/tester', MMH3_PORT: 'osiem' })).toThrow(/MMH3_PORT/)
  })
})

describe('buildApp', () => {
  it('odpowiada na sprawdzenie zdrowia', async () => {
    const app = await buildApp({ dataRoot: '/tmp/nieistotne' })
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', version: '0.1.0' })
    await app.close()
  })

  it('zwraca 404 w formacie JSON dla nieznanej ścieżki', async () => {
    const app = await buildApp({ dataRoot: '/tmp/nieistotne' })
    const response = await app.inject({ method: 'GET', url: '/api/nie-ma' })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: expect.any(String) })
    await app.close()
  })
})
