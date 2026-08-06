import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Speaker } from '@mmh3/shared'
import { newProject } from '../fixtures/newProject.js'
import { writeProject } from '../../src/storage/projectStore.js'
import {
  appendTurn, clearThread, readChats, threadKey, MAX_MESSAGES, MAX_BYTES, MAX_MESSAGE_CHARS,
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
    // projektu pod każdym z 26 indeksów — samo istnienie ujęcia (przy pustym
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
        body: Array.from({ length: 26 }, () => ({ kind: 'text' as const, text: 'seed' })),
      }],
    }
    await writeProject(root, slug, project)

    // 25 małych, jednoznacznie odrębnych wątków — razem tuż poniżej limitu
    // (poszczególne wiadomości są dużo krótsze niż `MAX_MESSAGE_CHARS`, więc
    // przycinanie długości nic tu nie zmienia).
    for (let i = 0; i < 25; i += 1) {
      await appendTurn(root, slug, project, { kind: 'shotText', shotId: project.shots[0]!.id, segmentIndex: i },
        'x'.repeat(4_900), 'x'.repeat(4_900), undefined)
    }
    // Jeden wątek dobity do granicy przez 10 kolejnych tur (MAX_MESSAGES = 20
    // wiadomości, każda przy suficie `MAX_MESSAGE_CHARS`) przebija sumę
    // daleko ponad limit — z ogromnym zapasem, żadnego strojenia pod
    // pojedynczy bajt. Usunięcie JEDNEGO najstarszego małego wątku (~10 KB)
    // nie zbliża się nawet do pokrycia nadwyżki (ponad 150 KB) — trzeba zdjąć
    // kilkanaście naraz. To właśnie odróżnia `while` od `if`: `if` sprawdza
    // warunek raz i zostawia plik wyraźnie za dużym, `while` wraca do
    // warunku po każdym usunięciu, aż zmieści się w limicie.
    const bigTarget = { kind: 'shotText', shotId: project.shots[0]!.id, segmentIndex: 25 } as const
    for (let t = 0; t < 10; t += 1) {
      await appendTurn(root, slug, project, bigTarget, 'a'.repeat(MAX_MESSAGE_CHARS), 'b'.repeat(MAX_MESSAGE_CHARS), undefined)
    }

    const raw = await readFile(join(root, slug, 'chats.json'), 'utf8')
    expect(raw.length).toBeLessThanOrEqual(MAX_BYTES)
    expect(() => JSON.parse(raw)).not.toThrow()

    const threads = await readChats(root, slug)
    // Wątków wyraźnie ubyło (zdjęto kilkanaście naraz, nie jeden) — i to, co
    // najnowsze, przetrwało w całości: usuwane są całe wątki, nie fragmenty.
    expect(threads.length).toBeGreaterThan(0)
    expect(threads.length).toBeLessThan(20)
    expect(threads.map(t => t.key)).toContain('shot:s1:25')
  })

  it('pojedyncza wiadomość dłuższa niż MAX_MESSAGE_CHARS zapisuje się przycięta', async () => {
    const project = newProject()
    await writeProject(root, slug, project)
    const tooLong = 'p'.repeat(MAX_MESSAGE_CHARS + 500)
    await appendTurn(root, slug, project, style, tooLong, tooLong, tooLong)

    const threads = await readChats(root, slug)
    const message = threads[0]?.messages[0]
    expect(message?.text).toHaveLength(MAX_MESSAGE_CHARS)
    const assistant = threads[0]?.messages[1]
    expect(assistant?.text).toHaveLength(MAX_MESSAGE_CHARS)
    expect(assistant?.english).toHaveLength(MAX_MESSAGE_CHARS)
  })

  it('wątek z jedną bardzo długą wiadomością i tak mieści się w MAX_BYTES', async () => {
    // Bez przycinania długości wiadomości pojedynczy wątek mógłby sam w sobie
    // przekroczyć `MAX_BYTES` — wtedy `kept.length > 1` w pętli limitu nie
    // pomogłoby (nie ma czego więcej usunąć), a plik i tak zostałby za duży.
    const project = newProject()
    await writeProject(root, slug, project)
    const huge = 'q'.repeat(1_000_000)
    await appendTurn(root, slug, project, style, huge, huge, huge)

    const raw = await readFile(join(root, slug, 'chats.json'), 'utf8')
    expect(raw.length).toBeLessThanOrEqual(MAX_BYTES)
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  it('uszkodzona składnia JSON w chats.json to pusta lista, nie wyjątek', async () => {
    await writeProject(root, slug, newProject())
    await writeFile(join(root, slug, 'chats.json'), '{ this is not valid json ][', 'utf8')
    await expect(readChats(root, slug)).resolves.toEqual([])
  })

  it('dwa równoległe appendTurn dla różnych celów tego samego projektu nie gubią tury', async () => {
    const project = newProject()
    await writeProject(root, slug, project)
    const other = { kind: 'audio', field: 'overallSoundscape' } as const

    await Promise.all([
      appendTurn(root, slug, project, style, 'a', 'b', undefined),
      appendTurn(root, slug, project, other, 'c', 'd', undefined),
    ])

    const keys = (await readChats(root, slug)).map(t => t.key).sort()
    expect(keys).toEqual(['audio:overallSoundscape', 'style'])
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
