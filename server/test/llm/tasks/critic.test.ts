import { describe, expect, it } from 'vitest'
import type { Project, Speaker } from '@mmh3/shared'
import {
  CriticNoteSchema, criticAllowedRefs, criticToNotes,
  type CriticNote, type CriticResult,
} from '../../../src/llm/tasks/critic.js'
import { newProject } from '../../fixtures/newProject.js'

/**
 * Testujemy `criticToNotes` (i `criticAllowedRefs`, na której się opiera), nie
 * rozmowę z modelem — rozmowa (budowa wiadomości, wymuszenie schematu,
 * naprawa) jest wspólna dla wszystkich czterech zadań i pokryta przez
 * `run.test.ts` (zadanie 5). Ten sam podział co `redact.test.ts` /
 * `structure.test.ts` / `audio.test.ts` (zadania 6–8).
 */

const speaker: Speaker = {
  id: 'sp1', code: 'S1', characterType: 'kobieta', age: '30s', gender: 'female',
  pitch: 'mid', timbre: 'warm', rate: 'even', accent: 'neutral', onScreen: true,
  fullDescriptor: 'a woman in a blue coat', shortDescriptor: 'the woman',
}

/** Projekt z jednym ujęciem, jednym mówcą i jedną kwestią dialogową — daje `criticAllowedRefs` czego dotyczyć. */
function projectWithShotAndSpeaker(): Project {
  const project = newProject()
  const shot = project.shots[0]
  if (shot === undefined) throw new Error('fixture bez ujęcia')
  return {
    ...project,
    speakers: [speaker],
    shots: [{
      ...shot,
      dialogue: [{
        id: 'line-1',
        speakerIds: ['sp1'],
        verb: 'says',
        punctuation: ':',
        language: 'English',
        text: 'I still have time to change my mind.',
        voiceover: false,
        sceneTransBefore: false,
        sceneTransAfter: false,
        cutoff: false,
        startMs: 0,
        endMs: 2000,
      }],
      body: [
        { kind: 'text', text: 'A woman stands alone at the edge of the platform.' },
        { kind: 'speaker', speakerIds: ['sp1'], form: 'full' },
        { kind: 'dialogue', eventId: 'line-1' },
      ],
    }],
  }
}

describe('CriticNoteSchema — severity zamknięta na dwie wartości', () => {
  it('severity spoza "hint"/"warning" nie przechodzi schematu', () => {
    const result = CriticNoteSchema.safeParse({
      ref: { kind: 'shot', id: 's1' },
      message: 'To ujęcie trwa za długo w stosunku do treści.',
      severity: 'critical',
    })
    expect(result.success).toBe(false)
  })

  it('severity "hint" i "warning" przechodzą schemat', () => {
    const hint = CriticNoteSchema.safeParse({ ref: { kind: 'shot', id: 's1' }, message: 'ok', severity: 'hint' })
    const warning = CriticNoteSchema.safeParse({ ref: { kind: 'shot', id: 's1' }, message: 'ok', severity: 'warning' })
    expect(hint.success).toBe(true)
    expect(warning.success).toBe(true)
  })

  it('kind referencji spoza słownika ObjectRefKind też nie przechodzi schematu', () => {
    const result = CriticNoteSchema.safeParse({
      ref: { kind: 'scene', id: 's1' },
      message: 'ok',
      severity: 'hint',
    })
    expect(result.success).toBe(false)
  })
})

describe('criticAllowedRefs — pokrywa audio, mimo że kompilator nie generuje dla niego tokenu', () => {
  it('lista zawiera audio:overallSoundscape i audio:nonDiegeticMusic', () => {
    const refs = criticAllowedRefs(projectWithShotAndSpeaker())
    expect(refs).toContainEqual({ kind: 'audio', id: 'overallSoundscape' })
    expect(refs).toContainEqual({ kind: 'audio', id: 'nonDiegeticMusic' })
  })

  it('lista zawiera ujęcie, mówcę i kwestię dialogową obecne w projekcie', () => {
    const refs = criticAllowedRefs(projectWithShotAndSpeaker())
    expect(refs).toContainEqual({ kind: 'shot', id: 's1' })
    expect(refs).toContainEqual({ kind: 'speaker', id: 'sp1' })
    expect(refs).toContainEqual({ kind: 'dialogue', id: 'line-1' })
  })
})

describe('criticToNotes — uwaga na nieistniejący obiekt jest odrzucana', () => {
  it('uwaga ze wskaźnikiem na id spoza listy dozwolonych identyfikatorów nie trafia do wyniku', () => {
    const allowedRefs = criticAllowedRefs(projectWithShotAndSpeaker())
    const result: CriticResult = {
      notes: [
        { ref: { kind: 'shot', id: 's1' }, message: 'To ujęcie trwa za długo.', severity: 'hint' },
        { ref: { kind: 'shot', id: 'ghost-99' }, message: 'Ujęcie, które model sobie wymyślił.', severity: 'warning' },
      ],
    }
    const notes = criticToNotes(result, allowedRefs)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.ref).toEqual({ kind: 'shot', id: 's1' })
  })

  it('uwaga z poprawnym id, ale niewłaściwym kind (np. speaker zamiast shot) też jest odrzucana', () => {
    // `s1` jest prawdziwym id, ale ujęcia, nie mówcy — para (kind, id) musi
    // się zgadzać w całości, nie sam `id` w oderwaniu od `kind`.
    const allowedRefs = criticAllowedRefs(projectWithShotAndSpeaker())
    const result: CriticResult = {
      notes: [{ ref: { kind: 'speaker', id: 's1' }, message: 'Zła para kind/id.', severity: 'hint' }],
    }
    const notes = criticToNotes(result, allowedRefs)
    expect(notes).toEqual([])
  })

  it('uwaga wskazująca audio:overallSoundscape (bez własnego tokenu w skompilowanym tekście) jest akceptowana', () => {
    const allowedRefs = criticAllowedRefs(projectWithShotAndSpeaker())
    const result: CriticResult = {
      notes: [{
        ref: { kind: 'audio', id: 'overallSoundscape' },
        message: 'Pejzaż dźwiękowy jest pusty, choć ujęcie ma dialog.',
        severity: 'warning',
      }],
    }
    const notes = criticToNotes(result, allowedRefs)
    expect(notes).toHaveLength(1)
  })
})

describe('criticToNotes — uwaga bez treści jest odrzucana', () => {
  it('treść złożona z samych białych znaków nie trafia do wyniku, realna uwaga obok niej trafia', () => {
    const allowedRefs = criticAllowedRefs(projectWithShotAndSpeaker())
    const result: CriticResult = {
      notes: [
        { ref: { kind: 'shot', id: 's1' }, message: '   ', severity: 'hint' },
        { ref: { kind: 'shot', id: 's1' }, message: 'Realna uwaga o tym ujęciu.', severity: 'hint' },
      ],
    }
    const notes = criticToNotes(result, allowedRefs)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.message).toBe('Realna uwaga o tym ujęciu.')
  })

  it('pusty ciąg (bez białych znaków w ogóle) też jest odrzucany', () => {
    const allowedRefs = criticAllowedRefs(projectWithShotAndSpeaker())
    const result: CriticResult = {
      notes: [{ ref: { kind: 'shot', id: 's1' }, message: '', severity: 'hint' }],
    }
    const notes = criticToNotes(result, allowedRefs)
    expect(notes).toEqual([])
  })
})

describe('criticToNotes — krytyk zwraca uwagi, nie łatkę', () => {
  it('wynik jest listą CriticNote bez pola ops — sprawdzone w runtime i wymuszone przez kompilator', () => {
    const allowedRefs = criticAllowedRefs(projectWithShotAndSpeaker())
    const result: CriticResult = {
      notes: [{ ref: { kind: 'shot', id: 's1' }, message: 'To ujęcie trwa za długo w stosunku do treści.', severity: 'hint' }],
    }
    const notes: CriticNote[] = criticToNotes(result, allowedRefs)

    expect(Array.isArray(notes)).toBe(true)
    expect(notes).toEqual([
      { ref: { kind: 'shot', id: 's1' }, message: 'To ujęcie trwa za długo w stosunku do treści.', severity: 'hint' },
    ])

    // Gdyby `criticToNotes` zwracał `ProjectPatch` zamiast `CriticNote[]` (jak
    // pozostałe trzy zadania), poniższa linia przeszłaby bez błędu typów —
    // `ProjectPatch` ma pole `ops`, `CriticNote[]` go nie ma. `@ts-expect-error`
    // sam zgłosiłby błąd ("Unused '@ts-expect-error' directive") na etapie
    // `tsc --noEmit`, gdyby ta różnica kiedyś zniknęła.
    // @ts-expect-error — `CriticNote[]` (zwykła tablica) nie ma pola `ops`.
    const opsField = notes.ops
    expect(opsField).toBeUndefined()
  })
})
