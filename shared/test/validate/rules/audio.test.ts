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

  it('nie liczy kropki po skrócie jako końca zdania', () => {
    expect(countSentences('Mr. Chen coughs. A door slams shut.')).toBe(2)
    expect(countSentences('Dr. Adams and Mrs. Lee whisper.')).toBe(1)
    expect(countSentences('A. Nowak steps inside.')).toBe(1)
  })

  it('cztery zdania ze skrótem liczą się jako cztery', () => {
    expect(countSentences(
      'Mr. Chen coughs in the doorway. A door slams shut. Rain taps the glass. Wind rises outside.',
    )).toBe(4)
  })
})

describe('reguły audio', () => {
  it('nie zgłasza nic dla projektów złotych', () => {
    expect(run(t2vaProject)).toEqual([])
    expect(run(fl2vaProject)).toEqual([])
    expect(run(refProject)).toEqual([])
  })

  it('SOUNDSCAPE_SENTENCES — więcej niż cztery zdania', () => {
    expect(run(withAudio(t2vaProject, {
      overallSoundscape:
        'Shutters scrape open. A door slams shut. Rain taps the glass. '
        + 'Wind rises outside. Footsteps fade away.',
    }))).toContain('SOUNDSCAPE_SENTENCES')
  })

  it('SOUNDSCAPE_SENTENCES — pusty opis', () => {
    expect(run(withAudio(t2vaProject, { overallSoundscape: '' })))
      .toContain('SOUNDSCAPE_SENTENCES')
  })

  it('MUSIC_SENTENCES — więcej niż trzy zdania', () => {
    expect(run(withAudio(t2vaProject, {
      nonDiegeticMusic:
        'A piano melody at a slow tempo. Strings enter underneath. '
        + 'The rhythm steadies. The dynamics swell.',
    }))).toContain('MUSIC_SENTENCES')
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

  it('DIEGETIC_IN_DESCRIPTION — słowo zawierające nazwę źródła nie wyzwala reguły', () => {
    expect(run(withAudio(t2vaProject, {
      nonDiegeticMusic: 'A radiophonic drone at a slow tempo, fading out.',
    }))).not.toContain('DIEGETIC_IN_DESCRIPTION')
  })
})
