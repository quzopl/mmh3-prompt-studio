import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  CameraMotionSchema,
  MS_PER_FRAME,
  snapToFrame,
  type CameraMove,
  type DialogueEvent,
  type Mode,
  type Project,
  type ProjectPatch,
  type Segment,
  type Shot,
  type Speaker,
} from '@mmh3/shared'
import type { ChatMessage } from '../provider.js'
import type { TaskDefinition } from '../run.js'

/**
 * Zadanie 1 z czterech: dwa zdania pomysłu (po polsku, bez tłumaczenia) plus
 * tryb i długość projektu stają się początkową strukturą ujęć. Model NIE
 * zwraca `Shot[]` — `Shot.body` odwołuje się do identyfikatorów ruchów kamery,
 * mówców i kwestii, których model nie zna i nie ma jak wymyślić spójnie z resztą
 * projektu (zob. brief). Model opisuje treść ujęcia po angielsku, kod
 * (`structureToPatch`) nadaje identyfikatory i składa `Shot` w całości.
 */
export const StructureShotSchema = z.object({
  startSeconds: z.number().min(0),
  composition: z.string().min(1),
  action: z.string().min(1),
  cameraMove: CameraMotionSchema.optional(),
  speaker: z.string().min(1).optional(),
  line: z.string().min(1).optional(),
})

export const StructureSchema = z.object({
  shots: z.array(StructureShotSchema).min(1).max(12),
})

export type StructureShot = z.infer<typeof StructureShotSchema>
export type StructureResult = z.infer<typeof StructureSchema>

/**
 * Dane wejściowe zadania. Mówcy, tryb i długość pochodzą z projektu po
 * stronie serwera (`routes/llm.ts`), nie od klienta — klient dostarcza
 * wyłącznie dwa zdania pomysłu. Dzięki temu model zawsze widzi AKTUALNĄ listę
 * mówców projektu, a nie kopię, którą przeglądarka mogłaby przesłać
 * nieaktualną.
 */
export interface StructureInput {
  ideaA: string
  ideaB: string
  mode: Mode
  durationSeconds: number
  speakers: Array<{ code: string; characterType: string }>
}

export const StructureInputSchema = z.object({
  ideaA: z.string().min(1),
  ideaB: z.string().min(1),
  mode: z.enum(['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF']),
  durationSeconds: z.number().positive(),
  speakers: z.array(z.object({ code: z.string(), characterType: z.string() })),
})

// Schemat JSON wymuszany na odpowiedzi modelu (patrz `TaskDefinition.jsonSchema`
// w `run.ts`) — osobny od `StructureSchema` (Zod), bo dostawca oczekuje
// surowego obiektu JSON Schema, nie instancji Zoda. Słownik ruchów kamery
// bierzemy z `CameraMotionSchema.options`, żeby nie utrzymywać go osobno
// trzeci raz.
const structureJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['shots'],
  properties: {
    shots: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['startSeconds', 'composition', 'action'],
        properties: {
          startSeconds: { type: 'number', minimum: 0 },
          composition: { type: 'string', minLength: 1 },
          action: { type: 'string', minLength: 1 },
          cameraMove: { type: 'string', enum: [...CameraMotionSchema.options] },
          speaker: { type: 'string', minLength: 1 },
          line: { type: 'string', minLength: 1 },
        },
      },
    },
  },
} as const

const SYSTEM_PROMPT = [
  'You turn a short two-sentence idea into an initial shot structure for a '
    + 'video-generation prompt. Work in English even though the idea itself may '
    + 'be given in another language — do not translate the idea, just describe '
    + 'shots for it.',
  'Describe the image, not the mood: "composition" and "action" must name what '
    + 'the camera frames and what physically happens on screen. Never describe '
    + 'emotions, atmosphere, or intent directly — show them through action.',
  'One shot is one thought. Do not pack more than a single beat of action into '
    + 'a shot; split into another shot instead.',
  'Only reference a speaker from the "Existing speakers" list below, and only '
    + 'by their exact code (e.g. "S1"). Never invent a speaker or a code that is '
    + 'not in the list. If no speaker fits, leave "speaker" and "line" out.',
  'A camera move, if any, must be chosen from the vocabulary enforced by the '
    + 'schema. Leave "cameraMove" out entirely when the shot is static or you '
    + 'are unsure.',
  '"startSeconds" is your best estimate of when the shot starts, in seconds '
    + 'from the beginning of the video — it will be snapped to the exact frame '
    + 'grid by the caller, so approximate values are fine.',
].join('\n')

function buildUserMessage(input: StructureInput): string {
  const speakerList = input.speakers.length > 0
    ? input.speakers.map(s => `${s.code} (${s.characterType})`).join(', ')
    : '(none yet — do not reference any speaker)'
  // Ostrzeżenia miękkie, zgodne z dotkliwością reguł, które opisują (patrz
  // `shared/src/validate/rules/anchors.ts`): FL2VA_PREFER_SINGLE_SHOT to tylko
  // ostrzeżenie, więc to podpowiedź dla modelu, nie twardy limit narzucony w
  // kodzie — kilka ujęć w FL2VA wciąż przechodzi przez walidator.
  const modeNote = input.mode === 'FL2VA'
    ? ' This project is in FL2VA mode: a single shot is strongly preferred so the model can interpolate between the first and last frame.'
    : input.mode === 'L2VA'
      ? ' This project is in L2VA mode: the reference frame belongs to the last shot.'
      : ''
  return [
    `Mode: ${input.mode}.${modeNote}`,
    `Target duration: ${input.durationSeconds} seconds.`,
    `Existing speakers: ${speakerList}.`,
    '',
    'Idea (verbatim, do not translate):',
    input.ideaA,
    input.ideaB,
  ].join('\n')
}

export const structureTask: TaskDefinition<StructureResult> = {
  name: 'struktura ujęć',
  schema: StructureSchema,
  jsonSchema: structureJsonSchema,
  maxTokens: 2000,
  buildMessages: (input: unknown): ChatMessage[] => {
    const parsed = StructureInputSchema.parse(input)
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(parsed) },
    ]
  },
}

const frameIndex = (ms: number): number => Math.round(snapToFrame(ms) / MS_PER_FRAME)
const msOfFrame = (frame: number): number => Math.round(frame * MS_PER_FRAME)

/**
 * Czasy od modelu są w sekundach, dowolne i w dowolnej kolejności. Ta funkcja
 * daje im dokładnie te własności, których pilnuje `normalizeShots` w
 * `web/src/timeline/normalize.ts` przy edycji ręcznej — siatka klatek,
 * rosnąco, pierwsze ujęcie na zero, żadne dwa na tej samej klatce — ALE bez
 * importu z `web/`: `server/` nie ma prawa przekroczyć tej granicy (patrz
 * brief zadania 6). Dubluje więc ten sam, krótki algorytm zamiast go
 * importować.
 *
 * Różnica względem `normalizeShots`: tam wejściem są istniejące ujęcia, które
 * mogą wykroczyć poza `durationMs` dopiero w trakcie przeciągania; tu
 * budujemy ujęcia od zera z odpowiedzi modelu, która nie zna długości
 * projektu inaczej niż z promptu — więc ten sam przebieg wsteczny, przycinający
 * do końca materiału, jest tu pierwszą i jedyną linią obrony przed
 * `SHOT_TIME_IN_RANGE` (reguła, która NIE jest przyjętym wyjątkiem).
 *
 * Zwraca listę `{ shot, startMs }` w kolejności chronologicznej (posortowanej) —
 * to jest też docelowa kolejność `index` w wynikowych ujęciach.
 */
function assignChronologicalStarts(
  shots: StructureShot[],
  durationMs: number,
): Array<{ shot: StructureShot; startMs: number }> {
  const ordered = [...shots].sort((a, b) => a.startSeconds - b.startSeconds)
  const count = ordered.length

  const frames: number[] = []
  let previous = -1
  ordered.forEach((shot, position) => {
    const wanted = position === 0 ? 0 : frameIndex(shot.startSeconds * 1000)
    const frame = Math.max(previous + 1, wanted)
    frames.push(frame)
    previous = frame
  })

  const lastFrame = Math.max(0, frameIndex(durationMs) - 1)
  frames[count - 1] = Math.min(frames[count - 1] ?? 0, lastFrame)
  for (let i = count - 2; i >= 0; i -= 1) {
    frames[i] = Math.min(frames[i] ?? 0, (frames[i + 1] ?? 0) - 1)
  }
  const head = frames[0] ?? 0
  if (head < 0) {
    for (let i = 0; i < count; i += 1) frames[i] = (frames[i] ?? 0) - head
  }

  return ordered.map((shot, position) => ({ shot, startMs: msOfFrame(frames[position] ?? 0) }))
}

/**
 * Kolejny identyfikator w rodzinie liczony z MAKSIMUM istniejących numerów, nie
 * z ich liczby — zgodnie z `web/src/timeline/ids.ts` (`nextId`), którego z tego
 * samego powodu granicy `server/`/`web/` nie można tu zaimportować. Numeracja
 * po liczbie obiektów wraca do wcześniejszej wartości po usunięciu jednego i
 * produkuje duplikat (zmierzone w tym projekcie na czasach cięcia — patrz
 * `repairIds.ts`). Zwraca generator, bo w jednym przebiegu potrafimy nadać
 * wiele identyfikatorów tej samej rodziny naraz.
 */
function idGenerator(prefix: string, existing: string[]): () => string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`)
  let highest = existing.reduce((best, id) => {
    const match = pattern.exec(id)
    const value = match?.[1] === undefined ? 0 : Number.parseInt(match[1], 10)
    return Number.isFinite(value) && value > best ? value : best
  }, 0)
  return () => {
    highest += 1
    return `${prefix}-${highest}`
  }
}

function findSpeakerByCode(project: Project, name: string): Speaker | undefined {
  const needle = name.trim().toLowerCase()
  if (needle === '') return undefined
  return project.speakers.find(speaker => speaker.code.trim().toLowerCase() === needle)
}

function composeBodyText(composition: string, action: string): string {
  const parts = [composition.trim(), action.trim()].filter(part => part !== '')
  return parts.join(' ')
}

/**
 * Buduje `replaceShots` z opisu modelu. Pusta lista ujęć w odpowiedzi to
 * poprawny, choć bezużyteczny wynik (model np. nie miał nic do zaproponowania) —
 * daje łatkę bez operacji, NIE ujęcie zerowej długości: `StructureSchema`
 * wymusza `min(1)` w rozmowie z modelem, ale funkcja jest testowana wprost, na
 * własnych danych, więc musi być bezpieczna także na wejściu, którego prawdziwa
 * rozmowa nigdy by nie wyprodukowała.
 */
export function structureToPatch(result: StructureResult, project: Project): ProjectPatch {
  if (result.shots.length === 0) return { ops: [] }

  const assigned = assignChronologicalStarts(result.shots, project.video.durationMs)
  const nextShotId = idGenerator('s', project.shots.map(s => s.id))
  const nextMoveId = idGenerator('move', project.shots.flatMap(s => s.cameraMoves.map(m => m.id)))
  const nextLineId = idGenerator('line', project.shots.flatMap(s => s.dialogue.map(d => d.id)))

  // Kwestie bez pasującego mówcy: `DialogueEventSchema` wymaga co najmniej
  // jednego `speakerId`, więc kwestii, której nie da się do nikogo przypisać,
  // po prostu nie tworzymy — ale użytkownik ma widzieć, co i dlaczego zostało
  // pominięte, zamiast żeby treść po prostu zniknęła bez śladu (Plan 4).
  const skippedNotes: string[] = []

  const shots: Shot[] = assigned.map(({ shot: input, startMs }, position) => {
    const nextStartMs = assigned[position + 1]?.startMs ?? project.video.durationMs

    const body: Segment[] = [{ kind: 'text', text: composeBodyText(input.composition, input.action) }]
    const cameraMoves: CameraMove[] = []
    const dialogue: DialogueEvent[] = []

    if (input.cameraMove !== undefined) {
      const moveId = nextMoveId()
      // Ruch obejmuje cały czas trwania ujęcia — dokładnie granice, których
      // pilnuje `CAM_IN_SHOT_BOUNDS`, więc żaden nowy ruch nie może jej złamać.
      cameraMoves.push({ id: moveId, type: input.cameraMove, startMs, endMs: nextStartMs })
      body.push({ kind: 'camera', moveId })
    }

    if (input.line !== undefined) {
      const speaker = input.speaker !== undefined ? findSpeakerByCode(project, input.speaker) : undefined
      if (speaker === undefined) {
        const who = input.speaker !== undefined ? `„${input.speaker}"` : 'bez podanego mówcy'
        skippedNotes.push(`ujęcie ${position + 1}, mówca ${who}: „${input.line}"`)
      } else {
        const eventId = nextLineId()
        dialogue.push({
          id: eventId,
          speakerIds: [speaker.id],
          verb: 'says',
          punctuation: ':',
          language: 'English',
          text: input.line,
          voiceover: false,
          sceneTransBefore: false,
          sceneTransAfter: false,
          cutoff: false,
          startMs,
          endMs: nextStartMs,
        })
        // Forma `'full'` zawsze — `SPEAKER_FIRST_INTRO` wymaga tego tylko przy
        // PIERWSZYM wystąpieniu mówcy w projekcie, ale powtórzenie jej przy
        // kolejnych nie jest błędem, a śledzenie „czy to już pierwsze
        // wystąpienie" w poprzek ujęć nie dodaje tu żadnej wartości.
        body.push({ kind: 'speaker', speakerIds: [speaker.id], form: 'full' })
        body.push({ kind: 'dialogue', eventId })
      }
    }

    return {
      id: nextShotId(),
      index: position,
      startMs,
      cutType: 'cut',
      cutPhrase: 'the camera cuts to',
      composition: input.composition,
      body,
      cameraMoves,
      dialogue,
      screenText: [],
      diegeticSfx: [],
      labelRefs: [],
      anchors: [],
    }
  })

  const label = skippedNotes.length === 0
    ? 'Struktura ujęć z pomysłu.'
    : `Struktura ujęć z pomysłu. Pominięto kwestie bez pasującego mówcy: ${skippedNotes.join('; ')}.`

  return {
    ops: [{ kind: 'replaceShots', id: `op-${randomUUID()}`, label, shots }],
  }
}
