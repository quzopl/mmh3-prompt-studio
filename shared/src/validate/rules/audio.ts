import type { Project } from '../../model/types.js'
import { DIEGETIC_SOURCES, MOOD_WORDS } from '../../vocab/moodWords.js'
import { defineRule, makeDiagnostic, type Diagnostic, type Rule } from '../types.js'

export function countSentences(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/[.!?]+(?:\s+|$)/).filter(part => part.trim().length > 0).length
}

const isNA = (text: string): boolean => text.trim() === 'N/A'

const allDialogueTexts = (project: Project): string[] =>
  project.shots.flatMap(shot => shot.dialogue.map(d => d.text))

const soundscapeSentences = defineRule({
  id: 'SOUNDSCAPE_SENTENCES',
  severity: 'error',
  guideRef: 'guide_base §4.6',
  run: ({ project }) => {
    const text = project.audio.overallSoundscape
    if (isNA(text)) return []
    const count = countSentences(text)
    if (count >= 1 && count <= 4) return []
    return [makeDiagnostic(
      soundscapeSentences,
      { kind: 'audio', id: 'overallSoundscape' },
      `overall_soundscape ma ${count} zdań — guide wymaga od 1 do 4.`,
      `overall_soundscape has ${count} sentences — the guide requires 1 to 4.`,
    )]
  },
})

const musicSentences = defineRule({
  id: 'MUSIC_SENTENCES',
  severity: 'error',
  guideRef: 'guide_base §4.7',
  run: ({ project }) => {
    const text = project.audio.nonDiegeticMusic
    if (isNA(text)) return []
    const count = countSentences(text)
    if (count >= 1 && count <= 3) return []
    return [makeDiagnostic(
      musicSentences,
      { kind: 'audio', id: 'nonDiegeticMusic' },
      `non_diegetic_music ma ${count} zdań — guide wymaga od 1 do 3.`,
      `non_diegetic_music has ${count} sentences — the guide requires 1 to 3.`,
    )]
  },
})

const soundscapeNoDialogue = defineRule({
  id: 'SOUNDSCAPE_NO_DIALOGUE',
  severity: 'error',
  guideRef: 'guide_base §4.6',
  run: ({ project }) => {
    const text = project.audio.overallSoundscape
    const out: Diagnostic[] = []
    if (text.includes('<d>')) {
      out.push(makeDiagnostic(
        soundscapeNoDialogue,
        { kind: 'audio', id: 'overallSoundscape' },
        'overall_soundscape nie może zawierać bloków dialogowych.',
        'overall_soundscape must not contain dialogue blocks.',
      ))
    }
    for (const line of allDialogueTexts(project)) {
      if (line.length > 3 && text.includes(line)) {
        out.push(makeDiagnostic(
          soundscapeNoDialogue,
          { kind: 'audio', id: 'overallSoundscape' },
          'Treść kwestii dialogowej powtórzona w overall_soundscape.',
          'Dialogue content is repeated in overall_soundscape.',
        ))
      }
    }
    return out
  },
})

const soundscapeNaOnlyIfSilent = defineRule({
  id: 'SOUNDSCAPE_NA_ONLY_IF_SILENT',
  severity: 'warning',
  guideRef: 'guide_base §4.6',
  run: ({ project }) => {
    if (!isNA(project.audio.overallSoundscape)) return []
    const hasSound = project.shots.some(s => s.dialogue.length > 0 || s.diegeticSfx.length > 0)
    if (!hasSound) return []
    return [makeDiagnostic(
      soundscapeNaOnlyIfSilent,
      { kind: 'audio', id: 'overallSoundscape' },
      'N/A w overall_soundscape jest dopuszczalne tylko przy wyraźnie żądanej pełnej ciszy.',
      'N/A in overall_soundscape is allowed only when complete silence is explicitly requested.',
    )]
  },
})

const musicNoMoodWords = defineRule({
  id: 'MUSIC_NO_MOOD_WORDS',
  severity: 'warning',
  guideRef: 'guide_base §4.7',
  run: ({ project }) => {
    const lower = project.audio.nonDiegeticMusic.toLowerCase()
    return MOOD_WORDS
      .filter(word => new RegExp(`\\b${word}\\b`).test(lower))
      .map(word => makeDiagnostic(
        musicNoMoodWords,
        { kind: 'audio', id: 'nonDiegeticMusic' },
        `Słowo "${word}" nazywa nastrój — guide wymaga instrumentacji, tempa, rytmu i dynamiki.`,
        `The word "${word}" names a mood — the guide requires instrumentation, tempo, rhythm and dynamics.`,
      ))
  },
})

const diegeticInDescription = defineRule({
  id: 'DIEGETIC_IN_DESCRIPTION',
  severity: 'warning',
  guideRef: 'guide_base §4.7',
  run: ({ project }) => {
    const lower = project.audio.nonDiegeticMusic.toLowerCase()
    return DIEGETIC_SOURCES
      .filter(source => lower.includes(source))
      .map(source => makeDiagnostic(
        diegeticInDescription,
        { kind: 'audio', id: 'nonDiegeticMusic' },
        `Źródło "${source}" jest słyszalne dla postaci — należy do opisu ujęcia, nie do non_diegetic_music.`,
        `The source "${source}" is audible to the characters — it belongs in the shot description, not non_diegetic_music.`,
      ))
  },
})

export const audioRules: Rule[] = [
  soundscapeSentences, musicSentences, soundscapeNoDialogue,
  soundscapeNaOnlyIfSilent, musicNoMoodWords, diegeticInDescription,
]
