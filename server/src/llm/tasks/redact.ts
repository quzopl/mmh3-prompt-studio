import { z } from 'zod'
import type { PatchLabelId, Project, ProjectPatch } from '@mmh3/shared'
import type { ChatMessage } from '../provider.js'
import type { TaskDefinition } from '../run.js'
import { fieldOp, fieldTextSchema, redactSourceText, type RedactTarget } from './fieldTarget.js'

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
  // Ten sam zakaz, który zadanie „Podpowiedź audio" (`audio.ts`) niosło od
  // początku, a te same dwa pola audio da się zapisać także stąd — recenzja
  // końcowa, punkt 3: „the audio task tells the model never to repeat spoken
  // dialogue; the other two write the same field and say nothing".
  'Never write a "<d>" tag or a bracketed language marker such as "[English]" '
    + 'into the field — the compiler adds those itself and a rule rejects them. '
    + 'If the field is an audio field (a soundscape or score music), never '
    + 'repeat or paraphrase spoken dialogue in it: describe the sound, do not '
    + 'quote the words.',
  'Return only the redacted field text in "english" — no extra commentary, '
    + 'no quotation marks around it.',
].join('\n')

function buildUserMessage(input: RedactInput): string {
  return `Field content (Polish):\n\n${input.text}`
}

/**
 * Schemat odpowiedzi ZALEŻNY OD CELU — fix round 2/5, zadanie 11, punkt 2:
 * kiedy `target.kind === 'audio'`, treść „english" jest przeznaczona na
 * `overallSoundscape`/`nonDiegeticMusic` i podlega TEJ SAMEJ regule liczby
 * zdań, którą zadanie „Podpowiedź audio" (`audio.ts`) wymusza dla tych pól
 * (`audioFieldTextSchema`, `audioFieldText.ts`) — inaczej redakcja PL→EN
 * mogłaby zwrócić np. siedem zdań i zapalić `SOUNDSCAPE_SENTENCES` na ekranie
 * przeglądu identycznie jak zadanie audio przed fix round 1, tylko przez inne
 * drzwi (recenzent: „the identical defect, in the identical field, through a
 * different door"). Dla pozostałych trzech celów (`style`/`shotText`/
 * `speaker`) żadna reguła długości nie obowiązuje — zwykła proza.
 */
function redactSchemaFor(target: RedactTarget): z.ZodType<RedactResult> {
  return z.object({ english: fieldTextSchema(target) })
}

/**
 * `target` jest znany PRZED wysłaniem zapytania do modelu (`routes/llm.ts`
 * czyta go z ciała żądania), więc schemat może go uwzględnić od razu, zamiast
 * walidować dopiero po fakcie — stąd funkcja budująca `TaskDefinition`, nie
 * stały obiekt (jak przed fix round 2/5). `name`/`jsonSchema`/`maxTokens`/
 * `buildMessages` nie zależą od celu i zostają bez zmian.
 */
export function redactTaskFor(target: RedactTarget): TaskDefinition<RedactResult> {
  return {
    name: 'redakcja pola PL→EN',
    schema: redactSchemaFor(target),
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

  return { ops: [fieldOp(target, text, redactLabel(target))] }
}

/** Etykiety BEZ ZMIAN wobec stanu sprzed refaktoru — pilnuje ich 38 asercji
 *  w `redact.test.ts`. Zwykły `switch` zamiast mapy po `kind`, bo tylko on
 *  zawęża `target` na tyle, żeby `target.field` się skompilowało. */
function redactLabel(target: RedactTarget): PatchLabelId {
  switch (target.kind) {
    case 'style': return 'patchLabel.redactStyle'
    case 'audio': return target.field === 'overallSoundscape'
      ? 'patchLabel.redactSoundscape'
      : 'patchLabel.redactMusic'
    case 'speaker': return target.field === 'fullDescriptor'
      ? 'patchLabel.redactSpeakerFull'
      : 'patchLabel.redactSpeakerShort'
    case 'shotText': return 'patchLabel.redactShotText'
  }
}
