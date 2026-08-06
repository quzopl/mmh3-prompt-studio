import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newProject } from '../fixtures/newProject.js'
import { writeProject } from '../../src/storage/projectStore.js'
import {
  appendTurn, clearThread, readChats, threadKey, MAX_MESSAGES,
} from '../../src/llm/chatStore.js'

let root: string
const slug = 'projekt'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-chat-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const style = { kind: 'style' } as const

describe('chatStore', () => {
  it('klucz wątku wyprowadza się z celu, nie z losowego identyfikatora', () => {
    expect(threadKey(style)).toBe('style')
    expect(threadKey({ kind: 'audio', field: 'nonDiegeticMusic' })).toBe('audio:nonDiegeticMusic')
    expect(threadKey({ kind: 'shotText', shotId: 'sh-1', segmentIndex: 2 })).toBe('shot:sh-1:2')
    expect(threadKey({ kind: 'speaker', speakerId: 'sp-1', field: 'fullDescriptor' }))
      .toBe('speaker:sp-1:fullDescriptor')
  })

  it('zapisana tura wraca odczytem identyczna', async () => {
    const project = newProject()
    await writeProject(root, slug, project)
    await appendTurn(root, slug, project, style, 'dodaj deszcz', 'Dodałem deszcz.', 'Rain taps the roof.')

    const threads = await readChats(root, slug)
    expect(threads).toHaveLength(1)
    expect(threads[0]?.key).toBe('style')
    expect(threads[0]?.messages).toEqual([
      { role: 'user', text: 'dodaj deszcz' },
      { role: 'assistant', text: 'Dodałem deszcz.', english: 'Rain taps the roof.' },
    ])
  })

  it('brak pliku to pusta lista, nie wyjątek', async () => {
    await writeProject(root, slug, newProject())
    expect(await readChats(root, slug)).toEqual([])
  })

  it('wątek trzyma najwyżej MAX_MESSAGES wiadomości i zachowuje najnowsze', async () => {
    const project = newProject()
    await writeProject(root, slug, project)
    for (let i = 0; i < MAX_MESSAGES; i += 1) {
      await appendTurn(root, slug, project, style, `pytanie ${i}`, `odpowiedź ${i}`, undefined)
    }
    const threads = await readChats(root, slug)
    const messages = threads[0]?.messages ?? []
    expect(messages).toHaveLength(MAX_MESSAGES)
    expect(messages[messages.length - 1]?.text).toBe(`odpowiedź ${MAX_MESSAGES - 1}`)
    expect(messages.some(m => m.text === 'pytanie 0')).toBe(false)
  })

  it('wątek celu, którego nie ma już w projekcie, znika przy zapisie', async () => {
    const project = newProject()
    await writeProject(root, slug, project)
    const orphan = { kind: 'speaker', speakerId: 'nie-istnieje', field: 'fullDescriptor' } as const
    await appendTurn(root, slug, project, orphan, 'a', 'b', undefined)
    expect(await readChats(root, slug)).toHaveLength(1)

    await appendTurn(root, slug, project, style, 'c', 'd', undefined)
    const keys = (await readChats(root, slug)).map(t => t.key)
    expect(keys).toEqual(['style'])
  })

  it('przekroczenie limitu bajtów usuwa całe najstarsze wątki, nie tnie pliku w połowie', async () => {
    // Cel `shotText` musi wskazywać ISTNIEJĄCY segment tekstowy ze świeżego
    // projektu pod każdym z 16 indeksów — samo istnienie ujęcia (przy pustym
    // `body`) nie wystarczy: `redactSourceText` uznałby każdy z tych celów za
    // sierotę i `alive` skasowałoby wątki, zanim limit bajtów zdążyłby
    // zadziałać. Wtedy plik zostałby pusty, test przeszedłby, ale nie
    // sprawdzałby gałęzi limitu w ogóle — dokładnie tak, jak ostrzega brief.
    const base = newProject()
    const shot = base.shots[0]!
    const project = {
      ...base,
      shots: [{
        ...shot,
        body: Array.from({ length: 16 }, () => ({ kind: 'text' as const, text: 'seed' })),
      }],
    }
    await writeProject(root, slug, project)

    // 15 małych, jednoznacznie odrębnych wątków — same w sobie mieszczą się w
    // limicie z ogromnym zapasem.
    for (let i = 0; i < 15; i += 1) {
      await appendTurn(root, slug, project, { kind: 'shotText', shotId: project.shots[0]!.id, segmentIndex: i },
        'aaa', 'bbb', undefined)
    }
    // Jedna duża tura na 16. wątku przekracza limit tylko odrobinę (o niecały
    // 1 KB) — usunięcie JEDNEGO najstarszego małego wątku (~160 B) nie
    // wystarczy, trzeba zdjąć kilka. To odróżnia `while` od `if`: `if`
    // sprawdza warunek raz i zostawia plik wciąż za dużym, `while` wraca do
    // warunku po każdym usunięciu, aż zmieści się w limicie. Rozmiar dobrany
    // eksperymentalnie (patrz raport) tak, by ta różnica była widoczna.
    const big = 'x'.repeat(129_000)
    await appendTurn(root, slug, project, { kind: 'shotText', shotId: project.shots[0]!.id, segmentIndex: 15 },
      big, big, undefined)

    const raw = await readFile(join(root, slug, 'chats.json'), 'utf8')
    expect(raw.length).toBeLessThanOrEqual(256 * 1024)
    expect(() => JSON.parse(raw)).not.toThrow()

    const threads = await readChats(root, slug)
    // Gałąź limitu faktycznie musiała usunąć kilka najstarszych wątków naraz —
    // najstarszy (indeks 0) zniknął, a najnowszy, duży (indeks 15) przetrwał
    // w CAŁOŚCI (nieobcięty), bo usuwane są całe wątki, nie fragmenty tekstu.
    const keys = threads.map(t => t.key)
    expect(keys).not.toContain('shot:s1:0')
    expect(keys).toContain('shot:s1:15')
    const survivingBig = threads.find(t => t.key === 'shot:s1:15')
    expect(survivingBig?.messages[0]?.text).toBe(big)
    expect(threads.length).toBeLessThan(16)
  })

  it('czyszczenie usuwa jeden wątek, resztę zostawia', async () => {
    const project = newProject()
    await writeProject(root, slug, project)
    await appendTurn(root, slug, project, style, 'a', 'b', undefined)
    await appendTurn(root, slug, project, { kind: 'audio', field: 'overallSoundscape' }, 'c', 'd', undefined)

    await clearThread(root, slug, 'style')
    expect((await readChats(root, slug)).map(t => t.key)).toEqual(['audio:overallSoundscape'])
  })
})
