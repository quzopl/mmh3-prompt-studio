import { describe, expect, it } from 'vitest'
import {
  applyOps,
  buildPrompt,
  parseProject,
  type Diagnostic,
  type Project,
  type Speaker,
} from '@mmh3/shared'
import { redactTaskFor, redactToPatch, type RedactResult, type RedactTarget } from '../../../src/llm/tasks/redact.js'
import { newProject } from '../../fixtures/newProject.js'

/**
 * Testujemy `redactToPatch`, nie rozmowę z modelem — rozmowa (budowa
 * wiadomości, wymuszenie schematu, naprawa) jest wspólna dla wszystkich
 * czterech zadań i pokryta przez `run.test.ts` (zadanie 5). Ten sam podział
 * co `structure.test.ts` (zadanie 6).
 */

const speaker: Speaker = {
  id: 'sp1', code: 'S1', characterType: 'kobieta', age: '30s', gender: 'female',
  pitch: 'mid', timbre: 'warm', rate: 'even', accent: 'neutral', onScreen: true,
  fullDescriptor: 'kobieta w niebieskim płaszczu', shortDescriptor: 'kobieta',
}

/**
 * Projekt bez błędów walidatora, z wypełnionymi polami we WSZYSTKICH czterech
 * miejscach, które `redactToPatch` umie zaadresować: styl, treść ujęcia
 * (segment tekstowy), obie ścieżki dźwiękowe i opis mówcy. Treść polska —
 * dokładnie to, co redakcja ma zamienić na angielską.
 */
function cleanProject(): Project {
  const project = newProject()
  const shot = project.shots[0]
  if (shot === undefined) throw new Error('fixture bez ujęcia')
  return {
    ...project,
    style: 'Realistyczne ujęcia, naturalne światło.',
    speakers: [speaker],
    shots: [{
      ...shot,
      composition: 'szeroki plan pustego peronu o świcie',
      body: [{ kind: 'text', text: 'Kobieta stoi sama przy krawędzi peronu, ściskając walizkę.' }],
    }],
    audio: {
      overallSoundscape: 'W oddali słychać gwar ruchu ulicznego. Pociąg hamuje z metalicznym zgrzytem.',
      nonDiegeticMusic: 'Powolna melodia fortepianu gra nad rzadkimi smyczkami.',
    },
  }
}

// Przyjęte wyjątki od reguły „żadna nowa diagnostyka" — ustalone w poprzednich
// planach, wspólne dla wszystkich zadań językowych (patrz brief).
//
// Cztery pierwsze to reguły, których zapalenie jest UCZCIWYM skutkiem akcji, o
// którą użytkownik prosił (punkt 18
// `docs/superpowers/specs/2026-08-04-uwagi-do-planu-2.md`).
//
// Dwie ostatnie to reguły TREŚCI, dopisane w recenzji końcowej gałęzi (punkt
// 5): rozstrzygnięcie zadania 11 mówi, że schemat odpowiedzi modelu pilnuje
// KSZTAŁTU (liczba zdań, brak bloku `<d>`), a nie TREŚCI — więc słowo o
// nastroju w muzyce i kwestia dialogowa powtórzona w pejzażu to uczciwa
// informacja zwrotna na ekranie przeglądu, nie usterka kodu. Lista musiała je
// nazwać, żeby napisana reguła i napisane rozstrzygnięcie mówiły to samo
// (punkt 22 tego samego dokumentu). `SOUNDSCAPE_NO_DIALOGUE` niesie pod jednym
// identyfikatorem TAKŻE pytanie o kształt (blok `<d>`) — ono jest pilnowane w
// schemacie (`server/src/llm/tasks/audioFieldText.ts`) i ma tam własny test,
// więc przyjęcie identyfikatora tutaj nie zostawia go bez dowodu.
const ACCEPTED_NEW_DIAGNOSTICS = new Set([
  'SPEECH_FITS', 'SOUNDSCAPE_NA_ONLY_IF_SILENT', 'SPEAKER_SILENT_NO_ID', 'FL2VA_PREFER_SINGLE_SHOT',
  'MUSIC_NO_MOOD_WORDS', 'SOUNDSCAPE_NO_DIALOGUE',
])

/**
 * `buildPrompt` — NIE gołe `validate(project, compile(project))` — bo to
 * `buildPrompt` rejestruje wszystkie reguły przez efekt uboczny
 * (`registerAllRules`, `shared/src/validate/rules/index.ts`). Bez tego
 * `allRules()` zwraca pustą listę i test „żadna nowa diagnostyka" przechodzi
 * niezależnie od tego, co robi kod (runda 1 recenzji zadania 6).
 */
function diagnosticsOf(project: Project): Diagnostic[] {
  return buildPrompt(project).diagnostics
}

/** Zbiór różnicowy: diagnostyki obecne PO, których nie było PRZED. */
function newDiagnostics(before: Diagnostic[], after: Diagnostic[]): Diagnostic[] {
  const beforeKeys = new Set(before.map(d => JSON.stringify(d)))
  return after.filter(d => !beforeKeys.has(JSON.stringify(d)))
}

function assertNoUnexpectedDiagnostics(before: Project, after: Project): void {
  const added = newDiagnostics(diagnosticsOf(before), diagnosticsOf(after))
  const unexpected = added.filter(d => !ACCEPTED_NEW_DIAGNOSTICS.has(d.ruleId))
  expect(unexpected).toEqual([])
}

/**
 * Recenzja końcowa gałęzi, punkt 3: „the audio task tells the model never to
 * repeat spoken dialogue; the other two write the same field and say nothing".
 * Redakcja pojedynczego pola pisze do TYCH SAMYCH dwóch pól audio, więc niesie
 * teraz ten sam zakaz — a bez tej asercji skasowanie go z promptu zostawiłoby
 * cały plik zielony.
 */
describe('redactTaskFor — prompt systemowy zabrania znaczników i cytowania dialogu', () => {
  const system = (): string => {
    const messages = redactTaskFor({ kind: 'style' }).buildMessages({ text: 'Realistyczne ujęcia.' })
    return messages.find(m => m.role === 'system')?.content ?? ''
  }

  it('zabrania bloku <d> i znacznika języka', () => {
    expect(system()).toMatch(/never write a "<d>" tag/i)
    expect(system()).toMatch(/\[English\]/)
  })

  it('zabrania powtarzania kwestii dialogowej w polu audio', () => {
    expect(system()).toMatch(/never repeat or paraphrase spoken dialogue/i)
  })
})

describe('RedactTarget — bez wariantu dla kwestii dialogowej', () => {
  it('typ target nie ma wariantu wskazującego na DialogueEvent.text — wymuszone przez kompilator', () => {
    // Projekt z realną kwestią, żeby cel — gdyby dało się go skonstruować —
    // wskazywał na coś, co naprawdę istnieje, nie na zmyślony identyfikator.
    const base = cleanProject()
    const baseShot = base.shots[0]
    if (baseShot === undefined) throw new Error('fixture bez ujęcia')
    const project: Project = {
      ...base,
      shots: [{
        ...baseShot,
        dialogue: [{
          id: 'line-1',
          speakerIds: ['sp1'],
          verb: 'says',
          punctuation: ':',
          language: 'Polish',
          text: 'Jeszcze zdążę zmienić zdanie.',
          voiceover: false,
          sceneTransBefore: false,
          sceneTransAfter: false,
          cutoff: false,
          startMs: 0,
          endMs: 2000,
        }],
      }],
    }
    const event = project.shots[0]?.dialogue[0]
    if (event === undefined) throw new Error('fixture bez kwestii')

    // Gdyby `RedactTarget` miał wariant celujący w treść kwestii dialogowej,
    // poniższa linia przypisania przeszłaby bez błędu typów i
    // `@ts-expect-error` sam zgłosiłby błąd — „Unused '@ts-expect-error'
    // directive" — na etapie `tsc --noEmit`, nie w runtime testu. To jest
    // wymuszenie, o które prosi brief: kompilator, nie asercja.
    // @ts-expect-error — RedactTarget (unia z RedactTargetSchema) nie zna
    // wariantu 'dialogue'; jedynych czterech wariantów żaden nie adresuje
    // DialogueEvent.text.
    const forbidden: RedactTarget = { kind: 'dialogue', shotId: baseShot.id, eventId: event.id }

    expect(forbidden).toBeDefined()
  })
})

describe('redactToPatch — cztery rodzaje celu, cztery rodzaje operacji', () => {
  it('target { kind: "style" } tworzy setStyle', () => {
    const before = cleanProject()
    const result: RedactResult = { english: 'Realistic footage, natural light.' }
    const target: RedactTarget = { kind: 'style' }
    const patch = redactToPatch(result, target, before)

    expect(patch.ops).toHaveLength(1)
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'setStyle') throw new Error('oczekiwano setStyle')
    expect(op.text).toBe('Realistic footage, natural light.')
  })

  it('target { kind: "shotText" } tworzy setShotText ze wskazanym ujęciem i indeksem segmentu', () => {
    const before = cleanProject()
    const shot = before.shots[0]
    if (shot === undefined) throw new Error('fixture bez ujęcia')
    const result: RedactResult = { english: 'A woman stands alone at the edge of the platform, gripping a suitcase.' }
    const target: RedactTarget = { kind: 'shotText', shotId: shot.id, segmentIndex: 0 }
    const patch = redactToPatch(result, target, before)

    expect(patch.ops).toHaveLength(1)
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'setShotText') throw new Error('oczekiwano setShotText')
    expect(op.shotId).toBe(shot.id)
    expect(op.segmentIndex).toBe(0)
    expect(op.text).toBe('A woman stands alone at the edge of the platform, gripping a suitcase.')
  })

  it('target { kind: "audio" } tworzy setAudio ze wskazanym polem', () => {
    const before = cleanProject()
    const result: RedactResult = {
      english: 'Distant traffic hums beyond the platform. A train brakes with a long metallic screech.',
    }
    const target: RedactTarget = { kind: 'audio', field: 'overallSoundscape' }
    const patch = redactToPatch(result, target, before)

    expect(patch.ops).toHaveLength(1)
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'setAudio') throw new Error('oczekiwano setAudio')
    expect(op.field).toBe('overallSoundscape')
    expect(op.text).toBe('Distant traffic hums beyond the platform. A train brakes with a long metallic screech.')
  })

  it('target { kind: "speaker" } tworzy setSpeakerDescriptor ze wskazanym mówcą i polem', () => {
    const before = cleanProject()
    const result: RedactResult = { english: 'a woman in a blue coat' }
    const target: RedactTarget = { kind: 'speaker', speakerId: 'sp1', field: 'fullDescriptor' }
    const patch = redactToPatch(result, target, before)

    expect(patch.ops).toHaveLength(1)
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'setSpeakerDescriptor') throw new Error('oczekiwano setSpeakerDescriptor')
    expect(op.speakerId).toBe('sp1')
    expect(op.field).toBe('fullDescriptor')
    expect(op.text).toBe('a woman in a blue coat')
  })

  it('target { kind: "shotText" } wskazujący segment inny niż tekstowy nie tworzy żadnej operacji', () => {
    const before = cleanProject()
    const shot = before.shots[0]
    if (shot === undefined) throw new Error('fixture bez ujęcia')
    const withCameraSegment: Project = {
      ...before,
      shots: [{
        ...shot,
        cameraMoves: [{ id: 'move-1', type: 'static', startMs: 0, endMs: 8000 }],
        body: [{ kind: 'camera', moveId: 'move-1' }],
      }],
    }
    const result: RedactResult = { english: 'The camera stays still.' }
    const target: RedactTarget = { kind: 'shotText', shotId: shot.id, segmentIndex: 0 }
    const patch = redactToPatch(result, target, withCameraSegment)

    expect(patch.ops).toEqual([])
  })
})

describe('redactToPatch — wynik pusty albo bez zmian', () => {
  it('pusty wynik modelu nie tworzy operacji zastępującej treść pustką', () => {
    const before = cleanProject()
    const result: RedactResult = { english: '' }
    const target: RedactTarget = { kind: 'style' }
    const patch = redactToPatch(result, target, before)
    expect(patch.ops).toEqual([])
  })

  it('wynik złożony z samych białych znaków też liczy się jako pusty', () => {
    const before = cleanProject()
    const result: RedactResult = { english: '   \n  ' }
    const target: RedactTarget = { kind: 'audio', field: 'nonDiegeticMusic' }
    const patch = redactToPatch(result, target, before)
    expect(patch.ops).toEqual([])
  })

  it('wynik identyczny z bieżącą treścią celu nie tworzy operacji w ogóle — nie ma czego przyjmować', () => {
    const before = cleanProject()
    const result: RedactResult = { english: before.style }
    const target: RedactTarget = { kind: 'style' }
    const patch = redactToPatch(result, target, before)
    expect(patch.ops).toEqual([])
  })

  it('różnica tylko w otaczających białych znakach też liczy się jako brak zmiany', () => {
    const before = cleanProject()
    const result: RedactResult = { english: `  ${before.style}  ` }
    const target: RedactTarget = { kind: 'style' }
    const patch = redactToPatch(result, target, before)
    expect(patch.ops).toEqual([])
  })
})

describe('redactToPatch — niezmienniki projektu', () => {
  it('łatka zastosowana do czystego projektu nie wprowadza diagnostyki poza przyjętymi wyjątkami', () => {
    const before = cleanProject()
    const shot = before.shots[0]
    if (shot === undefined) throw new Error('fixture bez ujęcia')

    const ops = [
      redactToPatch({ english: 'Realistic footage, natural daylight.' }, { kind: 'style' }, before).ops,
      redactToPatch(
        { english: 'A woman stands alone at the edge of the platform, gripping a suitcase.' },
        { kind: 'shotText', shotId: shot.id, segmentIndex: 0 },
        before,
      ).ops,
      redactToPatch(
        { english: 'Distant traffic hums beyond the platform. A train brakes with a long metallic screech.' },
        { kind: 'audio', field: 'overallSoundscape' },
        before,
      ).ops,
      redactToPatch(
        { english: 'A slow piano melody plays over sparse strings.' },
        { kind: 'audio', field: 'nonDiegeticMusic' },
        before,
      ).ops,
      redactToPatch(
        { english: 'a woman in a blue coat' },
        { kind: 'speaker', speakerId: 'sp1', field: 'fullDescriptor' },
        before,
      ).ops,
    ].flat()
    expect(ops).toHaveLength(5)

    const after = applyOps(before, ops)
    assertNoUnexpectedDiagnostics(before, after)
  })

  it('wynik zastosowania łatki przechodzi parseProject', () => {
    const before = cleanProject()
    const shot = before.shots[0]
    if (shot === undefined) throw new Error('fixture bez ujęcia')

    const ops = [
      redactToPatch({ english: 'Realistic footage, natural daylight.' }, { kind: 'style' }, before).ops,
      redactToPatch(
        { english: 'A woman stands alone at the edge of the platform, gripping a suitcase.' },
        { kind: 'shotText', shotId: shot.id, segmentIndex: 0 },
        before,
      ).ops,
      redactToPatch(
        { english: 'a woman in a blue coat' },
        { kind: 'speaker', speakerId: 'sp1', field: 'fullDescriptor' },
        before,
      ).ops,
    ].flat()

    const after = applyOps(before, ops)
    expect(() => parseProject(after)).not.toThrow()
  })
})

/**
 * Fix round 2/5, zadanie 11, punkt 2: `redactToPatch` opakowuje w `setAudio`
 * cokolwiek dostanie w `english` — ta sama luka co w `audio.ts` przed fix
 * round 1 (siedem zdań w polu `overallSoundscape` zapala
 * `SOUNDSCAPE_SENTENCES` na projekcie, który tej diagnostyki nie miał), tylko
 * dostępna przez inne drzwi (redakcja PL→EN, nie podpowiedź audio). Testy
 * niżej pilnują SCHEMATU (`redactTaskFor(target).schema`), nie
 * `redactToPatch` — to jedyne miejsce w tym łańcuchu, które ma prawo
 * odrzucić złą odpowiedź i dać modelowi drugą próbę (`runTask`).
 */
describe('redactTaskFor — schemat zależny od celu pilnuje liczby zdań dla pól audio (fix round 2/5, punkt 2)', () => {
  const sentences = (count: number, prefix: string): string =>
    Array.from({ length: count }, (_, i) => `${prefix} ${i + 1} is happening now`).join('. ') + '.'

  it('cel audio/overallSoundscape: siedem zdań (poza 1–4) odrzucone przez schemat', () => {
    const schema = redactTaskFor({ kind: 'audio', field: 'overallSoundscape' }).schema
    const result = schema.safeParse({ english: sentences(7, 'Wind') })
    expect(result.success).toBe(false)
  })

  it('cel audio/overallSoundscape: dwa zdania (w zakresie 1–4) przyjęte', () => {
    const schema = redactTaskFor({ kind: 'audio', field: 'overallSoundscape' }).schema
    const result = schema.safeParse({ english: sentences(2, 'Wind') })
    expect(result.success).toBe(true)
  })

  it('cel audio/nonDiegeticMusic: pięć zdań (poza 1–3) odrzucone przez schemat', () => {
    const schema = redactTaskFor({ kind: 'audio', field: 'nonDiegeticMusic' }).schema
    const result = schema.safeParse({ english: sentences(5, 'A drum') })
    expect(result.success).toBe(false)
  })

  it('cel audio/nonDiegeticMusic: puste pole i "N/A" zawsze przyjęte', () => {
    const schema = redactTaskFor({ kind: 'audio', field: 'nonDiegeticMusic' }).schema
    expect(schema.safeParse({ english: '' }).success).toBe(true)
    expect(schema.safeParse({ english: 'N/A' }).success).toBe(true)
  })

  it('cel NIE-audio (style): siedem zdań przyjęte bez ograniczeń — reguła dotyczy tylko pól audio', () => {
    const schema = redactTaskFor({ kind: 'style' }).schema
    const result = schema.safeParse({ english: sentences(7, 'A wide shot') })
    expect(result.success).toBe(true)
  })

  it('cel NIE-audio (speaker): siedem zdań przyjęte bez ograniczeń', () => {
    const schema = redactTaskFor({ kind: 'speaker', speakerId: 'sp1', field: 'fullDescriptor' }).schema
    const result = schema.safeParse({ english: sentences(7, 'A tall woman') })
    expect(result.success).toBe(true)
  })

  // Recenzja końcowa gałęzi, punkt 3: DRUGIE z trojga drzwi do tych samych
  // dwóch pól (pierwsze — `audio.ts`, trzecie — `translateAll.ts`). Straż
  // przyszła z tego samego wspólnego modułu, więc te trzy schematy nie mogą
  // się już rozjechać.
  it('cel audio: blok <d> odrzucony, choć liczba zdań się zgadza', () => {
    const schema = redactTaskFor({ kind: 'audio', field: 'overallSoundscape' }).schema
    const result = schema.safeParse({ english: 'Rain falls and a woman says <d>Wait for me</d>.' })
    expect(result.success).toBe(false)
  })

  it('cel NIE-audio (style): ten sam blok <d> przechodzi — reguła należy do pól audio', () => {
    const schema = redactTaskFor({ kind: 'style' }).schema
    const result = schema.safeParse({ english: 'Neo-noir with <d> somewhere in the text.' })
    expect(result.success).toBe(true)
  })
})
