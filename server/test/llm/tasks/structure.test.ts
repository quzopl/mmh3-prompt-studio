import { describe, expect, it } from 'vitest'
import {
  applyOps,
  buildPrompt,
  isFrameAligned,
  orderStartTimes,
  parseProject,
  type Diagnostic,
  type Label,
  type Mode,
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

/**
 * `buildPrompt` — NIE gołe `validate(project, compile(project))` — bo to
 * `buildPrompt` rejestruje wszystkie reguły przez efekt uboczny
 * (`registerAllRules`, `shared/src/validate/rules/index.ts`). Runda 1
 * recenzji: wcześniejsza wersja tego pliku wołała `validate` bezpośrednio, bez
 * nigdy nie zarejestrowanych reguł — `allRules()` zwracał pustą listę,
 * `newDiagnostics` zawsze wychodziło puste, i test „żadna nowa diagnostyka"
 * przechodził niezależnie od tego, co robił kod. Ten sam wzorzec co
 * `web/test/timeline/createOnTrack.test.ts` (`diagnosticIds`).
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

  it('ujęcia z structureToPatch są już punktem stałym algorytmu porządkującego — dalsze przepuszczenie przez niego niczego nie rusza', () => {
    // `normalizeShots` (`web/src/timeline/normalize.ts`) sortuje po `startMs` i
    // woła DOKŁADNIE ten sam `orderStartTimes` z `@mmh3/shared`, którego używa
    // `structureToPatch` (runda 1 recenzji: wcześniej miały dwie osobne kopie
    // tego algorytmu, i się rozjechały o stałą `MIN_SHOT_FRAMES`). `server/`
    // nie importuje z `web/` (patrz brief zadania 6), ale może dowieść tej samej
    // własności — że wynik tego zadania jest już punktem stałym normalizacji —
    // wołając wprost tę jedną, wspólną definicję zamiast funkcji z `web/`.
    const result: StructureResult = {
      shots: [
        { startSeconds: 6, composition: 'a', action: 'trzecia' },
        { startSeconds: 0, composition: 'b', action: 'pierwsza' },
        { startSeconds: 3.2, composition: 'c', action: 'druga' },
      ],
    }
    const project = newProject()
    const patch = structureToPatch(result, project)
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'replaceShots') throw new Error('oczekiwano replaceShots')

    const starts = op.shots.map(s => s.startMs)
    expect(orderStartTimes(starts, project.video.durationMs)).toEqual(starts)
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

describe('structureToPatch — ruch kamery', () => {
  it('ruch kamery trafia do cameraMoves, ma odpowiadający segment w body i pojawia się w skompilowanym tekście', () => {
    const result: StructureResult = {
      shots: [{
        startSeconds: 0,
        composition: 'a wide shot of a harbor at dusk',
        action: 'a lone figure walks along the pier',
        cameraMove: 'push-in',
      }],
    }
    const before = newProject()
    const patch = structureToPatch(result, before)
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'replaceShots') throw new Error('oczekiwano replaceShots')
    const shot = op.shots[0]
    if (shot === undefined) throw new Error('brak ujęcia')

    expect(shot.cameraMoves).toHaveLength(1)
    expect(shot.cameraMoves[0]?.type).toBe('push-in')

    const cameraSegmentIndex = shot.body.findIndex(seg => seg.kind === 'camera')
    expect(cameraSegmentIndex).toBeGreaterThan(-1)
    const cameraSegment = shot.body[cameraSegmentIndex]
    expect(cameraSegment?.kind === 'camera' && cameraSegment.moveId).toBe(shot.cameraMoves[0]?.id)

    const after = applyOps(before, patch.ops)
    const { text } = buildPrompt(after)
    expect(text).toContain('The camera pushes in')
  })
})

describe('structureToPatch — proza skompilowana czytelnie', () => {
  it('segmenty w body są rozdzielone spacją, a nie sklejone w jeden ciąg', () => {
    // Odtwarza dokładnie znalezisko z rundy 1 recenzji: `renderSegments`
    // skleja `body` pustym stringiem, więc tekst, ruch kamery, mówca i dialog
    // dopisane bez separatora dają "suitcase.The camera pushes ina
    // woman...says:" — poprawny, kompilowalny projekt, ale nieczytelna proza,
    // której żadna reguła walidatora nie łapie.
    const result: StructureResult = {
      shots: [{
        startSeconds: 0,
        composition: 'a medium shot of a departure hall',
        action: 'a woman grips the handle of her suitcase.',
        cameraMove: 'push-in',
        speaker: 'S1',
        line: 'I am not getting on that train.',
      }],
    }
    const before = projectWithSpeaker()
    const patch = structureToPatch(result, before)
    const after = applyOps(before, patch.ops)
    const { text } = buildPrompt(after)

    expect(text).toContain('suitcase. The camera pushes in')
    expect(text).not.toContain('suitcase.The camera')
    expect(text).toContain('(S1) says:')
    expect(text).not.toContain(')says:')
  })

  it('fraza ruchu kamery kończy się własną kropką, żeby to, co po niej, nie czytało się jako jej dopełnienie', () => {
    // Runda 2 recenzji: sama spacja z rundy 1 nie wystarczała —
    // "...The camera pushes in a woman in a blue coat (S1) says:" czyta się
    // jak "pushes in [obiekt: kobietę]", realny błąd odczytu dla modelu
    // wideo, nie tylko brzydka proza. Ruch kamery musi kończyć WŁASNE zdanie.
    const result: StructureResult = {
      shots: [{
        startSeconds: 0,
        composition: 'a medium shot of a departure hall',
        action: 'a woman grips the handle of her suitcase',
        cameraMove: 'push-in',
        speaker: 'S1',
        line: 'I am not getting on that train.',
      }],
    }
    const before = projectWithSpeaker()
    const patch = structureToPatch(result, before)
    const after = applyOps(before, patch.ops)
    const { text } = buildPrompt(after)

    expect(text).toContain('The camera pushes in. ')
    expect(text).not.toContain('pushes in a woman')
    expect(text).not.toContain('pushes in the')
  })

  it('composeBodyText dopisuje kropkę na końcu akcji, gdy model jej nie podał', () => {
    const result: StructureResult = {
      shots: [{
        startSeconds: 0,
        composition: 'a wide shot of a quiet courtyard',
        // Celowo bez końcowej kropki — model nie zawsze ją doda.
        action: 'leaves drift across the stone floor',
        cameraMove: 'static',
      }],
    }
    const patch = structureToPatch(result, newProject())
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'replaceShots') throw new Error('oczekiwano replaceShots')
    const textSegment = op.shots[0]?.body[0]
    expect(textSegment?.kind === 'text' && textSegment.text.endsWith('.')).toBe(true)
  })

  it('ruch kamery jako ostatni segment (bez dialogu) nie zostawia sierocej kropki ani spacji na końcu', () => {
    const result: StructureResult = {
      shots: [{
        startSeconds: 0,
        composition: 'a wide shot of a quiet courtyard',
        action: 'leaves drift across the stone floor.',
        cameraMove: 'static',
      }],
    }
    const patch = structureToPatch(result, newProject())
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'replaceShots') throw new Error('oczekiwano replaceShots')
    const lastSegment = op.shots[0]?.body.at(-1)
    expect(lastSegment?.kind).toBe('camera')
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
    expect(shot.dialogue[0]?.language).toBe('English')
    expect(shot.body.some(seg => seg.kind === 'dialogue')).toBe(true)
    expect(shot.body.some(seg => seg.kind === 'speaker')).toBe(true)
  })

  it('kwestia w innym języku niż angielski niesie ten język do DialogueEvent zamiast domyślnego "English"', () => {
    const result: StructureResult = {
      shots: [{
        startSeconds: 0,
        composition: 'zbliżenie na kobietę',
        action: 'kobieta odwraca się w stronę okna',
        speaker: 'S1',
        line: 'Jeszcze zdążę zmienić zdanie.',
        language: 'Polish',
      }],
    }
    const patch = structureToPatch(result, projectWithSpeaker())
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'replaceShots') throw new Error('oczekiwano replaceShots')
    expect(op.shots[0]?.dialogue[0]?.language).toBe('Polish')

    const before = projectWithSpeaker()
    const after = applyOps(before, patch.ops)
    expect(buildPrompt(after).text).toContain('<d>[Polish] Jeszcze zdążę zmienić zdanie.</d>')
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

describe('structureToPatch — kotwice referencyjne', () => {
  function pictureLabel(id: string, index: number): Label {
    return { id, kind: 'picture', index, assetIds: [], definition: 'obraz referencyjny', role: 'ustanawiający', standalone: true }
  }

  function anchoredProject(mode: Mode, labels: Label[], anchors: Project['shots'][number]['anchors']): Project {
    const project = newProject()
    const shot = project.shots[0]
    if (shot === undefined) throw new Error('fixture bez ujęcia')
    return {
      ...project,
      mode,
      labels,
      shots: [{ ...shot, anchors }],
      // `newProject()` zostawia `overallSoundscape` puste, co samo w sobie
      // łamie `SOUNDSCAPE_SENTENCES` — niezwiązane z kotwicami, ale psułoby
      // sanity-check „projekt czysty przed operacją" tych testów. Wypełniamy,
      // żeby jedyną zmienną w grze były kotwice.
      audio: { ...project.audio, overallSoundscape: 'Distant traffic hums beyond the platform.' },
    }
  }

  it('I2VA: kotwica "picture-first" jest przenoszona na nowe pierwsze ujęcie', () => {
    const before = anchoredProject('I2VA', [pictureLabel('lbl1', 1)], ['picture-first'])
    expect(diagnosticsOf(before).filter(d => d.severity === 'error')).toEqual([])

    const result: StructureResult = {
      shots: [
        { startSeconds: 0, composition: 'a', action: 'pierwsza scena' },
        { startSeconds: 3, composition: 'b', action: 'druga scena' },
      ],
    }
    const patch = structureToPatch(result, before)
    const after = applyOps(before, patch.ops)

    expect(after.shots[0]?.anchors).toContain('picture-first')
    expect(after.shots[1]?.anchors).not.toContain('picture-first')
    assertNoUnexpectedDiagnostics(before, after)
  })

  it('L2VA: kotwica "picture-last" jest przenoszona na nowe ostatnie ujęcie', () => {
    const before = anchoredProject('L2VA', [pictureLabel('lbl1', 1)], ['picture-last'])
    expect(diagnosticsOf(before).filter(d => d.severity === 'error')).toEqual([])

    const result: StructureResult = {
      shots: [
        { startSeconds: 0, composition: 'a', action: 'pierwsza scena' },
        { startSeconds: 3, composition: 'b', action: 'druga scena' },
      ],
    }
    const patch = structureToPatch(result, before)
    const after = applyOps(before, patch.ops)

    expect(after.shots[after.shots.length - 1]?.anchors).toContain('picture-last')
    expect(after.shots[0]?.anchors).not.toContain('picture-last')
    assertNoUnexpectedDiagnostics(before, after)
  })

  it('FL2VA: obie kotwice trafiają na jedyne ujęcie, gdy model zwraca tylko jedno', () => {
    const before = anchoredProject('FL2VA', [pictureLabel('lbl1', 1), pictureLabel('lbl2', 2)], ['picture-first', 'picture-last'])
    expect(diagnosticsOf(before).filter(d => d.severity === 'error')).toEqual([])

    const result: StructureResult = {
      shots: [{ startSeconds: 0, composition: 'a', action: 'jedyna scena' }],
    }
    const patch = structureToPatch(result, before)
    const after = applyOps(before, patch.ops)

    expect(after.shots).toHaveLength(1)
    expect(after.shots[0]?.anchors).toEqual(expect.arrayContaining(['picture-first', 'picture-last']))
    assertNoUnexpectedDiagnostics(before, after)
  })

  it('projekt bez wcześniejszej kotwicy nie dostaje żadnej znikąd', () => {
    const before = newProject() // T2VA, bez etykiet i bez kotwic
    const result: StructureResult = { shots: [{ startSeconds: 0, composition: 'a', action: 'scena' }] }
    const patch = structureToPatch(result, before)
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'replaceShots') throw new Error('oczekiwano replaceShots')
    expect(op.shots[0]?.anchors).toEqual([])
  })

  it('REF: kotwica "keyframe" nie znika, choć żadna reguła walidatora jej nie sprawdza', () => {
    // `keyframe` (web/src/timeline/AnchorBadges.tsx) nie ma ustalonej strony —
    // użytkownik mógł ją postawić na dowolnym starym ujęciu, nie tylko
    // pierwszym czy ostatnim, a po wymianie kompletu ujęć nie ma jak odtworzyć
    // „to samo" ujęcie. Test sprawdza tylko, że decyzja NIE ZNIKA bez śladu —
    // nie że trafia na konkretną pozycję.
    const project = newProject()
    const shot = project.shots[0]
    if (shot === undefined) throw new Error('fixture bez ujęcia')
    const before: Project = { ...project, mode: 'REF', shots: [{ ...shot, anchors: ['keyframe'] }] }

    const result: StructureResult = {
      shots: [
        { startSeconds: 0, composition: 'a', action: 'pierwsza scena' },
        { startSeconds: 3, composition: 'b', action: 'druga scena' },
        { startSeconds: 6, composition: 'c', action: 'trzecia scena' },
      ],
    }
    const patch = structureToPatch(result, before)
    const after = applyOps(before, patch.ops)

    expect(after.shots.some(s => s.anchors.includes('keyframe'))).toBe(true)
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
    const patch = structureToPatch(buildResult(), before)
    const after = applyOps(before, patch.ops)
    assertNoUnexpectedDiagnostics(before, after)
  })

  it('wynik zastosowania łatki przechodzi parseProject', () => {
    const before = projectWithSpeaker()
    const patch = structureToPatch(buildResult(), before)
    const after = applyOps(before, patch.ops)
    expect(() => parseProject(after)).not.toThrow()
  })
})
