import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Project, ProjectPatch, Segment, Shot } from '@mmh3/shared'
import type { ChatMessage } from '../provider.js'
import type { TaskDefinition } from '../run.js'

/**
 * Zadanie 3 z czterech: model widzi treść WSZYSTKICH ujęć projektu (nie dwa
 * zdania pomysłu jak zadanie „struktura" — audio musi ocenić całą scenę na
 * raz, żeby zaproponować spójny pejzaż dźwiękowy i muzykę) i zwraca dwa pola,
 * po angielsku, w konwencji guide'a: dźwięk i instrumentacja, nie nastrój
 * (zob. `shared/src/validate/rules/audio.ts` — `MUSIC_NO_MOOD_WORDS` odrzuca
 * właśnie nazywanie emocji wprost).
 */
export const AudioSchema = z.object({
  // Bez `min(1)` z tego samego powodu co `RedactSchema.english`: pusta
  // odpowiedź dla jednego pola jest poprawnym (choć bezużytecznym) wynikiem —
  // `audioToPatch` musi być na nią bezpieczne, nie schemat rozmowy ją odrzucać.
  soundscape: z.string(),
  music: z.string(),
})

export type AudioResult = z.infer<typeof AudioSchema>

const audioJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['soundscape', 'music'],
  properties: {
    soundscape: { type: 'string' },
    music: { type: 'string' },
  },
} as const

/**
 * Dane wejściowe zadania: treść ujęć projektu, po jednym wpisie na ujęcie, w
 * kolejności. Serwer (`routes/llm.ts`) buduje ją z projektu wczytanego z
 * dysku przez `audioInputFromProject` — klient nie dostarcza tu nic poza
 * identyfikatorem projektu, bo model potrzebuje CAŁEJ sceny, nie fragmentu,
 * który przeglądarka mogłaby przesłać nieaktualny.
 */
export interface AudioInput {
  shots: Array<{ content: string }>
}

export const AudioInputSchema = z.object({
  shots: z.array(z.object({ content: z.string() })),
})

const SYSTEM_PROMPT = [
  'You suggest two audio fields for a video-generation prompt, based on the '
    + 'visual content of every shot in the project: an overall soundscape and '
    + 'non-diegetic (score) music.',
  '"soundscape" is 1 to 4 sentences describing the ambient, diegetic sound '
    + 'the scene would plausibly produce — footsteps, traffic, wind, room tone, '
    + 'crowd noise, and so on. Never repeat or paraphrase spoken dialogue.',
  '"music" is 1 to 3 sentences describing non-diegetic score music: '
    + 'instrumentation, tempo, rhythm, and dynamics. Never describe a sound '
    + 'source a character could hear (radio, TV, a jukebox, someone singing) — '
    + 'that belongs in the shot description, not here.',
  'Describe sound, not mood: name concrete instrumentation, tempo, rhythm, '
    + 'dynamics and sound sources. Never name an emotion, atmosphere, or intent '
    + 'directly (e.g. "tense", "eerie", "uplifting", "melancholic", "dramatic") '
    + '— the guide forbids mood words in both fields and a rule rejects them.',
  'If a field genuinely does not apply to this project, return an empty '
    + 'string for it rather than inventing content.',
  'Return only the two fields — no extra commentary.',
].join('\n')

function buildUserMessage(input: AudioInput): string {
  const shotLines = input.shots.length > 0
    ? input.shots.map((shot, index) => `Shot ${index + 1}: ${shot.content === '' ? '(no description yet)' : shot.content}`).join('\n')
    : '(no shots yet)'
  return `Shot content, in order:\n${shotLines}`
}

export const audioTask: TaskDefinition<AudioResult> = {
  name: 'podpowiedź audio',
  schema: AudioSchema,
  jsonSchema: audioJsonSchema,
  maxTokens: 500,
  buildMessages: (input: unknown): ChatMessage[] => {
    const parsed = AudioInputSchema.parse(input)
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(parsed) },
    ]
  },
}

function isTextSegment(segment: Segment): segment is Extract<Segment, { kind: 'text' }> {
  return segment.kind === 'text'
}

/**
 * Treść jednego ujęcia dla modelu: kompozycja (framing) i cała proza `body`
 * (akcja, wraz z łącznikami dopisanymi przez `structureToPatch` — nieszkodliwe
 * dla modelu, on tylko czyta, nie parsuje tego z powrotem). Ruch kamery i
 * dialog NIE wchodzą tu wprost — dialog celowo, bo `soundscape` ma nie
 * powtarzać kwestii (`SOUNDSCAPE_NO_DIALOGUE`), a ruch kamery nic nie mówi o
 * dźwięku sceny.
 */
function shotContent(shot: Shot): string {
  const bodyText = shot.body.filter(isTextSegment).map(segment => segment.text).join('')
  return [shot.composition.trim(), bodyText.trim()].filter(part => part !== '').join(' ')
}

/** Buduje `AudioInput` z projektu — używane przez `routes/llm.ts`. */
export function audioInputFromProject(project: Project): AudioInput {
  return {
    shots: [...project.shots]
      .sort((a, b) => a.index - b.index)
      .map(shot => ({ content: shotContent(shot) })),
  }
}

/**
 * Buduje łatkę z jednej odpowiedzi modelu: do dwóch operacji `setAudio`, po
 * jednej na pole, przyjmowalnych OSOBNO — użytkownik może wziąć pejzaż
 * dźwiękowy i odrzucić muzykę albo odwrotnie (zob. brief).
 *
 * Puste pole (po przycięciu białych znaków) nigdy nie tworzy operacji dla
 * SIEBIE — nie zastępuje istniejącej treści niczym. To samo dotyczy pola
 * identycznego z bieżącą treścią: nie ma czego przyjmować.
 */
export function audioToPatch(result: AudioResult, project: Project): ProjectPatch {
  const ops: ProjectPatch['ops'] = []

  const soundscape = result.soundscape.trim()
  if (soundscape !== '' && soundscape !== project.audio.overallSoundscape.trim()) {
    ops.push({
      kind: 'setAudio',
      id: `op-${randomUUID()}`,
      label: 'Podpowiedź pejzażu dźwiękowego.',
      field: 'overallSoundscape',
      text: soundscape,
    })
  }

  const music = result.music.trim()
  if (music !== '' && music !== project.audio.nonDiegeticMusic.trim()) {
    ops.push({
      kind: 'setAudio',
      id: `op-${randomUUID()}`,
      label: 'Podpowiedź muzyki spoza kadru.',
      field: 'nonDiegeticMusic',
      text: music,
    })
  }

  return { ops }
}
