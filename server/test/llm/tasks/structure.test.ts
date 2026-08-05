import { describe, expect, it } from 'vitest'
import {
  applyOps,
  compile,
  isFrameAligned,
  parseProject,
  validate,
  type Diagnostic,
  type Project,
  type Speaker,
} from '@mmh3/shared'
import { StructureShotSchema, structureToPatch, type StructureResult } from '../../../src/llm/tasks/structure.js'
import { newProject } from '../../fixtures/newProject.js'

/**
 * Testujemy `structureToPatch`, nie rozmowę z modelem — rozmowa (budowa
 * wiadomości, wymuszenie schematu, naprawa) jest wspólna dla wszystkich
 * czterech zadań i pokryta przez `run.test.ts` (zadanie 5).
 */

const speaker: Speaker = {
  id: 'sp1', code: 'S1', characterType: 'kobieta', age: '30s', gender: 'female',
  pitch: 'mid', timbre: 'warm', rate: 'even', accent: 'neutral', onScreen: true,
  fullDescriptor: 'a woman in a blue coat', shortDescriptor: 'the woman',
}

const projectWithSpeaker = (): Project => ({ ...newProject(), speakers: [speaker] })

// Przyjęte wyjątki od reguły „żadna nowa diagnostyka" — ustalone w poprzednich
// planach, wspólne dla wszystkich czterech zadań językowych (patrz brief).
const ACCEPTED_NEW_DIAGNOSTICS = new Set([
  'SPEECH_FITS', 'SOUNDSCAPE_NA_ONLY_IF_SILENT', 'SPEAKER_SILENT_NO_ID', 'FL2VA_PREFER_SINGLE_SHOT',
])

function diagnosticsOf(project: Project): Diagnostic[] {
  return validate(project, compile(project))
}

/** Zbiór różnicowy: diagnostyki obecne PO, których nie było PRZED. */
function newDiagnostics(before: Diagnostic[], after: Diagnostic[]): Diagnostic[] {
  const beforeKeys = new Set(before.map(d => JSON.stringify(d)))
  return after.filter(d => !beforeKeys.has(JSON.stringify(d)))
}

describe('structureToPatch — puste ujęcia', () => {
  it('puste shots w odpowiedzi dają łatkę bez operacji, a nie ujęcie zerowej długości', () => {
    const result: StructureResult = { shots: [] }
    const patch = structureToPatch(result, newProject())
    expect(patch.ops).toEqual([])
  })
})

describe('structureToPatch — czas', () => {
  it('czasy w sekundach zamieniają się na milisekundy przyciągnięte do siatki klatek 24 fps', () => {
    const result: StructureResult = {
      shots: [
        { startSeconds: 0, composition: 'szeroki plan ulicy', action: 'przechodnie mijają się w deszczu' },
        { startSeconds: 1.49, composition: 'zbliżenie na parasol', action: 'krople spływają po materiale' },
      ],
    }
    const patch = structureToPatch(result, newProject())
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'replaceShots') throw new Error('oczekiwano replaceShots')

    for (const shot of op.shots) {
      expect(isFrameAligned(shot.startMs)).toBe(true)
    }
    expect(op.shots[0]?.startMs).toBe(0)
    // 1.49 s ≈ 35.76 klatki przy 24 fps → zaokrąglenie w górę do klatki 36 → 1500 ms.
    expect(op.shots[1]?.startMs).toBe(1500)
  })

  it('ujęcia wychodzą posortowane i pierwsze zaczyna się od zera, niezależnie od kolejności w odpowiedzi modelu', () => {
    const result: StructureResult = {
      shots: [
        { startSeconds: 5, composition: 'kompozycja-późna', action: 'trzecia w kolejności' },
        { startSeconds: 0.1, composition: 'kompozycja-wczesna', action: 'pierwsza w kolejności' },
        { startSeconds: 2.5, composition: 'kompozycja-środkowa', action: 'druga w kolejności' },
      ],
    }
    const patch = structureToPatch(result, newProject())
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'replaceShots') throw new Error('oczekiwano replaceShots')

    expect(op.shots).toHaveLength(3)
    // Treść musi wędrować razem z poprawionym czasem — posortowane mają być
    // ujęcia, nie same liczby w oderwaniu od tego, co opisywały.
    expect(op.shots[0]?.composition).toBe('kompozycja-wczesna')
    expect(op.shots[1]?.composition).toBe('kompozycja-środkowa')
    expect(op.shots[2]?.composition).toBe('kompozycja-późna')

    expect(op.shots[0]?.startMs).toBe(0)
    expect(op.shots[0]?.index).toBe(0)
    expect(op.shots[1]?.index).toBe(1)
    expect(op.shots[2]?.index).toBe(2)
    const starts = op.shots.map(s => s.startMs)
    expect(starts[1]).toBeGreaterThan(starts[0] ?? 0)
    expect(starts[2]).toBeGreaterThan(starts[1] ?? 0)
  })
})

describe('StructureShotSchema — słownik ruchów kamery', () => {
  it('ruch kamery spoza słownika guide\'a nie przechodzi przez schemat', () => {
    const result = StructureShotSchema.safeParse({
      startSeconds: 0,
      composition: 'zbliżenie na dłonie',
      action: 'palce zaciskają się na filiżance',
      cameraMove: 'barrel-roll',
    })
    expect(result.success).toBe(false)
  })

  it('ruch kamery ze słownika guide\'a przechodzi przez schemat', () => {
    const result = StructureShotSchema.safeParse({
      startSeconds: 0,
      composition: 'zbliżenie na dłonie',
      action: 'palce zaciskają się na filiżance',
      cameraMove: 'push-in',
    })
    expect(result.success).toBe(true)
  })
})

describe('structureToPatch — mówca kwestii', () => {
  it('kwestia z pasującym mówcą tworzy DialogueEvent przypisany do jego id', () => {
    const result: StructureResult = {
      shots: [{
        startSeconds: 0,
        composition: 'zbliżenie na kobietę',
        action: 'kobieta odwraca się w stronę okna',
        speaker: 'S1',
        line: 'Nie sądziłam, że jeszcze tu wrócisz.',
      }],
    }
    const patch = structureToPatch(result, projectWithSpeaker())
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'replaceShots') throw new Error('oczekiwano replaceShots')
    const shot = op.shots[0]
    if (shot === undefined) throw new Error('brak ujęcia')

    expect(shot.dialogue).toHaveLength(1)
    expect(shot.dialogue[0]?.speakerIds).toEqual(['sp1'])
    expect(shot.body.some(seg => seg.kind === 'dialogue')).toBe(true)
    expect(shot.body.some(seg => seg.kind === 'speaker')).toBe(true)
  })

  it('kwestia bez pasującego mówcy nie tworzy DialogueEvent bez speakerIds i zostaje opisana w etykiecie operacji', () => {
    const result: StructureResult = {
      shots: [{
        startSeconds: 0,
        composition: 'zbliżenie na nieznaną postać',
        action: 'postać unosi rękę',
        speaker: 'S9',
        line: 'To zdanie nie powinno trafić do projektu.',
      }],
    }
    const patch = structureToPatch(result, projectWithSpeaker())
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'replaceShots') throw new Error('oczekiwano replaceShots')
    const shot = op.shots[0]
    if (shot === undefined) throw new Error('brak ujęcia')

    expect(shot.dialogue).toEqual([])
    expect(shot.body.some(seg => seg.kind === 'dialogue')).toBe(false)
    expect(shot.body.some(seg => seg.kind === 'speaker')).toBe(false)
    expect(op.label).toContain('S9')
    expect(op.label).toContain('To zdanie nie powinno trafić do projektu.')
  })

  it('kwestia bez podanego mówcy w ogóle też zostaje pominięta, nie odrzucona z błędem', () => {
    const result: StructureResult = {
      shots: [{
        startSeconds: 0,
        composition: 'plan ogólny placu',
        action: 'głos dobiega zza kadru',
        line: 'Kto tam jest?',
      }],
    }
    const patch = structureToPatch(result, projectWithSpeaker())
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'replaceShots') throw new Error('oczekiwano replaceShots')
    expect(op.shots[0]?.dialogue).toEqual([])
    expect(op.label).toContain('Kto tam jest?')
  })
})

describe('structureToPatch — niezmienniki projektu', () => {
  const buildResult = (): StructureResult => ({
    shots: [
      {
        startSeconds: 0,
        composition: 'szeroki plan pustego peronu o świcie',
        action: 'kobieta stoi sama z walizką przy krawędzi peronu',
        cameraMove: 'push-in',
        speaker: 'S1',
        line: 'Jeszcze zdążę zmienić zdanie.',
      },
      {
        startSeconds: 4,
        composition: 'zbliżenie na tablicę odjazdów pociągów',
        action: 'numer połączenia zmienia się na tablicy',
      },
    ],
  })

  it('łatka zastosowana do czystego projektu nie wprowadza diagnostyki poza przyjętymi wyjątkami', () => {
    const before = projectWithSpeaker()
    const beforeDiagnostics = diagnosticsOf(before)

    const patch = structureToPatch(buildResult(), before)
    const after = applyOps(before, patch.ops)
    const afterDiagnostics = diagnosticsOf(after)

    const added = newDiagnostics(beforeDiagnostics, afterDiagnostics)
    const unexpected = added.filter(d => !ACCEPTED_NEW_DIAGNOSTICS.has(d.ruleId))
    expect(unexpected).toEqual([])
  })

  it('wynik zastosowania łatki przechodzi parseProject', () => {
    const before = projectWithSpeaker()
    const patch = structureToPatch(buildResult(), before)
    const after = applyOps(before, patch.ops)
    expect(() => parseProject(after)).not.toThrow()
  })
})
