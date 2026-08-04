import { describe, it, expect } from 'vitest'
import { speechRules, estimateSpeechMs } from '../../../src/validate/rules/speech.js'
import { validateWith } from '../../../src/validate/validate.js'
import { compile } from '../../../src/compile/compile.js'
import { t2vaProject, i2vaProject } from '../../golden/fixtures/base.js'
import { refProject } from '../../golden/fixtures/ref.js'
import type { Project } from '../../../src/model/types.js'

const run = (p: Project) => validateWith(speechRules, p, compile(p)).map(d => d.ruleId)

const withDialogue = (p: Project, patch: Record<string, unknown>): Project => {
  const shots = [...p.shots]
  shots[0] = { ...shots[0]!, dialogue: [{ ...shots[0]!.dialogue[0]!, ...patch }] }
  return { ...p, shots }
}

describe('estimateSpeechMs', () => {
  it('szacuje czas mowy z liczby słów', () => {
    expect(estimateSpeechMs('First batch of the morning.')).toBe(1852)
    expect(estimateSpeechMs('')).toBe(0)
  })
})

describe('reguły mowy', () => {
  it('nie zgłasza nic dla projektów złotych', () => {
    expect(run(t2vaProject)).toEqual([])
    expect(run(i2vaProject)).toEqual([])
    expect(run(refProject)).toEqual([])
  })

  it('SPEAKER_ID_STABLE — dwaj mówcy z tym samym kodem', () => {
    const speakers = [
      t2vaProject.speakers[0]!,
      { ...t2vaProject.speakers[0]!, id: 'sp2' },
    ]
    expect(run({ ...t2vaProject, speakers })).toContain('SPEAKER_ID_STABLE')
  })

  it('SPEAKER_SILENT_NO_ID — mówca bez żadnej kwestii', () => {
    const speakers = [
      ...t2vaProject.speakers,
      { ...t2vaProject.speakers[0]!, id: 'sp9', code: 'S9' },
    ]
    expect(run({ ...t2vaProject, speakers })).toContain('SPEAKER_SILENT_NO_ID')
  })

  it('SPEAKER_FIRST_INTRO — pierwsze wystąpienie bez pełnego opisu', () => {
    const shots = [...t2vaProject.shots]
    shots[0] = {
      ...shots[0]!,
      body: shots[0]!.body.map(s => s.kind === 'speaker' ? { ...s, form: 'idOnly' as const } : s),
    }
    expect(run({ ...t2vaProject, shots })).toContain('SPEAKER_FIRST_INTRO')
  })

  it('DIALOGUE_D_TAG_PURE — znacznik <d> wewnątrz treści', () => {
    expect(run(withDialogue(t2vaProject, { text: '<d>[English] Hi.</d>' })))
      .toContain('DIALOGUE_D_TAG_PURE')
  })

  it('DIALOGUE_VERBATIM — treść zaczyna się od czasownika mówienia', () => {
    expect(run(withDialogue(t2vaProject, { text: 'says: hello there' })))
      .toContain('DIALOGUE_VERBATIM')
  })

  it('VO_LIPS_CLAUSE — voiceover bez klauzuli o ustach', () => {
    expect(run(withDialogue(t2vaProject, { voiceover: true })))
      .toContain('VO_LIPS_CLAUSE')
  })

  it('VO_EXACT_PHRASE — własny czasownik przy voiceoverze', () => {
    const ids = run(withDialogue(t2vaProject, {
      voiceover: true, verb: 'whispers', lipsClause: 'while his lips remain completely closed.',
    }))
    expect(ids).toContain('VO_EXACT_PHRASE')
  })

  it('SCENETRANS_BOTH_SIDES — brak kontynuacji w kolejnym ujęciu', () => {
    expect(run(withDialogue(t2vaProject, {
      sceneTransAfter: true, continuityPhrase: 'carries over from the previous shot',
    }))).toContain('SCENETRANS_BOTH_SIDES')
  })

  it('SCENETRANS_BOTH_SIDES — zdanie o ciągłości spoza dozwolonej listy', () => {
    expect(run(withDialogue(t2vaProject, {
      sceneTransAfter: true, continuityPhrase: 'keeps going somehow',
    }))).toContain('SCENETRANS_BOTH_SIDES')
  })

  it('CUTOFF_AT_END — mowa wychodzi poza koniec bez znacznika', () => {
    expect(run(withDialogue(t2vaProject, { endMs: 9000 })))
      .toContain('CUTOFF_AT_END')
  })

  it('CUTOFF_AT_END — znacznik przy mowie kończącej się przed końcem', () => {
    expect(run(withDialogue(t2vaProject, { cutoff: true })))
      .toContain('CUTOFF_AT_END')
  })

  it('SPEECH_FITS — kwestia nie mieści się w swoim oknie', () => {
    expect(run(withDialogue(t2vaProject, {
      text: 'This is a considerably longer line of dialogue that cannot possibly fit inside the allotted window of time.',
    }))).toContain('SPEECH_FITS')
  })
})
