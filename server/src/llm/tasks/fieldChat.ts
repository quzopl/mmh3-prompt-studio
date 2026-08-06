import { z } from 'zod'
import type { Project, ProjectPatch } from '@mmh3/shared'
import type { ChatMessage } from '../provider.js'
import type { TaskDefinition } from '../run.js'
import { fieldOp, fieldTextSchema, redactSourceText, type RedactTarget } from './fieldTarget.js'

/**
 * Zadanie rozmowy o JEDNYM polu projektu. Różni się od redakcji (`redact.ts`)
 * zadaniem, nie zakresem: tam chodzi o wierne przeniesienie pola z polskiego na
 * angielski, tu o ROZSZERZENIE go zgodnie z życzeniem użytkownika i o pamięć
 * poprzednich tur, żeby „mocniej" albo „mniej deszczu" miało się do czego
 * odnieść.
 *
 * Wspólne z redakcją zostają dwie rzeczy i obie są zaimportowane, nie
 * powtórzone: reguła treści pola (`fieldTextSchema`) i budowa operacji
 * (`fieldOp`). Dzięki temu strażnik pól audio — liczba zdań i zakaz bloku
 * `<d>` — obowiązuje czat automatycznie i nie ma drugich drzwi, którymi dałoby
 * się go ominąć.
 */
export interface FieldChatResult {
  reply: string
  english?: string
}

const HistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  english: z.string().optional(),
})

const FieldChatInputSchema = z.object({
  fieldLabel: z.string().min(1),
  current: z.string(),
  history: z.array(HistoryMessageSchema),
  message: z.string().min(1),
})

export type FieldChatInput = z.infer<typeof FieldChatInputSchema>

/**
 * Nazwa pola PO ANGIELSKU, bo jedzie do modelu razem z resztą instrukcji.
 * Interfejs pokazuje własne, przetłumaczone etykiety (`web/src/i18n/dict.ts`) —
 * to dwie różne publiczności, nie jedna lista do współdzielenia.
 */
export function fieldLabelFor(target: RedactTarget): string {
  switch (target.kind) {
    case 'style':
      return 'visual style'
    case 'audio':
      return target.field === 'overallSoundscape' ? 'overall soundscape' : 'non-diegetic music'
    case 'speaker':
      return target.field === 'fullDescriptor'
        ? 'speaker full descriptor'
        : 'speaker short descriptor'
    case 'shotText':
      return 'shot description'
  }
}

/**
 * Efekty nie mają w MMH3 osobnego pola — żyją w prozie ujęcia (przykład
 * dostawcy w `docs/guide_base.md`: „cracks spread through it as fragments slide
 * outward") oraz w amplitudzie i prędkości frazy kamery. Stąd cztery rodziny
 * wypisane wprost: bez nich model odpowiada na „dodaj efekty" słowami nastroju,
 * a te zapalają regułę `MUSIC_NO_MOOD_WORDS` — zmierzone na prawdziwym modelu
 * podczas uruchomienia na serwerze 2026-08-05, gdzie „melancholic" było jedyną
 * pozostałą diagnostyką wygenerowanego promptu.
 */
const SYSTEM_PROMPT = [
  'You help a director refine ONE text field of a video-generation prompt. '
    + 'The user writes instructions in Polish or English; the field itself is '
    + 'always written in English.',
  'Answer in two parts. "reply" is a short note to the human, in the language '
    + 'they wrote in, saying what you changed and why. "english" is the full '
    + 'new field text. Omit "english" entirely when the user only asked a '
    + 'question and nothing about the field should change.',
  'When the user asks for effects, reach for concrete, observable phenomena in '
    + 'four families: lighting (transitions, sources, direction, contrast); '
    + 'weather and atmosphere (rain, fog, dust, steam, sparks); material '
    + 'behaviour (cracking, spilling, falling, losing momentum); and speed of '
    + 'motion (how fast things move, and the amplitude and speed of any camera '
    + 'movement).',
  'Never name an emotion or atmosphere directly. Words such as "melancholic", '
    + '"dramatic", "eerie" or "tense" are rejected by a validation rule — write '
    + 'what is seen or heard instead, and let the feeling follow from it.',
  'Write in the present tense. Prefer concrete detail over evaluation.',
  'Never write a "<d>" tag or a bracketed language marker such as "[English]" '
    + 'into the field — the compiler adds those itself and a rule rejects them. '
    + 'In an audio field, never repeat or paraphrase spoken dialogue: describe '
    + 'the sound, do not quote the words.',
  'Keep the field to the length the user asks for. If they do not say, stay '
    + 'close to the current length.',
].join('\n')

const jsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reply'],
  properties: {
    reply: { type: 'string' },
    english: { type: 'string' },
  },
} as const

export function fieldChatTaskFor(target: RedactTarget): TaskDefinition<FieldChatResult> {
  return {
    name: 'rozmowa o polu',
    // `english` jest OPCJONALNE: tura bywa samym pytaniem („czym różni się push
    // in od dolly in?"), po którym w polu nic nie powinno się zmienić. `reply`
    // nie jest — tura bez odpowiedzi dla człowieka nie ma po co istnieć.
    schema: z.object({
      reply: z.string().min(1),
      english: fieldTextSchema(target).optional(),
    }),
    jsonSchema,
    maxTokens: 900,
    buildMessages: (input: unknown): ChatMessage[] => {
      const parsed = FieldChatInputSchema.parse(input)
      return [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Field: ${parsed.fieldLabel}\nCurrent content:\n\n${parsed.current}`,
        },
        // Historia jako osobne tury, nie zlepiona w jeden blok tekstu — patrz
        // komentarz przy `ChatMessage` w `provider.ts`.
        ...parsed.history.map((entry): ChatMessage => ({
          role: entry.role,
          content: entry.text,
        })),
        { role: 'user', content: parsed.message },
      ]
    },
  }
}

/**
 * Ta sama droga do operacji, którą chodzi redakcja (`fieldOp`) — nie ma drugiej,
 * więc strażnicy treści nie mają czego ominąć. Różni się wyłącznie etykietą, bo
 * uzasadnienie zmiany jest inne: użytkownik o nią poprosił w rozmowie, a nie
 * poprosił o przetłumaczenie pola.
 *
 * Trzy przypadki dają łatkę BEZ operacji, wszystkie trzy z tego samego powodu,
 * co w `redactToPatch`: nie ma czego przyjmować. Brak propozycji (tura była
 * pytaniem), cel, którego nie da się rozwiązać w projekcie, oraz propozycja
 * identyczna z tym, co w polu już stoi.
 */
export function fieldChatToPatch(
  result: FieldChatResult,
  target: RedactTarget,
  project: Project,
): ProjectPatch {
  const text = result.english?.trim() ?? ''
  if (text === '') return { ops: [] }

  const current = redactSourceText(project, target)
  if (current === undefined) return { ops: [] }
  if (current.trim() === text) return { ops: [] }

  return { ops: [fieldOp(target, text, 'Zmiana pola z rozmowy z modelem.')] }
}
