import { describe, expect, it } from 'vitest'
import { buildPrompt, type Project } from '@mmh3/shared'
import { applyProposal, dialogueProposals } from '../../src/timeline/proposals.js'
import { baseProject, emptyShot, lineFixture, speaker } from './fixtures.js'

const withDialogue = (
  startMs: number,
  endMs: number,
  extra: Partial<ReturnType<typeof lineFixture>> = {},
  text = 'domyslny tekst',
): Project => ({
  ...baseProject([
    { ...emptyShot('a', 0, 0), dialogue: [{ ...lineFixture('d1', ['s1'], text, startMs, endMs), ...extra }] },
    emptyShot('b', 1, 4000),
  ]),
  // Prawdziwy mówca, nie tylko id w `speakerIds` — od Rundy 2 podział
  // dokłada segment mówcy do `body` następnego ujęcia (patrz opis niżej), a
  // `renderSpeakerSegment` rzuca, gdy id nie rozwiązuje się do rekordu w
  // `project.speakers`. Bez tego każdy test wołający `buildPrompt` na
  // wyniku podziału dostałby pustą kompilację (`COMPILE_FAILED`) zamiast
  // realnego tekstu.
  speakers: [speaker('s1', 'S1')],
})

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

  // Kwestia zbyt krótka, żeby podzielić ją na dwa NIEPUSTE bloki <d> — patrz
  // `splitTextAtFraction`. Lepszy brak plakietki niż plakietka, która po
  // kliknięciu eksportuje `<d>[English] </d>`: schemat (`text: z.string()`,
  // bez `min(1)`) go nie odrzuci i żadna reguła walidatora tego nie łapie.
  it('nie proponuje scenetrans dla kwestii jednowyrazowej, mimo że geometrycznie przechodzi przez cięcie', () => {
    expect(dialogueProposals(withDialogue(3000, 5000, {}, 'jedno')).some(p => p.kind === 'scenetrans')).toBe(false)
  })

  it('nie proponuje scenetrans dla pustej kwestii', () => {
    expect(dialogueProposals(withDialogue(3000, 5000, {}, '')).some(p => p.kind === 'scenetrans')).toBe(false)
  })

  it('nie proponuje scenetrans dla kwestii złożonej z samych białych znaków', () => {
    expect(dialogueProposals(withDialogue(3000, 5000, {}, '   ')).some(p => p.kind === 'scenetrans')).toBe(false)
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

  it('kwestia jednowyrazowa wywołana wprost (z pominięciem listy propozycji) nie zmienia projektu', () => {
    // Druga linia obrony: nawet gdyby coś ominęło filtr w `dialogueProposals`
    // (stara propozycja trzymana w zamkniętym komponencie, ręczne wywołanie),
    // `applyProposal` sam odmawia podziału, którego nie da się wykonać bez
    // pustej strony.
    const project = withDialogue(3000, 5000, {}, 'jedno')
    expect(applyProposal(project, { eventId: 'd1', kind: 'scenetrans' })).toBe(project)
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

  it('do ujęcia z JUŻ istniejącą treścią w body: nowa połówka dostaje własny segment mówcy i nie skleja się z sąsiadem', () => {
    // Wszystkie pozostałe testy w tym pliku budują ujęcia przez `emptyShot`,
    // którego `body` jest zawsze puste — usterka z Rundy 2 (sklejona proza,
    // brak atrybucji mówcy) była niewidoczna właśnie dlatego, że nie było
    // niczego, z czym nowe segmenty mogłyby się skleić, ani niczego przed
    // segmentem dialogowym oryginału, z czego skopiować kształt mówcy. Tu
    // `body` obu ujęć jest ręcznie wypełnione — jak w prawdziwym projekcie —
    // żeby usterka miała szansę się ujawnić.
    const project: Project = {
      ...baseProject([
        {
          ...emptyShot('a', 0, 0),
          dialogue: [lineFixture('d1', ['s1'], 'slowo jeden dwa trzy', 3000, 5000)],
          body: [
            { kind: 'speaker', speakerIds: ['s1'], form: 'full' },
            { kind: 'text', text: ' ' },
            { kind: 'dialogue', eventId: 'd1' },
          ],
        },
        {
          ...emptyShot('b', 1, 4000),
          body: [{ kind: 'text', text: 'A wide street at dusk.' }],
        },
      ]),
      speakers: [speaker('s1', 'S1')],
    }
    const next = applyProposal(project, { eventId: 'd1', kind: 'scenetrans' })
    const text = buildPrompt(next).text

    // Rozpięte na CAŁĄ granicę zszycia (atrybucja mówcy → dialog → to, co
    // stało w `body` ujęcia b wcześniej), nie sam środek kwestii ("dwa
    // trzy") — krótszy substring przeszedłby nawet na sklejonym tekście bez
    // atrybucji, dokładnie tę usterkę, którą ta runda naprawia. Kształt
    // segmentu mówcy ('full', 'a woman (S1)') skopiowany z segmentu, który w
    // `body` ujęcia a stał tuż przed segmentem dialogowym oryginału.
    expect(text).toContain('a woman (S1) <scenetrans> says: <d>[English] dwa trzy</d> A wide street at dusk.')
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

describe('applyProposal — cutoff i scenetrans na tej samej kwestii', () => {
  it('kolejność „najpierw cutoff, potem scenetrans" (lewa plakietka, potem prawa) nie zostawia CUTOFF_AT_END zapalonego', () => {
    // Kwestia, która JEDNOCZEŚNIE przechodzi przez cięcie (3000–9000 mija
    // granicę ujęć w 4000) I wystaje poza materiał (durationMs=8000 z
    // `baseProject`) — obie plakietki stoją na tym samym klipie naraz
    // (patrz `dialogueProposals` i `DialogueTracks.tsx`), a kliknięcie od
    // lewej do prawej trafia najpierw w `cutoff`. To zwykła ścieżka, nie
    // naciągany przypadek.
    const project = withDialogue(3000, 9000, {}, 'slowo jeden dwa trzy')
    const afterCutoff = applyProposal(project, { eventId: 'd1', kind: 'cutoff' })
    const afterSplit = applyProposal(afterCutoff, { eventId: 'd1', kind: 'scenetrans' })

    const dialogue = afterSplit.shots.flatMap(s => s.dialogue)
    const before = dialogue.find(e => e.id === 'd1')
    const after = dialogue.find(e => e.id !== 'd1')
    if (!before || !after) throw new Error('oczekiwano dwóch połówek kwestii')

    // Granica cięcia (4000) leży W ŚRODKU materiału (durationMs=8000) —
    // pierwsza połówka NIE wystaje, więc jej `cutoff` musi się wyczyścić,
    // mimo że zwykły `...event` w spreadzie niósłby `true` z poprzedniego
    // kliknięcia.
    expect(before.endMs).toBe(4000)
    expect(before.cutoff).toBe(false)
    // Druga połówka dziedziczy koniec oryginału (9000), który NADAL wystaje
    // poza durationMs (8000) — to ona powinna nieść `cutoff`, nie na sztywno
    // `false`.
    expect(after.endMs).toBe(9000)
    expect(after.cutoff).toBe(true)

    const diagnostics = buildPrompt(afterSplit).diagnostics.filter(d => d.ruleId === 'CUTOFF_AT_END')
    expect(diagnostics).toEqual([])
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
