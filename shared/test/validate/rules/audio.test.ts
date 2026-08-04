import { describe, it, expect } from 'vitest'
import { audioRules, countSentences } from '../../../src/validate/rules/audio.js'
import { validateWith } from '../../../src/validate/validate.js'
import { compile } from '../../../src/compile/compile.js'
import { t2vaProject, fl2vaProject } from '../../golden/fixtures/base.js'
import { refProject } from '../../golden/fixtures/ref.js'
import type { Project } from '../../../src/model/types.js'

const run = (p: Project) => validateWith(audioRules, p, compile(p)).map(d => d.ruleId)
const withAudio = (p: Project, audio: Partial<Project['audio']>): Project =>
  ({ ...p, audio: { ...p.audio, ...audio } })

describe('countSentences', () => {
  it('liczy zdania po znakach końca', () => {
    expect(countSentences('One. Two! Three?')).toBe(3)
    expect(countSentences('Just one sentence.')).toBe(1)
    expect(countSentences('')).toBe(0)
  })
})

describe('reguły audio', () => {
  it('nie zgłasza nic dla projektów złotych', () => {
    expect(run(t2vaProject)).toEqual([])
    expect(run(fl2vaProject)).toEqual([])
    expect(run(refProject)).toEqual([])
  })

  it('SOUNDSCAPE_SENTENCES — więcej niż cztery zdania', () => {
    expect(run(withAudio(t2vaProject, { overallSoundscape: 'A. B. C. D. E.' })))
      .toContain('SOUNDSCAPE_SENTENCES')
  })

  it('SOUNDSCAPE_SENTENCES — pusty opis', () => {
    expect(run(withAudio(t2vaProject, { overallSoundscape: '' })))
      .toContain('SOUNDSCAPE_SENTENCES')
  })

  it('MUSIC_SENTENCES — więcej niż trzy zdania', () => {
    expect(run(withAudio(t2vaProject, { nonDiegeticMusic: 'A. B. C. D.' })))
      .toContain('MUSIC_SENTENCES')
  })

  it('SOUNDSCAPE_NO_DIALOGUE — treść kwestii powtórzona w soundscape', () => {
    expect(run(withAudio(t2vaProject, {
      overallSoundscape: 'Shutters scrape open. He says First batch of the morning. loudly.',
    }))).toContain('SOUNDSCAPE_NO_DIALOGUE')
  })

  it('SOUNDSCAPE_NA_ONLY_IF_SILENT — N/A mimo kwestii dialogowych', () => {
    expect(run(withAudio(t2vaProject, { overallSoundscape: 'N/A' })))
      .toContain('SOUNDSCAPE_NA_ONLY_IF_SILENT')
  })

  it('MUSIC_NO_MOOD_WORDS — abstrakcyjne słowo o nastroju', () => {
    expect(run(withAudio(t2vaProject, {
      nonDiegeticMusic: 'A melancholic piano melody at a slow tempo.',
    }))).toContain('MUSIC_NO_MOOD_WORDS')
  })

  it('DIEGETIC_IN_DESCRIPTION — muzyka słyszalna dla postaci w polu non_diegetic', () => {
    expect(run(withAudio(t2vaProject, {
      nonDiegeticMusic: 'A radio in the corner plays guitar chords at a moderate tempo.',
    }))).toContain('DIEGETIC_IN_DESCRIPTION')
  })
})
