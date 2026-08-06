import { z } from 'zod'
import type { ObjectRef, ObjectRefKind, Project } from '@mmh3/shared'
import type { ChatMessage } from '../provider.js'
import type { TaskDefinition } from '../run.js'
import {
  DEFAULT_REPLY_LANGUAGE, replyLanguageRule, ReplyLanguageSchema, type ReplyLanguage,
} from './replyLanguage.js'

/**
 * Zadanie 4 z czterech, i inne w rodzaju niż pozostałe trzy: model widzi
 * skompilowany prompt CAŁEGO projektu i zwraca listę UWAG, nie łatkę. Uwaga
 * nigdy nie zmienia modelu (`criticToNotes` zwraca `CriticNote[]`, nie
 * `ProjectPatch` — ten plik w ogóle nie importuje typu łatki) — trafia do
 * osobnej grupy w panelu walidacji, oddzielonej od reguł deterministycznych,
 * bo pochodzi z modelu i może być bzdurą (zob. brief).
 */
const OBJECT_REF_KINDS = [
  'project', 'shot', 'camera', 'dialogue', 'speaker',
  'label', 'screenText', 'sfx', 'audio', 'retention',
] as const satisfies readonly ObjectRefKind[]

const ObjectRefSchema = z.object({
  kind: z.enum(OBJECT_REF_KINDS),
  id: z.string().min(1),
})

/**
 * `severity` jest zamkniętą unią dwóch wartości egzekwowaną SCHEMATEM Zoda —
 * wartość spoza `'hint' | 'warning'` nie przechodzi rozmowy z modelem (jedna
 * naprawa w `runTask`, potem wyjątek), nie jest filtrowana dopiero w
 * `criticToNotes`.
 */
export const CriticNoteSchema = z.object({
  ref: ObjectRefSchema,
  // Bez `min(1)`: pusta treść jest poprawnym, choć bezużytecznym elementem
  // odpowiedzi modelu (tak samo jak `AudioSchema`/`RedactSchema`) —
  // `criticToNotes` odrzuca ją PO stronie kodu, nie schemat rozmowy.
  message: z.string(),
  severity: z.enum(['hint', 'warning']),
})

export type CriticNote = z.infer<typeof CriticNoteSchema>

export const CriticSchema = z.object({
  notes: z.array(CriticNoteSchema),
})

export type CriticResult = z.infer<typeof CriticSchema>

const criticJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['notes'],
  properties: {
    notes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ref', 'message', 'severity'],
        properties: {
          ref: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'id'],
            properties: {
              kind: { type: 'string', enum: [...OBJECT_REF_KINDS] },
              id: { type: 'string', minLength: 1 },
            },
          },
          message: { type: 'string' },
          severity: { type: 'string', enum: ['hint', 'warning'] },
        },
      },
    },
  },
} as const

/**
 * Dane wejściowe zadania: skompilowany tekst prompta ORAZ lista identyfikatorów
 * obiektów, na które wolno wskazać. Bez tej drugiej części model wymyśla
 * identyfikatory (nie zna ich z samego tekstu — treść ujęcia nie niesie jego
 * `id`) i każda uwaga ląduje w koszu w `criticToNotes` (zob. brief).
 */
export interface CriticInput {
  promptText: string
  allowedRefs: ObjectRef[]
  replyLanguage?: ReplyLanguage
}

export const CriticInputSchema = z.object({
  promptText: z.string().min(1),
  allowedRefs: z.array(ObjectRefSchema),
  replyLanguage: ReplyLanguageSchema.default(DEFAULT_REPLY_LANGUAGE),
})

const systemPrompt = (replyLanguage: ReplyLanguage): string => [
  'You are a critic reviewing a fully compiled video-generation prompt. You '
    + 'look for things a deterministic rule-checker would miss: unclear '
    + 'staging, redundant or contradictory description, pacing problems, '
    + 'continuity issues between shots, anything that would confuse the video '
    + 'model.',
  'You do not edit the project and you never propose replacement text. You '
    + 'only return short observations ("notes"). Each note is an opinion, not '
    + 'a fix — the user decides what to do with it.',
  'Every note MUST point at exactly one object from the "Allowed identifiers" '
    + 'list below, using its exact kind and id, in the "ref" field. Never '
    + 'invent an identifier and never point at an object described only in '
    + 'prose — a note whose identifier is not on the list is discarded '
    + 'unread.',
  'Use severity "warning" for something you believe actually undermines the '
    + 'output, "hint" for a minor stylistic suggestion.',
  'If you have nothing worth flagging, return an empty notes list — do not '
    + 'invent a note just to have one.',
  // Krytyk nie miał o języku ANI SŁOWA i odpowiadał, jak mu wyszło — a jego
  // uwagi czyta wyłącznie człowiek, więc język ma znaczenie.
  replyLanguageRule(replyLanguage, 'message'),
].join('\n')

function refLine(ref: ObjectRef): string {
  return `${ref.kind}:${ref.id}`
}

function buildUserMessage(input: CriticInput): string {
  const identifiers = input.allowedRefs.length > 0
    ? input.allowedRefs.map(refLine).join('\n')
    : '(none)'
  return [
    'Compiled prompt:',
    '',
    input.promptText,
    '',
    'Allowed identifiers (point notes only at these, using exact kind and id):',
    identifiers,
  ].join('\n')
}

export const criticTask: TaskDefinition<CriticResult> = {
  name: 'krytyk',
  schema: CriticSchema,
  jsonSchema: criticJsonSchema,
  maxTokens: 1200,
  buildMessages: (input: unknown): ChatMessage[] => {
    const parsed = CriticInputSchema.parse(input)
    return [
      { role: 'system', content: systemPrompt(parsed.replyLanguage) },
      { role: 'user', content: buildUserMessage(parsed) },
    ]
  },
}

/**
 * Wszystkie identyfikatory obiektów projektu, na które krytyk wolno mu
 * wskazać — jedna definicja, użyta zarówno do zbudowania promptu
 * (`buildUserMessage`), jak i do odsiania uwag po odpowiedzi (`criticToNotes`),
 * więc obie strony patrzą na dokładnie tę samą listę.
 *
 * Budowana WPROST z pól projektu, nie z `buildPrompt(project).tokens` —
 * tokeny kompilatora pokrywają tylko to, co dosłownie trafia do treści ujęć
 * (`shared/src/compile/tokens.ts`: ujęcia, ruchy kamery, dialog, mówcy,
 * etykiety, tekst na ekranie). Pejzaż dźwiękowy i muzyka trafiają do
 * skompilowanego tekstu (`emitBase`) jako osobne sekcje, ale NIGDY nie mają
 * własnego tokenu — bez jawnego dopisania `audio:overallSoundscape` i
 * `audio:nonDiegeticMusic` tutaj krytyk nie miałby jak zgodnie z regułami
 * skomentować dźwięku w ogóle.
 */
export function criticAllowedRefs(project: Project): ObjectRef[] {
  const refs: ObjectRef[] = [{ kind: 'project', id: project.id }]

  for (const shot of project.shots) {
    refs.push({ kind: 'shot', id: shot.id })
    for (const move of shot.cameraMoves) refs.push({ kind: 'camera', id: move.id })
    for (const event of shot.dialogue) refs.push({ kind: 'dialogue', id: event.id })
    for (const screenText of shot.screenText) refs.push({ kind: 'screenText', id: screenText.id })
    for (const sfx of shot.diegeticSfx) refs.push({ kind: 'sfx', id: sfx.id })
  }

  for (const speaker of project.speakers) refs.push({ kind: 'speaker', id: speaker.id })
  for (const label of project.labels) refs.push({ kind: 'label', id: label.id })

  refs.push({ kind: 'audio', id: 'overallSoundscape' })
  refs.push({ kind: 'audio', id: 'nonDiegeticMusic' })

  for (const entry of project.ref.retention) refs.push({ kind: 'retention', id: entry.id })

  return refs
}

function refKey(ref: ObjectRef): string {
  return `${ref.kind}:${ref.id}`
}

/**
 * Zamienia surową odpowiedź modelu na listę uwag do pokazania użytkownikowi —
 * NIGDY na `ProjectPatch` (ten plik nawet nie importuje tego typu, zob.
 * komentarz na górze pliku). Dwa filtry, oba po stronie kodu, nie schematu
 * rozmowy:
 *
 * 1. Uwaga bez treści (po przycięciu białych znaków) jest odrzucana — pusta
 *    uwaga nie niesie użytkownikowi niczego do przeczytania.
 * 2. Uwaga wskazująca obiekt spoza `allowedRefs` jest odrzucana — model
 *    potrafi wymyślić identyfikator, którego w projekcie nie ma, i uwaga,
 *    której nie da się kliknąć, jest szumem, nie sygnałem.
 */
export function criticToNotes(result: CriticResult, allowedRefs: ObjectRef[]): CriticNote[] {
  const allowedKeys = new Set(allowedRefs.map(refKey))
  const notes: CriticNote[] = []
  for (const note of result.notes) {
    const message = note.message.trim()
    if (message === '') continue
    if (!allowedKeys.has(refKey(note.ref))) continue
    notes.push({ ...note, message })
  }
  return notes
}
