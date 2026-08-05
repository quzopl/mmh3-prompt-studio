import { describe, expect, it } from 'vitest'
import { buildPrompt, type Project } from '@mmh3/shared'
import { applyProposal, dialogueProposals } from '../../src/timeline/proposals.js'
import { baseProject, emptyShot, lineFixture } from './fixtures.js'

const withDialogue = (
  startMs: number,
  endMs: number,
  extra: Partial<ReturnType<typeof lineFixture>> = {},
  text = 'tekst',
) =>
  baseProject([
    { ...emptyShot('a', 0, 0), dialogue: [{ ...lineFixture('d1', ['s1'], text, startMs, endMs), ...extra }] },
    emptyShot('b', 1, 4000),
  ])

describe('dialogueProposals', () => {
  it('proponuje scenetrans dla kwestii przechodzącej przez cięcie', () => {
    const result = dialogueProposals(withDialogue(3000, 5000))
    expect(result).toContainEqual({ eventId: 'd1', kind: 'scenetrans' })
  })

  it('nie proponuje scenetrans, gdy kwestia mieści się w jednym ujęciu', () => {
    expect(dialogueProposals(withDialogue(1000, 2000))).toEqual([])
  })

  it('nie proponuje scenetrans, gdy znacznik po stronie cięcia już stoi', () => {
    const result = dialogueProposals(withDialogue(3000, 5000, { sceneTransBefore: true, sceneTransAfter: true }))
    expect(result.some(p => p.kind === 'scenetrans')).toBe(false)
  })

  it('proponuje cutoff dla kwestii wystającej poza materiał', () => {
    const result = dialogueProposals(withDialogue(7000, 9000))
    expect(result).toContainEqual({ eventId: 'd1', kind: 'cutoff' })
  })

  it('nie proponuje cutoff, gdy znacznik już stoi', () => {
    const result = dialogueProposals(withDialogue(7000, 9000, { cutoff: true }))
    expect(result.some(p => p.kind === 'cutoff')).toBe(false)
  })

  it('kwestia kończąca się dokładnie na końcu materiału nie wystaje', () => {
    expect(dialogueProposals(withDialogue(7000, 8000)).some(p => p.kind === 'cutoff')).toBe(false)
  })
})

describe('applyProposal — scenetrans dzieli kwestię na cięciu', () => {
  it('oryginał zostaje w swoim ujęciu skrócony do cięcia, nowa połówka ląduje w następnym', () => {
    const project = withDialogue(3000, 5000, {}, 'slowo jeden dwa trzy')
    const next = applyProposal(project, { eventId: 'd1', kind: 'scenetrans' })

    const shotA = next.shots.find(s => s.id === 'a')
    const shotB = next.shots.find(s => s.id === 'b')
    if (!shotA || !shotB) throw new Error('oczekiwano ujęć a i b')
    expect(shotA.dialogue).toHaveLength(1)
    expect(shotB.dialogue).toHaveLength(1)

    const before = shotA.dialogue[0]
    const after = shotB.dialogue[0]
    if (!before || !after) throw new Error('oczekiwano dwóch połówek kwestii')

    // Cięcie w połowie zakresu (3000–5000, granica ujęć w 4000) — połowa
    // czterech słów po każdej stronie.
    expect(before.id).toBe('d1')
    expect(before.text).toBe('slowo jeden')
    expect(before.endMs).toBe(4000)
    expect(before.sceneTransAfter).toBe(true)
    expect(before.sceneTransBefore).toBe(false)
    expect(before.continuityPhrase).toBe('continues seamlessly across the cut')

    expect(after.id).not.toBe('d1')
    expect(after.text).toBe('dwa trzy')
    expect(after.startMs).toBe(4000)
    expect(after.endMs).toBe(5000)
    expect(after.sceneTransBefore).toBe(true)
    expect(after.sceneTransAfter).toBe(false)
    expect(after.speakerIds).toEqual(before.speakerIds)
  })

  it('kwestia dwuwyrazowa, cięcie blisko środka — po jednym słowie na stronę, bez pustego <d>', () => {
    // To dokładnie przypadek, o który spytał koordynator: dwa słowa, cięcie
    // w połowie czasu. Ułamek 0,5 razy dwa słowa daje jeden, więc obie
    // strony dostają dokładnie jedno słowo — czysty podział, nie zdegenerowany
    // do pustego tekstu po którejś stronie.
    const project = withDialogue(3000, 5000, {}, 'raz dwa')
    const next = applyProposal(project, { eventId: 'd1', kind: 'scenetrans' })
    const texts = next.shots.flatMap(s => s.dialogue).map(e => e.text)
    expect(texts).toEqual(['raz', 'dwa'])
  })

  it('nowa połówka dostaje segment w body następnego ujęcia i trafia do skompilowanego promptu', () => {
    // Sama flaga i sam obiekt w `shot.dialogue` nie wystarczą — kompilator
    // czyta `shot.body`, nie `shot.dialogue` wprost (`renderShot.ts`). Test,
    // który sprawdzałby tylko dane w `dialogue`, przeszedłby nawet gdyby
    // druga połówka była niewidoczna w eksportowanym prompcie.
    const project = withDialogue(3000, 5000, {}, 'slowo jeden dwa trzy')
    const next = applyProposal(project, { eventId: 'd1', kind: 'scenetrans' })
    const shotB = next.shots.find(s => s.id === 'b')
    if (!shotB) throw new Error('oczekiwano ujęcia b')
    const continuation = shotB.dialogue[0]
    if (!continuation) throw new Error('oczekiwano nowej połówki kwestii')

    expect(shotB.body).toContainEqual({ kind: 'dialogue', eventId: continuation.id })
    expect(buildPrompt(next).text).toContain('dwa trzy')
  })

  it('różnicowo: dwie flagi na jednym obiekcie łamią SCENETRANS_BOTH_SIDES, podział na dwa obiekty — nie', () => {
    // Odtwarza ręcznie kształt PIERWSZEJ (odrzuconej) wersji `applyProposal`
    // — obie flagi na tym samym zdarzeniu — żeby dowieść, że ten test
    // faktycznie rozróżnia dwa projekty modelu, a nie że walidator milczy
    // przy każdym wejściu. To jest dokładnie ta asercja, która złapałaby
    // pierwotny (błędny) projekt propozycji.
    const project = withDialogue(3000, 5000, {}, 'slowo jeden dwa trzy')
    const bothFlagsOnOneEvent: Project = {
      ...project,
      shots: project.shots.map(shot => ({
        ...shot,
        dialogue: shot.dialogue.map(event =>
          event.id === 'd1' ? { ...event, sceneTransBefore: true, sceneTransAfter: true } : event),
      })),
    }
    const brokenDiagnostics = buildPrompt(bothFlagsOnOneEvent).diagnostics
      .filter(d => d.ruleId === 'SCENETRANS_BOTH_SIDES')
    expect(brokenDiagnostics.length).toBeGreaterThan(0)

    const split = applyProposal(project, { eventId: 'd1', kind: 'scenetrans' })
    const splitDiagnostics = buildPrompt(split).diagnostics.filter(d => d.ruleId === 'SCENETRANS_BOTH_SIDES')
    expect(splitDiagnostics).toEqual([])
  })

  it('scenetrans o nieznanym identyfikatorze zwraca ten sam obiekt', () => {
    const project = withDialogue(3000, 5000)
    expect(applyProposal(project, { eventId: 'brak', kind: 'scenetrans' })).toBe(project)
  })
})

describe('applyProposal — cutoff', () => {
  it('cutoff ustawia swój znacznik i nie rusza pozostałych', () => {
    const next = applyProposal(withDialogue(7000, 9000), { eventId: 'd1', kind: 'cutoff' })
    const event = next.shots.flatMap(s => s.dialogue).find(e => e.id === 'd1')
    expect(event?.cutoff).toBe(true)
    expect(event?.sceneTransBefore).toBe(false)
  })

  it('propozycja o nieznanym identyfikatorze zwraca ten sam obiekt', () => {
    const project = withDialogue(1000, 2000)
    expect(applyProposal(project, { eventId: 'brak', kind: 'cutoff' })).toBe(project)
  })
})
