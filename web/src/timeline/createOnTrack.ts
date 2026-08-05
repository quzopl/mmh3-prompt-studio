import {
  MS_PER_FRAME, snapToFrame, type ObjectRef, type Project, type Segment,
} from '@mmh3/shared'
import { DICT } from '../i18n/dict.js'
import { shotSpans } from './spans.js'

/** Domyślna długość nowego obiektu: sekunda, przycięta do tego, co zostało. */
const DEFAULT_LENGTH_MS = 1000

const frameIndexOf = (ms: number): number => Math.round(ms / MS_PER_FRAME)
const msOfFrameIndex = (frame: number): number => Math.round(frame * MS_PER_FRAME)

/**
 * Identyfikator z maksimum istniejących, nie z ich liczby. Numeracja po liczbie
 * wraca do wcześniejszej wartości po usunięciu obiektu i produkuje duplikat, a
 * duplikat sprawia, że gest wymierzony w jeden obiekt trafia we wszystkie o tym
 * samym identyfikatorze — zmierzone w recenzji Planu 3 na czasach cięcia.
 *
 * UWAGA na `\d` w tym wzorcu: w template literalu JS `\d` nie jest metaznakiem
 * cyfry — nierozpoznana sekwencja ucieczki oddaje sam znak `d` (sprawdzone
 * w node: `` `\d` === 'd' ``), więc wzorzec musi użyć podwójnego backslasha
 * (`\\d`). Brief tego zadania podawał wersję z pojedynczym `\d` — z nią
 * `pattern` dopasowywałby tylko literalne „...-d", nigdy istniejące id, więc
 * `highest` zawsze zostawałby na 0 i KAŻDE wywołanie zwracałoby ten sam
 * identyfikator (np. dwa kolejne ruchy kamery dostałyby oba `move-1`) —
 * dokładnie duplikat, przed którym ostrzega akapit wyżej. Test „dwa ruchy
 * dodane w tym samym miejscu mają różne identyfikatory" łapie to czerwonym.
 */
function nextId(prefix: string, existing: string[]): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`)
  const highest = existing.reduce((best, id) => {
    const match = pattern.exec(id)
    const value = match?.[1] === undefined ? 0 : Number.parseInt(match[1], 10)
    return Number.isFinite(value) && value > best ? value : best
  }, 0)
  return `${prefix}-${highest + 1}`
}

const spanAt = (project: Project, atMs: number) =>
  shotSpans(project.shots, project.video.durationMs)
    .find(span => atMs >= span.startMs && atMs < span.endMs)

/** Zakres nowego obiektu: od playheada, sekunda długości, przycięte do granicy. */
function rangeFrom(atMs: number, highestMs: number): { startMs: number; endMs: number } {
  const startFrame = frameIndexOf(snapToFrame(atMs))
  const highestFrame = frameIndexOf(highestMs)
  const endFrame = Math.min(highestFrame, startFrame + frameIndexOf(DEFAULT_LENGTH_MS))
  const safeStart = Math.min(startFrame, endFrame - 2)
  return { startMs: msOfFrameIndex(Math.max(0, safeStart)), endMs: msOfFrameIndex(endFrame) }
}

/**
 * Dokleja nowe segmenty na KOŃCU `body` ujęcia, oddzielając je od reszty
 * pojedynczą spacją. `renderSegments` (shared/src/compile/renderShot.ts)
 * skleja sąsiednie segmenty pustym stringiem, więc bez separatora nowa treść
 * zlepiłaby się z tym, co w `body` stało wcześniej. Pusty `body` separatora
 * nie dostaje: nagłówek ujęcia już kończy się spacją (`renderShot`), więc
 * druga dawałaby podwójny odstęp bez żadnej korzyści.
 *
 * To jest właściwy powód, dla którego ten plik w ogóle rusza `body` — brief
 * zadania (krok 4) tego nie robił: dopisywał nowy ruch/kwestię/tekst tylko do
 * własnej tablicy (`cameraMoves`/`dialogue`/`screenText`), a `renderShot`
 * czyta `body`, nie te tablice. Bez segmentu w `body` nowy ruch kamery albo
 * kwestia byłyby niewidoczne w skompilowanym prompcie, a `BODY_REFS_COMPLETE`
 * (shared/src/validate/rules/camera.ts — sprawdza kamerę i dialog, licząc
 * odwołania w `body`) zapaliłby się na projekcie, który wcześniej był czysty
 * — dokładnie to, czego zabrania globalne ograniczenie tego zadania. Sam
 * brief ostrzegał przed tym w prozie („nowy obiekt jest niewidoczny dla
 * kompilatora, dopóki pasujący segment nie trafi do `shot.body`"), ale kod w
 * kroku 4 tej lekcji nie stosował — stąd poprawka tutaj.
 */
function appendToBody(body: Segment[], additions: Segment[]): Segment[] {
  if (additions.length === 0) return body
  return body.length === 0 ? additions : [...body, { kind: 'text', text: ' ' }, ...additions]
}

export function addCameraMove(project: Project, atMs: number): Project {
  const span = spanAt(project, atMs)
  if (!span) return project
  const range = rangeFrom(Math.max(atMs, span.startMs), span.endMs)
  const id = nextId('move', project.shots.flatMap(shot => shot.cameraMoves).map(move => move.id))

  return {
    ...project,
    shots: project.shots.map(shot => shot.id === span.shot.id
      ? {
          ...shot,
          cameraMoves: [...shot.cameraMoves, { id, type: 'static' as const, ...range }],
          body: appendToBody(shot.body, [{ kind: 'camera', moveId: id }]),
        }
      : shot),
  }
}

export function addDialogue(project: Project, atMs: number, speakerId: string | null): Project {
  const span = spanAt(project, atMs)
  if (!span) return project
  const range = rangeFrom(Math.max(atMs, span.startMs), project.video.durationMs)
  const id = nextId('line', project.shots.flatMap(shot => shot.dialogue).map(event => event.id))

  /**
   * Segment mówcy tylko, gdy mówca jest znany. Bez niego (`speakerId ===
   * null`) `{kind:'speaker', speakerIds: []}` byłby jedyną opcją — a
   * `renderSpeakerSegment` (shared/src/compile/renderSpeaker.ts) czyta
   * `resolved[0]` bez sprawdzenia długości i wybuchłby na pustej tablicy,
   * zamieniając kompilację w wyjątek (`COMPILE_FAILED`) na projekcie, który
   * wcześniej się kompilował — więc kwestia bez mówcy zostaje sama, jak
   * kwestia narracyjna w danych testowych (`d4` w `fixtures.ts`).
   *
   * `form: 'full'` niezależnie od tego, czy mówca był już wcześniej
   * wprowadzony — bezpieczne w KAŻDYM przypadku: `SPEAKER_FIRST_INTRO`
   * (shared/src/validate/rules/speech.ts) sprawdza formę TYLKO przy
   * pierwszym w całym projekcie wystąpieniu danego mówcy w `body`, a `'full'`
   * ten warunek zawsze spełnia; przy kolejnych wystąpieniach reguła w ogóle
   * nie patrzy na formę segmentu. Odtworzenie pełnej logiki „czy to
   * pierwsze wystąpienie" z `proposals.ts` (`speakerIntroducedBefore`) nie
   * daje więc żadnej dodatkowej ochrony przed diagnostyką — tylko rzadziej
   * powtarzałoby pełny opis mówcy w prozie, co jest kosmetyką, nie regułą.
   */
  const additions: Segment[] = speakerId === null
    ? [{ kind: 'dialogue', eventId: id }]
    : [
        { kind: 'speaker', speakerIds: [speakerId], form: 'full' },
        { kind: 'text', text: ' ' },
        { kind: 'dialogue', eventId: id },
      ]

  return {
    ...project,
    shots: project.shots.map(shot => shot.id === span.shot.id
      ? {
          ...shot,
          dialogue: [...shot.dialogue, {
            id,
            speakerIds: speakerId === null ? [] : [speakerId],
            verb: 'says',
            punctuation: ':' as const,
            language: 'English',
            // Treść MODELU, nie interfejsu — prompt jest po angielsku
            // niezależnie od języka aplikacji, więc nie idzie przez `useT()`.
            // Czytamy `DICT.en` wprost (nie `t(...)`, którego wybór zależy od
            // `useLang`), żeby polski interfejs nie wstawiał polskich słów do
            // promptu, który musi być angielski — patrz komentarz przy tych
            // kluczach w `dict.ts`.
            text: DICT.en['track.newDialogue'],
            voiceover: false,
            sceneTransBefore: false,
            sceneTransAfter: false,
            cutoff: false,
            ...range,
          }],
          body: appendToBody(shot.body, additions),
        }
      : shot),
  }
}

export function addScreenText(project: Project, atMs: number): Project {
  const span = spanAt(project, atMs)
  if (!span) return project
  const id = nextId('text', project.shots.flatMap(shot => shot.screenText).map(entry => entry.id))

  return {
    ...project,
    shots: project.shots.map(shot => shot.id === span.shot.id
      ? {
          ...shot,
          // Treść modelu po angielsku — patrz komentarz przy `addDialogue`.
          screenText: [...shot.screenText, { id, text: DICT.en['track.newScreenText'] }],
          body: appendToBody(shot.body, [{ kind: 'screenText', id }]),
        }
      : shot),
  }
}

export function addSfx(project: Project, atMs: number): Project {
  const span = spanAt(project, atMs)
  if (!span) return project
  const range = rangeFrom(atMs, project.video.durationMs)
  const id = nextId('sfx', project.shots.flatMap(shot => shot.diegeticSfx).map(sound => sound.id))

  return {
    ...project,
    shots: project.shots.map(shot => shot.id === span.shot.id
      ? {
          ...shot,
          // Treść modelu po angielsku — patrz komentarz przy `addDialogue`.
          // `diegeticSfx` nie ma odpowiednika w `Segment` (shared/src/model/types.ts)
          // — `body` zostaje nietknięte, bo nie ma czego tam dopiąć.
          diegeticSfx: [...shot.diegeticSfx, { id, description: DICT.en['track.newSfx'], ...range }],
        }
      : shot),
  }
}

/**
 * Usuwa obiekty ścieżek po referencji zaznaczenia. Ujęć celowo nie rusza —
 * od nich jest `removeShots`, które umie utrzymać niezmienniki listy ujęć,
 * a druga implementacja tego samego rozjechałaby się z pierwszą.
 *
 * Sprząta też segmenty `body`, które przywoływały usunięte obiekty — nie
 * tylko same tablice `cameraMoves`/`dialogue`/`screenText`, jak w kroku 4
 * briefu. Bez tego `renderSegments` (shared/src/compile/renderShot.ts)
 * rzuciłby wyjątkiem na segmencie wskazującym nieistniejący obiekt (każdy z
 * trzech case'ów — `camera`, `dialogue`, `screenText` — ma jawny `throw`, gdy
 * `.find(...)` nie trafi), a `buildPrompt` zamienia taki wyjątek w
 * diagnostykę `COMPILE_FAILED` — samo Delete zapaliłoby więc walidator na
 * projekcie, który przed kliknięciem był czysty. `diegeticSfx` nie ma
 * odpowiednika segmentu, więc dla niego czyszczenie `body` nie dotyczy.
 */
export function removeSelected(project: Project, selected: ObjectRef[]): Project {
  const ids = (kind: string) => selected.filter(ref => ref.kind === kind).map(ref => ref.id)
  const cameras = ids('camera')
  const lines = ids('dialogue')
  const texts = ids('screenText')
  const sounds = ids('sfx')
  if (cameras.length + lines.length + texts.length + sounds.length === 0) return project

  const dropsSegment = (seg: Segment): boolean =>
    (seg.kind === 'camera' && cameras.includes(seg.moveId))
    || (seg.kind === 'dialogue' && lines.includes(seg.eventId))
    || (seg.kind === 'screenText' && texts.includes(seg.id))

  return {
    ...project,
    shots: project.shots.map(shot => ({
      ...shot,
      cameraMoves: shot.cameraMoves.filter(move => !cameras.includes(move.id)),
      dialogue: shot.dialogue.filter(event => !lines.includes(event.id)),
      screenText: shot.screenText.filter(entry => !texts.includes(entry.id)),
      diegeticSfx: shot.diegeticSfx.filter(sound => !sounds.includes(sound.id)),
      body: shot.body.filter(seg => !dropsSegment(seg)),
    })),
  }
}
