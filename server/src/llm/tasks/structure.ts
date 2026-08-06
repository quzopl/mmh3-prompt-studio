import type { PatchLabelId } from '@mmh3/shared'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  CameraMotionSchema,
  orderStartTimes,
  type Anchor,
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
import { dialogueTextSchema } from './dialogueText.js'

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
  // `line` ląduje w `DialogueEvent.text` bez żadnej obróbki (patrz
  // `structureToPatch` niżej) — to JEDYNE miejsce w aplikacji, gdzie treść
  // kwestii dialogowej w ogóle powstaje z odpowiedzi modelu, więc jedyne,
  // które musi ją przepytać strażą z `dialogueText.ts` (recenzja końcowa,
  // punkt 1).
  line: dialogueTextSchema().optional(),
})

export const StructureSchema = z.object({
  shots: z.array(StructureShotSchema).min(1).max(12),
})

export type StructureShot = z.infer<typeof StructureShotSchema>
export type StructureResult = z.infer<typeof StructureSchema>

// Zadanie zawsze pisze po angielsku (patrz `SYSTEM_PROMPT` i brief zadania 16)
// — model nie zgaduje języka mówionego, więc `DialogueEvent.language` dostaje
// tu stałą wartość. Postać mówiąca po polsku w kadrze to decyzja użytkownika
// podjęta później, w inspektorze, nie coś, co to zadanie ma odgadywać.
const GENERATED_LANGUAGE = 'English'

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
    + 'video-generation prompt. Everything you generate — "composition", '
    + '"action", and "line" — is written in English, no matter what language '
    + 'the idea is given in. Do not translate the idea itself; it is input '
    + 'only, and passes through untouched.',
  'Describe the image, not the mood: "composition" and "action" must name what '
    + 'the camera frames and what physically happens on screen. Never describe '
    + 'emotions, atmosphere, or intent directly — show them through action.',
  'One shot is one thought. Do not pack more than a single beat of action into '
    + 'a shot; split into another shot instead.',
  // Zmierzone na prawdziwym modelu: bez tego zdania Qwen pisze kompozycję
  // każdego ujęcia jako samodzielne zdanie z wielkiej litery, a kompilator
  // stawia ją zaraz po frazie cięcia — wychodzi „the camera cuts to The woman
  // walking away". Złote przykłady dostawcy (`shared/test/golden/expected/`)
  // prowadzą to jako jedno zdanie: „the camera cuts to a close-up of steam
  // rising…". Pierwsze ujęcie nie ma przed sobą frazy cięcia, więc jego
  // kompozycja zaczyna się normalnie.
  'The first shot opens the prompt, so its "composition" starts a sentence '
    + 'normally. Every later shot is introduced by a cut phrase such as "the '
    + 'camera cuts to", and its "composition" continues that same sentence: '
    + 'begin it with a lower-case noun phrase, for example "a close-up of the '
    + 'wet platform", never a capitalised standalone sentence.',
  'Only reference a speaker from the "Existing speakers" list below, and only '
    + 'by their exact code (e.g. "S1"). Never invent a speaker or a code that is '
    + 'not in the list. If no speaker fits, leave "speaker" and "line" out.',
  'A camera move, if any, must be chosen from the vocabulary enforced by the '
    + 'schema. Leave "cameraMove" out entirely when the shot is static or you '
    + 'are unsure.',
  '"line" is the spoken dialogue, written in English regardless of the '
    + 'language of the idea. It carries the spoken words only: no "<d>" or '
    + '"</d>" tags, no "[English]" or any other bracketed language marker, no '
    + 'speaker name or code, no stage direction — the compiler adds all of '
    + 'that around your words itself.',
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

/**
 * Czasy od modelu są w sekundach, dowolne i w dowolnej kolejności. Sortujemy
 * je tu (razem z treścią, którą opisują — sortowanie samych liczb w oderwaniu
 * od zawartości pomieszałoby, które ujęcie mówi co), a resztę — siatkę klatek,
 * pierwsze ujęcie na zero, brak dwóch ujęć na tej samej klatce, przycięcie do
 * końca materiału — liczy `orderStartTimes` (`shared/src/time/shotOrder.ts`).
 * Ta sama funkcja stoi za `normalizeShots` w `web/src/timeline/normalize.ts`:
 * jedna definicja obu niezmienników, nie dwie, które się zgadzają tylko z
 * oglądu (runda 1 recenzji: miały, i się rozjechały o stałą `MIN_SHOT_FRAMES`).
 *
 * Przycinanie do końca materiału jest tu też jedyną linią obrony przed
 * `SHOT_TIME_IN_RANGE` (reguła, która NIE jest przyjętym wyjątkiem) — model,
 * mimo długości podanej w promptcie, formalnie mógłby zwrócić czas poza nią.
 */
function assignChronologicalStarts(
  shots: StructureShot[],
  durationMs: number,
): Array<{ shot: StructureShot; startMs: number }> {
  const ordered = [...shots].sort((a, b) => a.startSeconds - b.startSeconds)
  const starts = orderStartTimes(ordered.map(shot => shot.startSeconds * 1000), durationMs)
  return ordered.map((shot, position) => ({ shot, startMs: starts[position] ?? 0 }))
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

/**
 * Zdanie z kompozycji i akcji, zamknięte kropką — jeśli model już jej nie
 * dopisał — żeby to, co dojdzie po niej (ruch kamery jako osobne zdanie,
 * patrz `sentenceJoin` niżej), zaczynało się od wielkiej litery po kropce, a
 * nie w środku tego samego zdania.
 */
const endSentence = (text: string): string =>
  text === '' || /[.!?]$/.test(text) ? text : `${text}.`

/**
 * Domknięcie zdania obowiązuje po KAŻDEJ części, nie tylko po ostatniej.
 * Zmierzone na prawdziwym modelu (Qwen2.5 14B, serwer z RTX PRO 6000): model
 * potrafi napisać kompozycję jako równoważnik zdania bez kropki, a doklejenie
 * akcji samą spacją dawało w skompilowanym prompcie „…the platform is empty and
 * it is raining The woman exits the train…". Model wideo czyta to jako jedno
 * zdanie, więc jest to błąd odczytu, nie kwestia estetyki — ta sama klasa, którą
 * `sentenceJoin` niżej zamyka dla frazy kamery, przeoczona o jedną pozycję
 * wcześniej.
 */
function composeBodyText(composition: string, action: string): string {
  const trimmedComposition = composition.trim()
  const trimmedAction = action.trim()
  // Akcja zaczyna NOWE zdanie tylko wtedy, gdy stoi za kompozycją — wtedy musi
  // iść wielką literą. Gdy kompozycji nie ma, akcja dokleja się do tego, co
  // kompilator postawił przed ciałem ujęcia: frazy cięcia ("the camera cuts
  // to …") albo stylu ("Live-action, cinematic, …"). Oba kończą się na
  // przecinku lub przyimku, więc tam wielka litera rozcięłaby zdanie w pół —
  // przykład dostawcy prowadzi je małą ("…cinematic, a medium-wide shot frames").
  const action2 = trimmedComposition === '' ? trimmedAction : capitalizeFirst(trimmedAction)
  const parts = [trimmedComposition, action2]
    .filter(part => part !== '')
    .map(endSentence)
  return parts.join(' ')
}

const capitalizeFirst = (text: string): string =>
  text === '' ? text : text[0]!.toUpperCase() + text.slice(1)

/**
 * Łączy sąsiednie segmenty `body` tak, żeby skompilowana proza czytała się
 * jako zdania, nie jako jeden zlepiony ciąg.
 *
 * Runda 1 recenzji naprawiła sklejenie (dodała spację między segmentami), ale
 * sama spacja nie wystarcza: `renderCameraMove` (`shared/src/compile/renderCamera.ts`)
 * oddaje frazę BEZ końcowej kropki ("The camera pushes in"), więc segment
 * mówcy doklejony samą spacją czyta się jako dopełnienie czasownika — "The
 * camera pushes in a woman in a blue coat (S1) says:" — realny błąd odczytu
 * dla modelu wideo, nie tylko kwestia estetyki. Złote przykłady w
 * `shared/test/golden/` rozwiązują to samo miejsce łącząc frazę kamery
 * spójnikiem w TYM SAMYM zdaniu (" as ..."), ale to wymaga klauzuli
 * czasownikowej po stronie ruchu, której to zadanie nie ma — model nie
 * podaje nic w rodzaju "as she turns". Najbliższe bezpieczne rozwiązanie bez
 * zmyślania treści: fraza kamery staje się WŁASNYM, kompletnym zdaniem
 * ("The camera pushes in.") zamiast fragmentu bez czasownika dopełnienia.
 *
 * Para mówca→dialog zostaje bez kropki między nimi — to jeden byt gramatyczny
 * ("The woman in a blue coat (S1) says: <d>...</d>"), dokładnie ten sam
 * kształt co w `shared/test/golden/fixtures/base.ts` (i2va: "... the quiet,
 * breathy young woman (S1) says: <d>...").
 */
function sentenceJoin(segments: Segment[]): Segment[] {
  const body: Segment[] = []
  segments.forEach((segment, index) => {
    const previous = segments[index - 1]
    if (previous !== undefined) {
      const connective = previous.kind === 'camera' ? '. ' : ' '
      body.push({ kind: 'text', text: connective })
    }
    body.push(segment)
  })

  // Ostatni segment styka się z nagłówkiem NASTĘPNEGO ujęcia, a `renderCameraMove`
  // celowo nie kończy frazy kropką (w złotych przykładach fraza kamery bywa
  // środkiem zdania, łączonym spójnikiem "as"). Bez domknięcia wychodzi
  // „The camera holds a static shot [Shot 2]" — zmierzone na prawdziwym modelu.
  // Przykład dostawcy kończy ujęcie domknięciem (`</d>`) przed następnym
  // znacznikiem, więc dokładamy je tam, gdzie go zabraknie.
  const last = body[body.length - 1]
  if (last !== undefined && last.kind === 'camera') {
    body.push({ kind: 'text', text: '.' })
  }
  return body
}

/**
 * Kotwice, które warto przenieść ze STAREGO kompletu ujęć na nowy. Model nie
 * wie nic o etykietach ani obrazach referencyjnych (`project.labels`), więc
 * nie ma z czego zbudować nowej kotwicy — ale jeśli projekt już miał
 * poprawnie umieszczoną, `replaceShots` (który wymienia WSZYSTKIE ujęcia
 * naraz) nie ma prawa jej po cichu zgubić.
 *
 * `picture-first` i `picture-last` mają w walidatorze ustaloną stronę:
 * `ANCHOR_REQUIRED` i (w L2VA) `L2VA_ANCHOR_LAST_SHOT`
 * (`shared/src/validate/rules/anchors.ts`) to BŁĘDY, nie przyjęte wyjątki od
 * reguły „żadna nowa diagnostyka", więc trafiają dokładnie tam, gdzie reguła
 * ich szuka: pierwsza na nowe PIERWSZE ujęcie, druga na nowe OSTATNIE.
 *
 * `keyframe` żadnej reguły nie ma (`shared/src/validate/rules` go nigdzie nie
 * czyta) i żadnej ustalonej strony też — `web/src/timeline/AnchorBadges.tsx`
 * pozwala postawić ją na DOWOLNYM ujęciu w trybie REF, nie tylko pierwszym
 * czy ostatnim. Po wymianie kompletu ujęć nie ma jak odtworzyć „tego samego”
 * ujęcia, na którym stała — więc zamiast udawać precyzję, której nie da się
 * mieć, ląduje na nowym pierwszym ujęciu: to i tak lepsze niż ciche
 * zniknięcie decyzji użytkownika bez żadnej diagnostyki, która by o niej
 * powiedziała.
 */
function anchorsToCarry(oldShots: Shot[]): { first: Anchor[]; last: Anchor[] } {
  const allAnchors = new Set(oldShots.flatMap(shot => shot.anchors))
  const first: Anchor[] = []
  const last: Anchor[] = []
  if (allAnchors.has('picture-first')) first.push('picture-first')
  if (allAnchors.has('keyframe')) first.push('keyframe')
  if (allAnchors.has('picture-last')) last.push('picture-last')
  return { first, last }
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
  const carry = anchorsToCarry(project.shots)
  const lastPosition = assigned.length - 1

  // Kwestie bez pasującego mówcy: `DialogueEventSchema` wymaga co najmniej
  // jednego `speakerId`, więc kwestii, której nie da się do nikogo przypisać,
  // po prostu nie tworzymy — ale użytkownik ma widzieć, co i dlaczego zostało
  // pominięte, zamiast żeby treść po prostu zniknęła bez śladu (Plan 4).
  const skippedNotes: string[] = []

  const shots: Shot[] = assigned.map(({ shot: input, startMs }, position) => {
    const nextStartMs = assigned[position + 1]?.startMs ?? project.video.durationMs

    const textSegment: Segment = { kind: 'text', text: composeBodyText(input.composition, input.action) }
    const cameraMoves: CameraMove[] = []
    const dialogue: DialogueEvent[] = []
    const segments: Segment[] = [textSegment]

    if (input.cameraMove !== undefined) {
      const moveId = nextMoveId()
      // Ruch obejmuje cały czas trwania ujęcia — dokładnie granice, których
      // pilnuje `CAM_IN_SHOT_BOUNDS`, więc żaden nowy ruch nie może jej złamać.
      cameraMoves.push({ id: moveId, type: input.cameraMove, startMs, endMs: nextStartMs })
      segments.push({ kind: 'camera', moveId })
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
          language: GENERATED_LANGUAGE,
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
        segments.push({ kind: 'speaker', speakerIds: [speaker.id], form: 'full' })
        segments.push({ kind: 'dialogue', eventId })
      }
    }

    const anchors: Anchor[] = [
      ...(position === 0 ? carry.first : []),
      ...(position === lastPosition ? carry.last : []),
    ]

    return {
      id: nextShotId(),
      index: position,
      startMs,
      cutType: 'cut',
      cutPhrase: 'the camera cuts to',
      composition: input.composition,
      body: sentenceJoin(segments),
      cameraMoves,
      dialogue,
      screenText: [],
      diegeticSfx: [],
      labelRefs: [],
      anchors,
    }
  })

  // Klucz tłumaczenia, nie zdanie — patrz `PatchOpLabel` w `shared/src/patch/types.ts`.
  const labelled: { label: PatchLabelId; labelParams?: Record<string, string> } =
    skippedNotes.length === 0
      ? { label: 'patchLabel.structure' }
      : { label: 'patchLabel.structureSkipped', labelParams: { notes: skippedNotes.join('; ') } }

  return {
    ops: [{ kind: 'replaceShots', id: `op-${randomUUID()}`, ...labelled, shots }],
  }
}
