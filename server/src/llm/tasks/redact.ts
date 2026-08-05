import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Project, ProjectPatch } from '@mmh3/shared'
import type { ChatMessage } from '../provider.js'
import type { TaskDefinition } from '../run.js'

/**
 * Zadanie 2 z czterech: jedno pole projektu, po polsku, staje się tym samym
 * polem po angielsku, w konwencji guide'a (obraz zamiast nastroju,
 * teraźniejszy czas, konkret zamiast oceny — patrz `SYSTEM_PROMPT`). Model
 * dostaje WYŁĄCZNIE treść tego jednego pola — żadnego trybu, mówców ani
 * reszty projektu (zob. brief: mniej kontekstu, mniej pokusy dopisywania).
 *
 * Celowo NIE MA wariantu celu wskazującego na `DialogueEvent.text`. Kwestia
 * dialogowa idzie do modelu wideo dosłownie — jej "redakcja" byłaby zmianą
 * tego, co postać mówi, nie kwestią stylu zapisu. `RedactTargetSchema` jest
 * zamkniętą unią czterech wariantów poniżej; piąty (dialog) nie istnieje i
 * nie da się go dopisać z zewnątrz, bo `RedactTarget` jest wyprowadzony z
 * tego schematu (`z.infer`), nie zdefiniowany osobno.
 */
export const RedactSchema = z.object({
  // Bez `min(1)`: pusta odpowiedź modelu jest poprawnym (choć bezużytecznym)
  // wynikiem — `redactToPatch` musi być na nią bezpieczne, nie schemat
  // rozmowy ją odrzucać (patrz komentarz przy `redactToPatch`).
  english: z.string(),
})

export type RedactResult = z.infer<typeof RedactSchema>

const redactJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['english'],
  properties: {
    english: { type: 'string' },
  },
} as const

/**
 * Dane wejściowe zadania: treść JEDNEGO pola, po polsku, i nic więcej. Serwer
 * (`routes/llm.ts`) wyciąga tę treść z projektu przez `redactSourceText`,
 * używając TEGO SAMEGO odczytu, którego `redactToPatch` użyje potem do
 * porównania „czy wynik faktycznie coś zmienia" — jedna definicja „co jest
 * bieżącą wartością celu", nie dwie, które mogłyby się rozjechać.
 */
export interface RedactInput {
  text: string
}

export const RedactInputSchema = z.object({ text: z.string().min(1) })

const SYSTEM_PROMPT = [
  'You redact a single text field of a video-generation prompt from Polish '
    + 'into English. Preserve the meaning; do not invent content the field '
    + 'did not already have.',
  'Describe the image, not the mood: name what is concretely seen or heard. '
    + 'Never name an emotion, atmosphere, or intent directly.',
  'Write in the present tense.',
  'Prefer concrete, observable detail over evaluation or judgment.',
  'Never use a metaphor about a feeling.',
  'Keep roughly the same length and level of detail as the input — you are '
    + 'translating and tightening the wording, not summarizing or expanding.',
  'If the field is already in English and already follows this convention, '
    + 'return it unchanged.',
  'Return only the redacted field text in "english" — no extra commentary, '
    + 'no quotation marks around it.',
].join('\n')

function buildUserMessage(input: RedactInput): string {
  return `Field content (Polish):\n\n${input.text}`
}

export const redactTask: TaskDefinition<RedactResult> = {
  name: 'redakcja pola PL→EN',
  schema: RedactSchema,
  jsonSchema: redactJsonSchema,
  maxTokens: 600,
  buildMessages: (input: unknown): ChatMessage[] => {
    const parsed = RedactInputSchema.parse(input)
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(parsed) },
    ]
  },
}

/**
 * Cztery rodzaje celu redakcji — po jednym na operację, którą `redactToPatch`
 * umie wyprodukować. Zamknięta unia wyprowadzona z Zoda: `routes/llm.ts`
 * waliduje nią ciało żądania, a `redactToPatch` dostaje już zawężony,
 * bezpieczny typ. Brak piątego wariantu dla dialogu jest tu strukturalny, nie
 * umowny — patrz komentarz nad `RedactSchema`.
 */
export const RedactTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('style') }),
  z.object({
    kind: z.literal('shotText'),
    shotId: z.string().min(1),
    segmentIndex: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal('audio'),
    field: z.enum(['overallSoundscape', 'nonDiegeticMusic']),
  }),
  z.object({
    kind: z.literal('speaker'),
    speakerId: z.string().min(1),
    field: z.enum(['fullDescriptor', 'shortDescriptor']),
  }),
])

export type RedactTarget = z.infer<typeof RedactTargetSchema>

/**
 * Bieżąca treść pola, na które wskazuje `target` — albo `undefined`, gdy cel
 * nie istnieje w ogóle (brak ujęcia/mówcy o tym id) LUB, dla `shotText`,
 * istnieje pod tym indeksem, ale nie jest segmentem tekstowym. Zwykłe
 * indeksowanie `shot.body[index]` już samo odrzuca indeksy ujemne i ułamkowe
 * (nie są prawidłowymi kluczami tablicy w JS) — nie potrzeba tu osobnej
 * straży, jaką ma `segmentAt` w `shared/src/patch/segment.ts` (moduł
 * wewnętrzny pakietu, nieeksportowany z `@mmh3/shared`).
 *
 * Eksportowana: `routes/llm.ts` używa jej wprost, żeby zbudować `RedactInput`
 * z AKTUALNEGO stanu projektu na dysku — ten sam odczyt, którego
 * `redactToPatch` użyje do porównania „czy wynik faktycznie coś zmienia",
 * więc obie strony patrzą na dokładnie tę samą wartość.
 */
export function redactSourceText(project: Project, target: RedactTarget): string | undefined {
  switch (target.kind) {
    case 'style':
      return project.style
    case 'audio':
      return project.audio[target.field]
    case 'speaker': {
      const speaker = project.speakers.find(s => s.id === target.speakerId)
      return speaker?.[target.field]
    }
    case 'shotText': {
      const shot = project.shots.find(s => s.id === target.shotId)
      if (shot === undefined) return undefined
      const segment = shot.body[target.segmentIndex]
      return segment?.kind === 'text' ? segment.text : undefined
    }
  }
}

/**
 * Buduje łatkę z jednej odpowiedzi modelu. Trzy powody, dla których wynik to
 * łatka BEZ operacji (`{ ops: [] }`), nie operacja z pustą albo powtórzoną
 * treścią:
 *
 * 1. Pusta odpowiedź modelu (`english` puste/białe znaki) nigdy nie zastępuje
 *    realnej treści niczym — funkcja testowana jest wprost, na własnych
 *    danych, więc musi być bezpieczna także na wejściu, którego prawdziwa
 *    rozmowa (schemat wymusza tylko `string`, nie `min(1)`) mogłaby
 *    wyprodukować.
 * 2. Cel nie istnieje ALBO — jedyny przypadek specyficzny dla `shotText` —
 *    wskazany indeks nie jest segmentem tekstowym. `applyOps` i tak odrzuca
 *    taką operację po cichu (patrz `shared/src/patch/apply.ts`), ale skoro
 *    `redactToPatch` i tak musi znać bieżącą treść celu (punkt 3), lepiej nie
 *    produkować operacji, o której z góry wiadomo, że się nie zastosuje, niż
 *    dawać użytkownikowi coś do "przyjęcia", co nic by nie zmieniło.
 * 3. Wynik identyczny (po przycięciu białych znaków) z bieżącą treścią celu —
 *    nie ma czego przyjmować, patrz komentarz w `applyOps`: warstwa
 *    stosowania łatki i tak zwróciłaby ten sam obiekt projektu, ale bez tego
 *    sprawdzenia tutaj użytkownik dostałby operację do przejrzenia, która nic
 *    by nie zrobiła.
 */
export function redactToPatch(
  result: RedactResult,
  target: RedactTarget,
  project: Project,
): ProjectPatch {
  const text = result.english.trim()
  if (text === '') return { ops: [] }

  const current = redactSourceText(project, target)
  if (current === undefined) return { ops: [] }
  if (current.trim() === text) return { ops: [] }

  const id = `op-${randomUUID()}`
  switch (target.kind) {
    case 'style':
      return {
        ops: [{ kind: 'setStyle', id, label: 'Redakcja stylu wizualnego z polskiego na angielski.', text }],
      }
    case 'audio':
      return {
        ops: [{
          kind: 'setAudio',
          id,
          label: `Redakcja pola ${target.field} z polskiego na angielski.`,
          field: target.field,
          text,
        }],
      }
    case 'speaker':
      return {
        ops: [{
          kind: 'setSpeakerDescriptor',
          id,
          label: `Redakcja opisu mówcy (${target.field}) z polskiego na angielski.`,
          speakerId: target.speakerId,
          field: target.field,
          text,
        }],
      }
    case 'shotText':
      return {
        ops: [{
          kind: 'setShotText',
          id,
          label: 'Redakcja treści ujęcia z polskiego na angielski.',
          shotId: target.shotId,
          segmentIndex: target.segmentIndex,
          text,
        }],
      }
  }
}
