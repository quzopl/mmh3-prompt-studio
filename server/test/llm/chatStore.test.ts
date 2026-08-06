import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Speaker } from '@mmh3/shared'
import { newProject } from '../fixtures/newProject.js'
import { writeProject } from '../../src/storage/projectStore.js'
import {
  appendTurn, clearThread, readChats, threadKey, MAX_MESSAGES, MAX_BYTES,
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
    // Sierota powstaje uczciwie, tak jak naprawdę: rozmowa dotyczy pola, które
    // w chwili rozmowy ISTNIEJE, a dopiero potem znika z projektu. Okno
    // rozmowy da się otworzyć wyłącznie dla pola, które w danej chwili
    // istnieje — nie da się w praktyce dopisać tury do celu, którego nigdy
    // nie było, więc test tego nie symuluje.
    const speaker: Speaker = {
      id: 'sp1', code: 'S1', characterType: 'kobieta', age: '30s', gender: 'female',
      pitch: 'mid', timbre: 'warm', rate: 'even', accent: 'neutral', onScreen: true,
      fullDescriptor: 'kobieta w niebieskim płaszczu', shortDescriptor: 'kobieta',
    }
    const withSpeaker = { ...newProject(), speakers: [speaker] }
    await writeProject(root, slug, withSpeaker)

    const target = { kind: 'speaker', speakerId: 'sp1', field: 'fullDescriptor' } as const
    await appendTurn(root, slug, withSpeaker, target, 'a', 'b', undefined)
    expect(await readChats(root, slug)).toHaveLength(1)

    // Mówca znika z projektu — wątek o nim staje się sierotą.
    const withoutSpeaker = { ...withSpeaker, speakers: [] }
    await writeProject(root, slug, withoutSpeaker)

    // Sprzątanie uruchamia się przy KOLEJNYM zapisie gdziekolwiek indziej.
    await appendTurn(root, slug, withoutSpeaker, style, 'c', 'd', undefined)
    const keys = (await readChats(root, slug)).map(t => t.key)
    expect(keys).toEqual(['style'])
  })

  it('przekroczenie limitu bajtów usuwa całe najstarsze wątki, nie tnie pliku w połowie', async () => {
    // Cel `shotText` musi wskazywać ISTNIEJĄCY segment tekstowy ze świeżego
    // projektu pod każdym z 11 indeksów — samo istnienie ujęcia (przy pustym
    // `body`) nie wystarczy: `redactSourceText` uznałby każdy z tych celów za
    // sierotę i `alive` skasowałoby wątki, zanim limit bajtów zdążyłby
    // zadziałać. Wtedy plik zostałby pusty, test przeszedłby, ale nie
    // sprawdzałby gałęzi limitu w ogóle.
    const base = newProject()
    const shot = base.shots[0]!
    const project = {
      ...base,
      shots: [{
        ...shot,
        body: Array.from({ length: 11 }, () => ({ kind: 'text' as const, text: 'seed' })),
      }],
    }
    await writeProject(root, slug, project)

    // 10 małych wątków (razem grubo poniżej limitu — dopisywanie ich nigdy
    // nie zawadza o `MAX_BYTES`, więc żaden z tych zapisów nic nie przycina).
    for (let i = 0; i < 10; i += 1) {
      await appendTurn(root, slug, project, { kind: 'shotText', shotId: project.shots[0]!.id, segmentIndex: i },
        'y'.repeat(5_000), 'y'.repeat(5_000), undefined)
    }
    // Jeden wielki wątek na końcu przebija sumę daleko ponad limit (z dużym
    // zapasem, żadnego strojenia pod pojedynczy bajt): ten JEDEN zapis musi
    // zdjąć KILKA najstarszych małych wątków naraz, bo usunięcie tylko
    // jednego (~10 KB) nie zbliża się nawet do pokrycia nadwyżki. To właśnie
    // odróżnia `while` od `if` — `if` sprawdza warunek raz i zostawia plik
    // wyraźnie za dużym, `while` wraca do warunku po każdym usunięciu.
    const big = 'x'.repeat(100_000)
    await appendTurn(root, slug, project, { kind: 'shotText', shotId: project.shots[0]!.id, segmentIndex: 10 },
      big, big, undefined)

    const raw = await readFile(join(root, slug, 'chats.json'), 'utf8')
    expect(raw.length).toBeLessThanOrEqual(MAX_BYTES)
    expect(() => JSON.parse(raw)).not.toThrow()

    const threads = await readChats(root, slug)
    // Wątków wyraźnie ubyło (zdjęto kilka naraz, nie jeden) — i to, co
    // najnowsze, przetrwało w całości: usuwane są całe wątki, nie fragmenty.
    expect(threads.length).toBeGreaterThan(0)
    expect(threads.length).toBeLessThan(8)
    expect(threads.map(t => t.key)).toContain('shot:s1:10')
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
