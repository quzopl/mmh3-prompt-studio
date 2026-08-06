import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  containsSpeakerId, labelTokensIn, VIDEO_EDIT_SUMMARY_OPENING,
  type Project, type ProjectPatch,
} from '@mmh3/shared'
import type { ChatMessage, Provider } from '../provider.js'
import type { TaskDefinition } from '../run.js'
import { runTask } from '../run.js'
import { redactToPatch } from './redact.js'
import type { RedactTarget } from './fieldTarget.js'
import { audioFieldTextMessage, audioFieldTextOk, AUDIO_FIELD_RULE_BY_ID } from './audioFieldText.js'

/**
 * Zadanie 15 z pięciu: jeden przebieg po CAŁYM projekcie, nie po jednym polu
 * (zadanie 7, `redact.ts`) — model dostaje listę par (identyfikator, treść
 * po polsku) i zwraca listę par (ten sam identyfikator, treść po angielsku),
 * a `translateAllToPatch` zamienia to na JEDNĄ łatkę z wieloma operacjami,
 * każdą do przyjęcia osobno (zob. brief: tłumaczenie bywa nierówne).
 *
 * Dla czterech celów odziedziczonych z zadania 7 (`style`, `shotText`,
 * `audio`, `speaker`) świadomie NIE reimplementuje mechaniki `redactToPatch`
 * (puste/niezmienione wyniki, odmowa dla segmentu nietekstowego, etykiety
 * operacji) — woła `redactToPatch({ english }, target, project)` wprost i
 * skleja wynikowe `ops`. Jedna definicja „co znaczy żadna zmiana", nie dwie,
 * które mogłyby się rozjechać (patrz `translateAllToPatch` niżej). Dla dwóch
 * celów doszłych w rundzie 1 poprawek (`label`, `retention`) ta sama zasada
 * jest powielona LOKALNIE (`labelFieldToPatch`/`retentionTextToPatch` niżej),
 * bo `redact.ts` (zadanie 7) ich nie zna i nie jest w plikach tego zadania.
 *
 * ## Zakres: sześć rodzajów pola, nie dziewięć z Kroku 1 briefu
 *
 * Brief (Krok 1) wymienia jako prozę też: `composition` ujęć i `description`
 * dźwięku diegetycznego. Fix round 1 (uwagi koordynatora) rozstrzygnął to
 * pytaniem „czy model wideo w OGÓLE to przeczyta", nie samym istnieniem
 * operacji w `PatchOp`:
 *
 * - `style`, segmenty tekstowe `body`, obie ścieżki audio, oba opisy mówcy —
 *   czytane w KAŻDYM trybie (`shared/src/compile/emitBase.ts`/`renderShot.ts`).
 * - `Label.definition` (WYŁĄCZNIE dla etykiet `standalone`) i
 *   `RetentionEntry.note`/`ref.summaryText` — czytane WYŁĄCZNIE w trybie REF
 *   (`shared/src/compile/emitRef.ts`: `renderSubjectDefinitions` filtruje po
 *   `standalone`, `renderSummary`/`renderRetention` idą bez filtra, obie
 *   funkcje wołane tylko z `emitRef`, wołanego tylko gdy `project.mode ===
 *   'REF'` — `shared/src/compile/compile.ts`). `collectTranslatableFields`
 *   odzwierciedla DOKŁADNIE te same warunki, nie tylko „PatchOp istnieje".
 * - `Label.role` — MIMO że koordynator wymienił je razem z `definition`,
 *   sprawdzone wprost: `role` nie występuje w ŻADNYM pliku
 *   `shared/src/compile/*.ts`, w żadnym trybie. Zgłoszone w raporcie jako
 *   korekta, nie obejście — `setLabelField` (PatchOp) obsługuje `role`
 *   mechanicznie (jak `setSpeakerDescriptor` obsługuje dwa pola mówcy), ale
 *   `collectTranslatableFields` nigdy go nie oferuje, więc to zadanie nigdy
 *   nie produkuje operacji dla `role` — nie tłumaczymy tekstu do promptu,
 *   którego nikt nie zobaczy.
 * - `Shot.composition` i `DiegeticSfx.description` pozostają WYKLUCZONE —
 *   sprawdzone wprost: żadne z nich nie występuje w żadnym pliku
 *   `shared/src/compile/*.ts`, w żadnym trybie. Zadanie, które sprawi, że
 *   faktycznie trafiają do promptu, jest właściwym miejscem na ich redakcję
 *   — nie to.
 */

export const TranslateAllFieldResultSchema = z.object({
  id: z.string().min(1),
  // Bez `min(1)`: pole już po angielsku ma wrócić z treścią NIEZMIENIONĄ, a
  // pusty ciąg jest formalnie poprawnym (choć bezużytecznym) wynikiem —
  // `translateAllToPatch` musi być na to bezpieczne, nie schemat rozmowy ma
  // to odrzucać (ten sam powód co `RedactSchema.english`).
  english: z.string(),
})

/** Kształt odpowiedzi BEZ żadnej z dwóch straży — same pola. Straże dokłada
 * `translateAllSchemaFor` niżej; ten schemat nie jest eksportowany, żeby
 * nikt nie mógł go wziąć zamiast tamtego i po cichu stracić obie. */
const TranslateAllShapeSchema = z.object({
  fields: z.array(TranslateAllFieldResultSchema),
})

export type TranslateAllFieldResult = z.infer<typeof TranslateAllFieldResultSchema>
export type TranslateAllResult = z.infer<typeof TranslateAllShapeSchema>

/**
 * Tokeny etykiet (`<Subject 1>`, `<Video 1>`, …), które model ma przenieść z
 * treści źródłowej do tłumaczenia CO DO ZNAKU. Zwraca komunikat błędu albo
 * `null`, gdy zestaw tokenów się zgadza.
 *
 * Recenzja końcowa gałęzi, punkt 2: `ref.summaryText` jest oferowany do
 * tłumaczenia, a jego treść niesie tokeny, które czytają TRZY reguły —
 * `REF_LABEL_USED` (czy etykieta w ogóle gdzieś występuje),
 * `REF_NO_NEW_LABELS_IN_SUMMARY` (BŁĄD, gdy w summary stoi token spoza
 * `subject_definitions`) i `REF_VIDEO_EDIT_OPENING` (BŁĄD, gdy summary
 * zadania montażowego nie zaczyna się od zdania z `<Video 1>`). Recenzent
 * odtworzył pięć różnych odpowiedzi psujących te tokeny: zgubienie
 * `<Subject 1>`, przetłumaczenie go na `<Podmiot 1>`, zmyślenie
 * `<Subject 2>`, przepisanie narzuconego zdania otwierającego i dopisanie
 * identyfikatora mówcy do notatki retencji.
 *
 * Sprawdzane są OBIE strony różnicy — token zgubiony i token zmyślony — bo to
 * jedna reguła („przenieś dosłownie"), a nie dwie: pierwsza połowa łapie
 * zgubienie i lokalizację (`<Podmiot 1>` nie jest tokenem, więc oryginał
 * znika), druga zmyślenie, które samo w sobie jest BŁĘDEM walidatora.
 * Porównujemy ZBIORY, nie listy: powtórzenie tego samego tokenu w innym
 * miejscu zdania jest legalną decyzją tłumaczenia, a nie zmianą znaczenia.
 */
function labelTokenProblem(source: string, english: string): string | null {
  const expected = new Set(labelTokensIn(source))
  const actual = new Set(labelTokensIn(english))
  const lost = [...expected].filter(token => !actual.has(token))
  const invented = [...actual].filter(token => !expected.has(token))
  if (lost.length === 0 && invented.length === 0) return null

  const parts: string[] = []
  if (lost.length > 0) parts.push(`dropped or altered ${lost.join(', ')}`)
  if (invented.length > 0) parts.push(`introduced ${invented.join(', ')}`)
  return `Label tokens must be carried over verbatim, but this answer ${parts.join(' and ')}. `
    + 'Reproduce every "<Subject N>"/"<Picture N>"/"<Video N>"/"<Audio N>" token exactly '
    + 'as it appears in the input field, and never add one that is not there.'
}

/**
 * Schemat odpowiedzi dla JEDNEJ partii, zbudowany ze źródeł tej partii
 * (`id` → polska treść wysłana do modelu). Dwie straże:
 *
 * 1. Liczba zdań i brak `<d>` dla pól przeznaczonych na
 *    `overallSoundscape`/`nonDiegeticMusic` — fix round 2/5, zadanie 11,
 *    punkt 2 (ta sama luka co w `redact.ts`: to samo pole, inne drzwi).
 *    Rozpoznanie celu idzie WYŁĄCZNIE po formacie `id` (`audio:${field}`,
 *    nadawanym przez `collectTranslatableFields`, nigdy przez model), więc
 *    `AUDIO_FIELD_RULE_BY_ID` (`audioFieldText.ts`) wystarczy bez dostępu do
 *    projektu.
 * 2. Trzy straże potrzebujące TREŚCI ŹRÓDŁOWEJ: tokeny etykiet przeniesione
 *    dosłownie, narzucone zdanie otwierające summary i brak dopisanego
 *    identyfikatora mówcy. Dlatego schemat nie może być stałą, jak był do
 *    recenzji końcowej: powstaje per-wywołanie, tak jak `redactTaskFor(target)`
 *    powstaje per-cel (zadanie 7).
 *
 * Mapa źródeł obejmuje CAŁY projekt, nie tylko partię wysłaną w tym zapytaniu.
 * Recenzja poprawek końcowych zmierzyła, dlaczego: przy projekcie dzielonym na
 * partie model odpowiadający na partię N potrafi zwrócić wpis o `id` z partii
 * M, a wtedy `sources.get(id)` było `undefined` i WSZYSTKIE TRZY straże się
 * pomijały. Wcześniejszy komentarz twierdził tu, że takie pole „i tak odpadnie
 * w `translateAllToPatch`" — to była nieprawda: `translateAllToPatch` filtruje
 * po pełnej liście celów projektu, na której to `id` stoi. Odtworzone na
 * projekcie REF przekraczającym budżet partii: przepisane zdanie otwierające
 * przechodziło i zapalało `REF_VIDEO_EDIT_OPENING` (BŁĄD) na projekcie, który
 * go nie miał.
 *
 * Identyfikator zmyślony — spoza całego projektu — nadal przechodzi tę straż,
 * bo nie ma z czym go porównać, i tam poprzednie zdanie było prawdziwe:
 * odsiewa go `translateAllToPatch`.
 */
/**
 * Narzucone zdanie otwierające summary zadania montażowego. `REF_VIDEO_EDIT_OPENING`
 * jest BŁĘDEM, a błąd blokuje eksport — więc tłumaczenie, które przepisze to
 * zdanie na własne, zabiera projektowi możliwość eksportu. Zdanie jest po
 * angielsku także w polskim summary, więc dla tłumaczącego modelu wygląda jak
 * fragment do poprawienia; sam prompt to za mało.
 */
function openingProblem(source: string, english: string): string | null {
  if (!source.trimStart().startsWith(VIDEO_EDIT_SUMMARY_OPENING)) return null
  if (english.trimStart().startsWith(VIDEO_EDIT_SUMMARY_OPENING)) return null
  return `The summary must still begin with the exact sentence "${VIDEO_EDIT_SUMMARY_OPENING}". `
    + 'Reproduce it verbatim as the first sentence and translate only what follows it.'
}

/**
 * `REF_NO_SPEAKER_IN_RETENTION` też jest BŁĘDEM. Notatka retencji idzie do
 * tłumaczenia, a model potrafi wciągnąć do niej `(S1)` z sąsiedniego zdania
 * albo z kontekstu ujęcia. Pytamy predykatem podniesionym z samej reguły, żeby
 * schemat i walidator nie mogły się rozjechać.
 */
function speakerIdProblem(source: string, english: string): string | null {
  if (containsSpeakerId(source)) return null
  if (!containsSpeakerId(english)) return null
  return 'Retention notes must not contain speaker identifiers such as "(S1)". '
    + 'Translate the wording without adding any speaker id that is not in the input field.'
}

export function translateAllSchemaFor(sources: ReadonlyMap<string, string>): z.ZodType<TranslateAllResult> {
  return TranslateAllShapeSchema.superRefine((value, ctx) => {
    value.fields.forEach((field, index) => {
      const path = ['fields', index, 'english']

      const rule = AUDIO_FIELD_RULE_BY_ID[field.id]
      if (rule !== undefined && !audioFieldTextOk(rule, field.english)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: audioFieldTextMessage(rule, field.english),
        })
      }

      const source = sources.get(field.id)
      if (source === undefined) return
      for (const problem of [
        labelTokenProblem(source, field.english),
        openingProblem(source, field.english),
        speakerIdProblem(source, field.english),
      ]) {
        if (problem !== null) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: problem })
        }
      }
    })
  })
}

const translateAllJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fields'],
  properties: {
    fields: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'english'],
        properties: {
          id: { type: 'string', minLength: 1 },
          english: { type: 'string' },
        },
      },
    },
  },
} as const

/**
 * Dane wejściowe JEDNEJ partii (zob. `chunkFields`): pary identyfikator/treść
 * po polsku. Identyfikator nadaje kod (`collectTranslatableFields`), nigdy
 * model — ta sama zasada, co w zadaniu 6 (struktura ujęć adresowana kodami
 * mówców) i zadaniu 8 (krytyk adresowany `allowedRefs`).
 */
export interface TranslateAllInput {
  fields: Array<{ id: string; text: string }>
}

export const TranslateAllInputSchema = z.object({
  fields: z.array(z.object({ id: z.string().min(1), text: z.string().min(1) })),
})

const SYSTEM_PROMPT = [
  'You redact a batch of text fields from a video-generation prompt from '
    + 'Polish into English. Preserve the meaning of each field; do not invent '
    + 'content a field did not already have.',
  'Describe the image, not the mood: name what is concretely seen or heard. '
    + 'Never name an emotion, atmosphere, or intent directly.',
  'Write in the present tense.',
  'Prefer concrete, observable detail over evaluation or judgment.',
  'Never use a metaphor about a feeling.',
  'Keep roughly the same length and level of detail as each input field — '
    + 'you are translating and tightening the wording, not summarizing or '
    + 'expanding.',
  'Each field below is given with a stable id. Return exactly one entry per '
    + 'input field, in "fields", using the EXACT SAME id — never invent an id '
    + 'that was not given to you and never merge two fields into one entry.',
  'If a field is already in English and already follows this convention, '
    + 'return it in "english" completely unchanged — this matters: running '
    + 'this task again on an already-translated project must not reshuffle '
    + 'wording that does not need to change.',
  // Recenzja końcowa gałęzi, punkt 2: bez tego akapitu nic w tym promptcie
  // nie mówiło modelowi, że w treści siedzą tokeny, które czytają trzy
  // reguły walidatora — a dwie z nich są BŁĘDAMI blokującymi eksport.
  'Some fields embed label tokens written in angle brackets: "<Subject 1>", '
    + '"<Picture 2>", "<Video 1>", "<Audio 3>". Carry every such token over into '
    + '"english" VERBATIM, character for character — never translate the word '
    + 'inside the brackets, never renumber it, never drop it, and never '
    + 'introduce a token that the same input field did not already contain. '
    + 'The tokens are identifiers, not prose.',
  // Zdanie narzucone formatem (`REF_VIDEO_EDIT_OPENING`, BŁĄD) — jest już po
  // angielsku, więc „przetłumaczenie" go jest zawsze pogorszeniem.
  `One opening sentence is mandated by the format and is already in English: a `
    + `video-editing summary must begin with "${VIDEO_EDIT_SUMMARY_OPENING}" If an `
    + 'input field begins with that exact sentence, reproduce it unchanged at the '
    + 'start of "english" and redact only the text that follows it.',
  // Ten sam zakaz, który zadanie „Podpowiedź audio" (`audio.ts`) niosło od
  // początku — te same dwa pola audio da się zapisać także stąd (recenzja
  // końcowa, punkt 3).
  'Never write a "<d>" tag or a bracketed language marker such as "[English]" '
    + 'into any field — the compiler adds those itself and a rule rejects them. '
    + 'In an audio field (a soundscape or score music), never repeat or '
    + 'paraphrase spoken dialogue: describe the sound, do not quote the words.',
  'Return only the "fields" array — no extra commentary, no quotation marks '
    + 'around any field value.',
].join('\n')

function buildFieldBlock(field: { id: string; text: string }): string {
  return `[id: ${field.id}]\n${field.text}`
}

function buildUserMessage(input: TranslateAllInput): string {
  const blocks = input.fields.length > 0
    ? input.fields.map(buildFieldBlock).join('\n\n')
    : '(no fields)'
  return `Fields (Polish content, one per id):\n\n${blocks}`
}

/**
 * Zadanie dla JEDNEJ partii — funkcja, nie stała, bo schemat odpowiedzi
 * zależy od treści źródłowych tej partii (straż tokenów etykiet w
 * `translateAllSchemaFor`). Ten sam układ co `redactTaskFor(target)` w
 * zadaniu 7: wszystko poza schematem (`name`, `jsonSchema`, `maxTokens`,
 * `buildMessages`) od partii nie zależy.
 */
export function translateAllTaskFor(
  fields: TranslatableField[],
  allFields: TranslatableField[] = fields,
): TaskDefinition<TranslateAllResult> {
  return {
    name: 'redakcja całego projektu PL→EN',
    schema: translateAllSchemaFor(new Map(allFields.map(field => [field.id, field.text]))),
    jsonSchema: translateAllJsonSchema,
    // Więcej niż `redactTask` (600) — jedna partia niesie do kilkudziesięciu
    // pól naraz, zob. `chunkFields`/`DEFAULT_TRANSLATE_ALL_BATCH_CHAR_BUDGET`
    // za uzasadnieniem konkretnej liczby.
    maxTokens: 3000,
    buildMessages: (input: unknown): ChatMessage[] => {
      const parsed = TranslateAllInputSchema.parse(input)
      return [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserMessage(parsed) },
      ]
    },
  }
}

/**
 * Cel pola do przetłumaczenia: cztery warianty odziedziczone z `RedactTarget`
 * (zadanie 7) plus dwa doszłe w rundzie 1 poprawek tego zadania. `label` i
 * `retention` NIE są wariantami `RedactTarget` — `redact.ts` (pojedyncze
 * pole, zadanie 7) ich nie zna i zostaje nietknięty; ta unia żyje wyłącznie
 * tutaj.
 */
export type TranslateTarget =
  | RedactTarget
  | { kind: 'label'; labelId: string; field: 'definition' | 'role' }
  | {
      kind: 'retention'
      // Ten sam kształt co `PatchOp['setRetentionText']['scope']`
      // (`shared/src/patch/types.ts`) — jedno pole singletonowe
      // (`ref.summaryText`) i jedno per-wpis (`RetentionEntry.note`) dzielą
      // kategorię „tekst retencji".
      scope: { kind: 'summary' } | { kind: 'entry'; entryId: string }
    }

/**
 * Jedno pole projektu warte zaproponowania do tłumaczenia: stabilny
 * identyfikator, cel (`TranslateTarget`) i bieżąca treść.
 */
export interface TranslatableField {
  id: string
  target: TranslateTarget
  text: string
}

const isNonEmpty = (text: string): boolean => text.trim() !== ''

const AUDIO_FIELDS = ['overallSoundscape', 'nonDiegeticMusic'] as const
const SPEAKER_FIELDS = ['fullDescriptor', 'shortDescriptor'] as const

/**
 * Wszystkie pola projektu, które są prozą i mają dokąd trafić jako operacja
 * (zob. komentarz o zakresie na górze pliku). Pole puste (po przycięciu
 * białych znaków) jest pomijane W OGÓLE — nie trafia do wejścia modelu, więc
 * nie kosztuje ani tokenów, ani szansy na zmyśloną treść tam, gdzie nic nie
 * było (brief: „pole puste nie tworzy operacji" — najprościej spełnione,
 * kiedy pole w ogóle nie jest oferowane).
 *
 * Kwestia dialogowa (`DialogueEvent.text`, blok `<d>`) i pola słownikowe
 * (`cutPhrase`, `verb`, typy ruchów kamery, znaczniki retencji) NIE MAJĄ tu
 * gałęzi — nie da się ich zaadresować identyfikatorem, którego ta funkcja
 * nigdy nie wystawi, więc nie mogą pojawić się ani w wejściu do modelu, ani
 * (przez `translateAllToPatch`, które tę samą funkcję woła ponownie) w
 * łatce wynikowej, nawet gdyby model spróbował zgadnąć taki identyfikator.
 *
 * Ujęcia sortowane po `index` (jak `structureToPatch`/`audioInputFromProject`)
 * — kolejność identyfikatorów ma być deterministyczna, nie zależna od
 * przypadkowej kolejności w tablicy `project.shots`.
 */
export function collectTranslatableFields(project: Project): TranslatableField[] {
  const fields: TranslatableField[] = []

  if (isNonEmpty(project.style)) {
    fields.push({ id: 'style', target: { kind: 'style' }, text: project.style })
  }

  for (const shot of [...project.shots].sort((a, b) => a.index - b.index)) {
    shot.body.forEach((segment, segmentIndex) => {
      if (segment.kind === 'text' && isNonEmpty(segment.text)) {
        fields.push({
          id: `shotText:${shot.id}:${segmentIndex}`,
          target: { kind: 'shotText', shotId: shot.id, segmentIndex },
          text: segment.text,
        })
      }
    })
  }

  for (const field of AUDIO_FIELDS) {
    const text = project.audio[field]
    if (isNonEmpty(text)) {
      fields.push({ id: `audio:${field}`, target: { kind: 'audio', field }, text })
    }
  }

  for (const speaker of project.speakers) {
    for (const field of SPEAKER_FIELDS) {
      const text = speaker[field]
      if (isNonEmpty(text)) {
        fields.push({
          id: `speaker:${speaker.id}:${field}`,
          target: { kind: 'speaker', speakerId: speaker.id, field },
          text,
        })
      }
    }
  }

  // `Label.definition`, `ref.summaryText` i `RetentionEntry.note` trafiają do
  // promptu WYŁĄCZNIE przez `emitRef` (`shared/src/compile/emitRef.ts`),
  // wołane WYŁĄCZNIE gdy `project.mode === 'REF'` (`compile.ts`) — poza tym
  // trybem oferowanie ich do tłumaczenia produkowałoby operacje dla tekstu,
  // którego skompilowany prompt nigdy nie pokaże. `Label.role` NIE ma tu
  // gałęzi w ogóle — nie występuje w żadnym pliku `compile/*`, w żadnym
  // trybie (zob. komentarz o zakresie na górze pliku).
  if (project.mode === 'REF') {
    // `renderSubjectDefinitions` renderuje `definition` WYŁĄCZNIE dla etykiet
    // ze `standalone: true` — ten sam filtr tutaj, nie tylko obecność
    // operacji.
    for (const label of project.labels) {
      if (label.standalone && isNonEmpty(label.definition)) {
        fields.push({
          id: `label:${label.id}:definition`,
          target: { kind: 'label', labelId: label.id, field: 'definition' },
          text: label.definition,
        })
      }
    }

    if (isNonEmpty(project.ref.summaryText)) {
      fields.push({
        id: 'retention:summary',
        target: { kind: 'retention', scope: { kind: 'summary' } },
        text: project.ref.summaryText,
      })
    }

    for (const entry of project.ref.retention) {
      if (isNonEmpty(entry.note)) {
        fields.push({
          id: `retention:entry:${entry.id}`,
          target: { kind: 'retention', scope: { kind: 'entry', entryId: entry.id } },
          text: entry.note,
        })
      }
    }
  }

  return fields
}

/**
 * Domyślny budżet znaków WEJŚCIA (treści polskiej) na jedną partię —
 * `chunkFields` tnie po nim. Tryb zarządzany (`llm/settings.ts`) ma domyślny
 * `contextSize: 8192` tokenów (minimum konfiguracyjne to 512, ale to już
 * poza tym, co jakikolwiek istniejący prompt tego projektu zakłada).
 * 4000 znaków polskiego tekstu to z grubsza 1000–1300 tokenów wejścia — przy
 * systemowym promptcie (~250 tokenów) i odpowiedzi tej samej wielkości co
 * wejście (task ma tłumaczyć, nie streszczać — `maxTokens: 3000` z zapasem
 * na narzut JSON-a dla kilkudziesięciu pól) najgorszy przypadek to JEDNA
 * runda naprawy (`runTask`), która w drugim wywołaniu dokłada nieudaną
 * odpowiedź modelu (do `maxTokens` = 3000) plus wyjaśnienie błędu — razem
 * rzędu 4500–5000 tokenów, wygodnie poniżej 8192 z zapasem na warianty
 * (dłuższe zdania, mówcy o długich opisach).
 */
export const DEFAULT_TRANSLATE_ALL_BATCH_CHAR_BUDGET = 4000

/**
 * Dzieli pola na partie tak, by suma długości TREŚCI (nie identyfikatorów)
 * w jednej partii nie przekraczała `charBudget` — ale zawsze co najmniej
 * jedno pole na partię, nawet gdy samo przekracza budżet, żeby postęp był
 * gwarantowany. Liczba partii jest z góry skończona (`ceil(pola / 1)` w
 * najgorszym razie) i wynika WYŁĄCZNIE z liczby pól w projekcie — żadnej
 * pętli bez końca, żadnego ponawiania tej samej partii (naprawę pojedynczej
 * partii i tak załatwia `runTask`, dokładnie jedną próbą).
 */
export function chunkFields(
  fields: TranslatableField[],
  charBudget: number = DEFAULT_TRANSLATE_ALL_BATCH_CHAR_BUDGET,
): TranslatableField[][] {
  const batches: TranslatableField[][] = []
  let current: TranslatableField[] = []
  let currentChars = 0

  for (const field of fields) {
    const fieldChars = field.text.length
    if (current.length > 0 && currentChars + fieldChars > charBudget) {
      batches.push(current)
      current = []
      currentChars = 0
    }
    current.push(field)
    currentChars += fieldChars
  }
  if (current.length > 0) batches.push(current)

  return batches
}

function labelSourceText(project: Project, labelId: string, field: 'definition' | 'role'): string | undefined {
  return project.labels.find(l => l.id === labelId)?.[field]
}

/**
 * `label` nie jest wariantem `RedactTarget` (zob. komentarz przy
 * `TranslateTarget`), więc `redactToPatch` nie umie go obsłużyć — ta funkcja
 * powiela DOKŁADNIE ten sam kształt (puste/niezmienione → `{ ops: [] }`, cel
 * nieistniejący → `{ ops: [] }`, w przeciwnym razie jedna operacja z nowym
 * `id`), tylko dla `setLabelField` zamiast czterech wariantów zadania 7.
 */
function labelFieldToPatch(
  english: string,
  target: Extract<TranslateTarget, { kind: 'label' }>,
  project: Project,
): ProjectPatch {
  const text = english.trim()
  if (text === '') return { ops: [] }

  const current = labelSourceText(project, target.labelId, target.field)
  if (current === undefined) return { ops: [] }
  if (current.trim() === text) return { ops: [] }

  return {
    ops: [{
      kind: 'setLabelField',
      id: `op-${randomUUID()}`,
      label: `Redakcja pola ${target.field} etykiety z polskiego na angielski.`,
      labelId: target.labelId,
      field: target.field,
      text,
    }],
  }
}

function retentionSourceText(
  project: Project,
  scope: Extract<TranslateTarget, { kind: 'retention' }>['scope'],
): string | undefined {
  if (scope.kind === 'summary') return project.ref.summaryText
  return project.ref.retention.find(e => e.id === scope.entryId)?.note
}

/** Odpowiednik `labelFieldToPatch` dla `setRetentionText` — zob. komentarz tam. */
function retentionTextToPatch(
  english: string,
  target: Extract<TranslateTarget, { kind: 'retention' }>,
  project: Project,
): ProjectPatch {
  const text = english.trim()
  if (text === '') return { ops: [] }

  const current = retentionSourceText(project, target.scope)
  if (current === undefined) return { ops: [] }
  if (current.trim() === text) return { ops: [] }

  return {
    ops: [{
      kind: 'setRetentionText',
      id: `op-${randomUUID()}`,
      label: target.scope.kind === 'summary'
        ? 'Redakcja podsumowania referencji z polskiego na angielski.'
        : 'Redakcja notatki retencji z polskiego na angielski.',
      scope: target.scope,
      text,
    }],
  }
}

/**
 * Buduje ŁATKĘ z odpowiedzi modelu (ewentualnie sklejonej z kilku partii,
 * zob. `runTranslateAll`) — wywołuje `collectTranslatableFields(project)`
 * PONOWNIE, żeby dostać tę samą listę identyfikator→cel, której użyto do
 * zbudowania wejścia, i przez nią filtruje odpowiedź:
 *
 * - Identyfikator spoza tej listy (model zgadł, np. id kwestii dialogowej,
 *   pola słownikowego, albo pola `label`/`retention` spoza trybu REF) jest
 *   pomijany BEZ ŚLADU.
 * - Cztery cele odziedziczone z zadania 7 idą przez `redactToPatch({
 *   english }, target, project)` — DOKŁADNIE tę samą funkcję, którą zadanie 7
 *   już ma i przetestowało. Dwa cele doszłe w rundzie 1 (`label`,
 *   `retention`) idą przez lokalne odpowiedniki (`labelFieldToPatch`,
 *   `retentionTextToPatch`) o tym samym kształcie: pusty/niezmieniony wynik
 *   nie tworzy operacji, cel, który przestał istnieć, też nie.
 */
export function translateAllToPatch(result: TranslateAllResult, project: Project): ProjectPatch {
  const offered = new Map(collectTranslatableFields(project).map(field => [field.id, field.target]))
  const ops: ProjectPatch['ops'] = []

  for (const item of result.fields) {
    const target = offered.get(item.id)
    if (target === undefined) continue

    if (target.kind === 'label') {
      ops.push(...labelFieldToPatch(item.english, target, project).ops)
    } else if (target.kind === 'retention') {
      ops.push(...retentionTextToPatch(item.english, target, project).ops)
    } else {
      const single = redactToPatch({ english: item.english }, target, project)
      ops.push(...single.ops)
    }
  }

  return { ops }
}

/** Suma liczników z wielu partii — `null`, jeśli KTÓRAKOLWIEK partia nie
 * zgłosiła liczby (ten sam kontagiczny `null` co `sumTokens` w `run.ts`,
 * uogólniony na dowolną liczbę partii zamiast tylko dwóch prób). */
function sumTokens(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b
}

export interface TranslateAllRunResult {
  patch: ProjectPatch
  promptTokens: number | null
  completionTokens: number | null
  repaired: boolean
}

/**
 * Orkiestracja ponad `runTask`: zbiera pola projektu, tnie je na partie
 * (`chunkFields`) i woła `runTask` RAZ NA PARTIĘ — każde wywołanie ma już
 * własną, pojedynczą próbę naprawy (`runTask`), więc to jest pętla PO
 * SKOŃCZONEJ, z góry znanej liście partii, nie retry w nieskończoność.
 * Wyniki wszystkich partii są sklejane w jeden `TranslateAllResult` i
 * dopiero wtedy idą raz do `translateAllToPatch` — jedna łatka z operacjami
 * z całego projektu, zgodnie z briefem, niezależnie od tego, ile partii
 * potrzebował transport do modelu.
 *
 * Projekt bez żadnego pola do przetłumaczenia (wszystko puste) nigdy nie
 * woła modelu — zero partii, licznik tokenów `0`, nie `null` (w
 * odróżnieniu od „nieznane" z `run.ts`: tu wiadomo z całą pewnością, że
 * koszt wyniósł zero, bo zapytania w ogóle nie było).
 */
export async function runTranslateAll(
  provider: Provider,
  project: Project,
  signal: AbortSignal,
  onRepairStart: () => void,
  charBudget: number = DEFAULT_TRANSLATE_ALL_BATCH_CHAR_BUDGET,
): Promise<TranslateAllRunResult> {
  const allFields = collectTranslatableFields(project)
  const batches = chunkFields(allFields, charBudget)
  if (batches.length === 0) {
    return { patch: { ops: [] }, promptTokens: 0, completionTokens: 0, repaired: false }
  }

  const collected: TranslateAllFieldResult[] = []
  let promptTokens: number | null = 0
  let completionTokens: number | null = 0
  let repaired = false

  for (const batch of batches) {
    const input: TranslateAllInput = { fields: batch.map(field => ({ id: field.id, text: field.text })) }
    const result = await runTask(
      provider, translateAllTaskFor(batch, allFields), input, signal, onRepairStart,
    )
    collected.push(...result.value.fields)
    promptTokens = sumTokens(promptTokens, result.promptTokens)
    completionTokens = sumTokens(completionTokens, result.completionTokens)
    repaired = repaired || result.repaired
  }

  return {
    patch: translateAllToPatch({ fields: collected }, project),
    promptTokens,
    completionTokens,
    repaired,
  }
}
