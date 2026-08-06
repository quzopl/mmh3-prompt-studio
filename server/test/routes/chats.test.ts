import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { readProject } from '../../src/storage/projectStore.js'
import { appendTurn } from '../../src/llm/chatStore.js'
import type { RedactTarget } from '../../src/llm/tasks/fieldTarget.js'

/**
 * Odczyt i czyszczenie wątków rozmowy (zadanie 5). Wątki zakładamy tu wprost
 * przez `appendTurn`, nie przez trasę uruchomienia zadania — ta wymagałaby
 * skonfigurowanego dostawcy i atrapy modelu, a sprawdzamy dwie trasy odczytu,
 * nie rozmowę z modelem.
 */

let root: string
let app: FastifyInstance

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-chats-api-'))
  app = await buildApp({ dataRoot: root })
})

afterEach(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true })
})

const create = async (name: string): Promise<string> => {
  const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name, mode: 'T2VA' } })
  return res.json().slug as string
}

const seed = async (slug: string, target: RedactTarget, text: string): Promise<void> => {
  const project = await readProject(root, slug)
  await appendTurn(root, slug, project, target, text, 'odpowiedź modelu', undefined)
}

// `newProject` zostawia `nonDiegeticMusic` na 'N/A', a `style` puste — oba cele
// rozwiązują się w świeżym projekcie, więc żaden z tych wątków nie jest sierotą
// i nie zniknie przy zapisie.
const styleTarget: RedactTarget = { kind: 'style' }
const musicTarget: RedactTarget = { kind: 'audio', field: 'nonDiegeticMusic' }

describe('GET /api/projects/:slug/chats', () => {
  it('zwraca wątki zapisanego projektu', async () => {
    const slug = await create('Projekt')
    await seed(slug, styleTarget, 'dodaj deszcz')

    const res = await app.inject({ method: 'GET', url: `/api/projects/${slug}/chats` })
    expect(res.statusCode).toBe(200)
    expect(res.json().threads).toHaveLength(1)
    expect(res.json().threads[0].key).toBe('style')
    expect(res.json().threads[0].messages[0].text).toBe('dodaj deszcz')
  })

  it('projekt bez rozmów zwraca pustą listę, nie 404', async () => {
    const slug = await create('Projekt')
    const res = await app.inject({ method: 'GET', url: `/api/projects/${slug}/chats` })
    expect(res.statusCode).toBe(200)
    expect(res.json().threads).toEqual([])
  })

  it('nieistniejący projekt zwraca 404 — inaczej pomyłka w slugu wygląda jak brak rozmów', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/nie-ma-takiego/chats' })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /api/projects/:slug/chats/:key', () => {
  it('czyści wskazany wątek, resztę zostawia', async () => {
    const slug = await create('Projekt')
    await seed(slug, styleTarget, 'a')
    await seed(slug, musicTarget, 'b')

    const res = await app.inject({ method: 'DELETE', url: `/api/projects/${slug}/chats/style` })
    expect(res.statusCode).toBe(204)

    const after = await app.inject({ method: 'GET', url: `/api/projects/${slug}/chats` })
    expect(after.json().threads.map((t: { key: string }) => t.key)).toEqual(['audio:nonDiegeticMusic'])
  })

  it('klucz z dwukropkami przechodzi zakodowany', async () => {
    const slug = await create('Projekt')
    await seed(slug, musicTarget, 'b')

    const key = encodeURIComponent('audio:nonDiegeticMusic')
    const res = await app.inject({ method: 'DELETE', url: `/api/projects/${slug}/chats/${key}` })
    expect(res.statusCode).toBe(204)

    const after = await app.inject({ method: 'GET', url: `/api/projects/${slug}/chats` })
    expect(after.json().threads).toEqual([])
  })

  it('czyszczenie nieistniejącego wątku to też 204 — stan końcowy jest ten sam', async () => {
    const slug = await create('Projekt')
    const res = await app.inject({ method: 'DELETE', url: `/api/projects/${slug}/chats/style` })
    expect(res.statusCode).toBe(204)
  })

  it('czyszczenie w nieistniejącym projekcie zwraca 404', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/projects/nie-ma-takiego/chats/style' })
    expect(res.statusCode).toBe(404)
  })

  it('pusty klucz nie trafia w trasę usuwania całego projektu', async () => {
    const slug = await create('Projekt')
    await seed(slug, styleTarget, 'a')

    // `/chats/` bez klucza nie może przypadkiem zadziałać jak `DELETE
    // /api/projects/:slug`. Projekt ma przeżyć niezależnie od kodu odpowiedzi.
    await app.inject({ method: 'DELETE', url: `/api/projects/${slug}/chats/` })

    const still = await app.inject({ method: 'GET', url: `/api/projects/${slug}` })
    expect(still.statusCode).toBe(200)
  })
})
