import {
  MS_PER_FRAME, snapToFrame, type ObjectRef, type Project, type Segment, type Shot,
} from '@mmh3/shared'
import { DICT } from '../i18n/dict.js'
import { shotSpans } from './spans.js'
import { speakerIntroducedBefore } from './proposals.js'

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
  /**
   * Mówca musi istnieć w `project.speakers`, jeśli jest podany. Bez tej
   * straży `renderSpeakerSegment` (shared/src/compile/renderSpeaker.ts)
   * dostałby `speakerIds: [speakerId]` bez odpowiadającego rekordu, jego
   * `.find(...)` zwróciłby `undefined`, a funkcja rzuca na to jawnym
   * wyjątkiem (`Brak mówcy o id ${id}`) — `buildPrompt` zamienia taki
   * wyjątek w `COMPILE_FAILED` na projekcie, który przed wywołaniem się
   * kompilował. Dziś jedyne miejsce wołające tę funkcję z interfejsu
   * przekazuje `null` (patrz `DialogueTracks.tsx`), więc nieznany
   * `speakerId` jest dziś nieosiągalny z UI — ale funkcja jest eksportowana,
   * test briefu woła ją wprost, a kolejne zadanie przepina te przyciski, więc
   * nieznany identyfikator to pomyłka wołającego: oddajemy projekt bez zmian,
   * tak samo jak `spanAt` odmawia dla playheada poza jakimkolwiek ujęciem.
   */
  if (speakerId !== null && !project.speakers.some(candidate => candidate.id === speakerId)) {
    return project
  }

  const span = spanAt(project, atMs)
  if (!span) return project
  const range = rangeFrom(Math.max(atMs, span.startMs), project.video.durationMs)
  const id = nextId('line', project.shots.flatMap(shot => shot.dialogue).map(event => event.id))

  /**
   * Segment mówcy tylko, gdy mówca jest znany. Bez niego (`speakerId ===
   * null`) `{kind:'speaker', speakerIds: []}` byłby jedyną opcją — a
   * `renderSpeakerSegment` czyta `resolved[0]` bez sprawdzenia długości i
   * wybuchłby na pustej tablicy — więc kwestia bez mówcy zostaje sama, jak
   * kwestia narracyjna w danych testowych (`d4` w `fixtures.ts`).
   *
   * `form: 'full'` niezależnie od tego, czy mówca był już wcześniej
   * wprowadzony. To bezpieczne wyłącznie względem `SPEAKER_FIRST_INTRO`
   * (shared/src/validate/rules/speech.ts): ta reguła sprawdza formę TYLKO
   * przy pierwszym w całym projekcie wystąpieniu danego mówcy w `body`, a
   * `'full'` ten warunek zawsze spełnia; przy kolejnych wystąpieniach reguła
   * w ogóle nie patrzy na formę segmentu. To NIE znaczy „bezpieczne w każdym
   * przypadku" (poprzednia wersja tego komentarza tak twierdziła — błędnie,
   * złapane w rundzie 1 recenzji): jeśli `speaker.fullDescriptor` jest puste
   * (dopuszczalny, realny stan — mówca dodany i jeszcze nie opisany),
   * `renderSpeakerSegment` odda pusty opis przed `(Sx)` — walidator tego nie
   * złapie (reguła patrzy na `form`/`descriptor` SEGMENTU, nie na treść
   * rozstrzygniętego opisu), ale prompt i tak wyjdzie ubogi. A dla mówcy z
   * już bogatym opisem, użytym gdzie indziej, każde kolejne dodanie kwestii
   * tym przyciskiem powtarza ten sam pełny opis w prozie — bez błędu, ale
   * coraz bardziej rozwlekle. Odtworzenie pełnej logiki „czy to pierwsze
   * wystąpienie" z `proposals.ts` (`speakerIntroducedBefore`) nie naprawia
   * żadnej z tych dwóch rzeczy (żadna z nich nie zależy od pozycji w
   * projekcie) — zostaje więc jako świadomy kompromis, nie przeoczenie.
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

const isWhitespaceText = (seg: Segment): boolean => seg.kind === 'text' && seg.text.trim() === ''

/**
 * Sprząta `body` po tym, jak `removeSelected` wyfiltrował segmenty
 * przywołujące usunięte obiekty. Dwa osobne przebiegi, oba GENERALNE — nie
 * dowiązane do tego, KTÓRY konkretnie obiekt akurat zniknął (złapane w
 * rundzie 1 recenzji jako „nie specjalizuj parowania, sprzątaj ogólnie"):
 *
 * 1. Segment mówcy, który przestał cokolwiek wprowadzać. „Wprowadza" liczy
 *    się strukturalnie: segmenty między nim a NASTĘPNYM segmentem mówcy (albo
 *    końcem `body`, gdy kolejnego nie ma) — mówca zostaje zdjęty TYLKO, gdy
 *    ten przedział jest CAŁY samą spacją (albo pusty). Węższa wersja niż w
 *    rundzie 1 (tam: „zdejmij, gdy w przedziale nie ma już `dialogue`") —
 *    złapane w rundzie 2 recenzji: przedział mógł nieść ręcznie napisaną
 *    narrację („steps into the courtyard.") bez żadnego segmentu `dialogue`
 *    obok, a usunięcie NIEPOWIĄZANEGO obiektu w tym samym ujęciu (np. ruchu
 *    kamery gdzie indziej w `body`) i tak przechodziło przez ten sam
 *    przebieg i zdejmowało mówcę, którego ta narracja wciąż potrzebowała.
 *    `addDialogue`/`splitAtSceneTrans` (jedyni dzisiejsi autorzy segmentów
 *    mówcy) zawsze parują mówcę z `dialogue` i niczym więcej, więc ten
 *    przypadek nie jest osiągalny z dzisiejszego interfejsu — ale jest
 *    poprawny względem typu `Segment` i osiągalny przez import/ręczną edycję
 *    `project.json` (naprawia to `shared/src/model/repairIds.ts` w drugą
 *    stronę, nie tę). Test „mówca wprowadzający kilka kwestii z rzędu…"
 *    (bez zmian) i tak przechodzi: przedział z choćby jedną `dialogue` NIE
 *    jest „całą spacją", więc węższa reguła i szersza dawały tu ten sam wynik
 *    — różnią się dopiero na przedziale z narracją.
 * 2. Separatory-spacje (`{kind:'text', text:' '}` z `appendToBody`), które
 *    przestały cokolwiek rozdzielać: ciąg kolejnych spacji zwija się do
 *    jednej, a spacja na samym początku/końcu `body` znika całkiem — na
 *    krawędzi nie ma już dwóch stron do rozdzielenia. Bez tego przebiegu
 *    trzy cykle „dodaj obiekt, usuń go" na ujęciu z jednym przetrwałym
 *    obiektem zostawiały po sobie TRZY osierocone spacje (usunięcie kasowało
 *    tylko sam obiekt, nigdy separator przed nim) — złapane w rundzie 1
 *    recenzji jako wyciek do `project.json`.
 *
 * Kolejność ma znaczenie: krok 1 może osierocić WŁASNY separator mówcy
 * (`{kind:'speaker'}, {text:' '}, {kind:'dialogue'}` z `addDialogue` — gdy
 * cała trójka traci ostatni żywy segment `dialogue` w przedziale, zdjęcie
 * mówcy zostawia samą spację), więc krok 2 musi biec PO kroku 1, nie przed
 * ani równolegle.
 *
 * Zwraca też `droppedSpeakerIds` — identyfikatory mówców, których segment
 * KROK 1 faktycznie zdjął. `removeSelected` używa tego do decyzji, dla
 * których mówców trzeba jeszcze sprawdzić, czy ich nowe pierwsze
 * (przetrwałe) wystąpienie w CAŁYM projekcie wciąż niesie formę `'full'` —
 * patrz `promoteFirstSurvivingIntroduction` niżej.
 */
function pruneBody(body: Segment[]): { body: Segment[]; droppedSpeakerIds: string[] } {
  const droppedSpeakerIds: string[] = []
  const withoutOrphanSpeakers = body.filter((seg, index) => {
    if (seg.kind !== 'speaker') return true
    const rest = body.slice(index + 1)
    const nextSpeakerOffset = rest.findIndex(candidate => candidate.kind === 'speaker')
    const run = nextSpeakerOffset === -1 ? rest : rest.slice(0, nextSpeakerOffset)
    if (!run.every(candidate => isWhitespaceText(candidate))) return true
    droppedSpeakerIds.push(...seg.speakerIds)
    return false
  })

  const collapsed: Segment[] = []
  for (const seg of withoutOrphanSpeakers) {
    const previous = collapsed[collapsed.length - 1]
    if (isWhitespaceText(seg) && previous !== undefined && isWhitespaceText(previous)) continue
    collapsed.push(seg)
  }
  while (collapsed.length > 0) {
    const first = collapsed[0]
    if (first === undefined || !isWhitespaceText(first)) break
    collapsed.shift()
  }
  while (collapsed.length > 0) {
    const last = collapsed[collapsed.length - 1]
    if (last === undefined || !isWhitespaceText(last)) break
    collapsed.pop()
  }
  return { body: collapsed, droppedSpeakerIds }
}

/**
 * Po zdjęciu mówcy, który stracił swój jedyny (pełny albo skrócony) segment
 * w JEDNYM ujęciu, mówca mógł mieć DALSZE, przetrwałe segmenty w innych
 * ujęciach — dokładnie kształt, jaki zostawia `splitAtSceneTrans`: `'full'`
 * w ujęciu, gdzie kwestia zaczyna się po raz pierwszy, `'short'` w
 * kolejnym, dokąd przechodzi przez cięcie. Jeśli zdjęty segment był tym
 * `'full'`, przetrwały `'short'` staje się nowym pierwszym wystąpieniem
 * mówcy w porządku projektu — a `SPEAKER_FIRST_INTRO`
 * (shared/src/validate/rules/speech.ts) wymaga formy `'full'` albo opisu
 * właśnie na PIERWSZYM wystąpieniu. Złapane w rundzie 2 recenzji: bez tej
 * funkcji Delete potrafiło zapalić tę regułę na projekcie, który jej nie miał.
 *
 * Szuka pierwszego PRZETRWAŁEGO segmentu `speaker` dla `speakerId`, idąc po
 * ujęciach w kolejności (`shotSpans`) i po `body` w kolejności tablicy —
 * dokładnie ten sam porządek skanowania, którego używa `SPEAKER_FIRST_INTRO`
 * i `speakerIntroducedBefore` w `proposals.ts`. Reużywa
 * `speakerIntroducedBefore` zamiast pisać drugą odpowiedź na to samo pytanie
 * (reguła 1/5 recenzji zadania 14) — dla znalezionego segmentu funkcja ta
 * potwierdza, że NIC wcześniejszego już go nie wyprzedza (przy tym porządku
 * skanowania zawsze prawda, ale to ta sama gwarancja, na której stoi
 * `SPEAKER_FIRST_INTRO`, nie założenie wynalezione tutaj od nowa). Gdy
 * znaleziony segment ma już `form: 'full'` albo własny `descriptor`, nie ma
 * czego podnosić — funkcja nic nie zmienia. Gdy mówca nie ma już ŻADNEGO
 * przetrwałego segmentu (bo cała jego kwestia zniknęła), pętla kończy się
 * bez akcji — to scenariusz `SPEAKER_SILENT_NO_ID`, osobna, uczciwa
 * diagnostyka, nie coś, co promocja formy potrafi albo powinna naprawić.
 */
function promoteFirstSurvivingIntroduction(shots: Shot[], durationMs: number, speakerId: string): Shot[] {
  const spans = shotSpans(shots, durationMs)
  for (const [position, span] of spans.entries()) {
    const segIndex = span.shot.body.findIndex(seg => seg.kind === 'speaker' && seg.speakerIds.includes(speakerId))
    if (segIndex === -1) continue
    if (speakerIntroducedBefore(spans, position, speakerId)) return shots
    const segment = span.shot.body[segIndex]
    if (segment === undefined || segment.kind !== 'speaker') return shots
    if (segment.form === 'full' || segment.descriptor) return shots
    return shots.map(shot => (shot.id === span.shot.id
      ? { ...shot, body: shot.body.map((seg, index) => (index === segIndex ? { ...segment, form: 'full' as const } : seg)) }
      : shot))
  }
  return shots
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
 *
 * `pruneBody` (patrz komentarz tam) biegnie TYLKO nad ujęciem, w którym
 * `dropsSegment` faktycznie coś wyfiltrował (`afterRemoval.length !==
 * shot.body.length`) — nie nad każdym ujęciem projektu. Bez tej straży
 * sprzątanie separatorów ruszałoby też `body` ujęć, których to usunięcie
 * wcale nie dotyczyło; zwijanie/przycinanie jest tam bez efektu (nie ma czego
 * sprzątać), ale straż czyni to jawnym, zamiast polegać na przypadkowej
 * niezmienności przebiegu na nietkniętych danych.
 *
 * Promocja formy (`promoteFirstSurvivingIntroduction`) biegnie PO tym, jak
 * WSZYSTKIE ujęcia dostały już swoje przycięte `body` — nie w tej samej
 * pętli `.map` — bo wymaga widoku na CAŁY projekt naraz (mówca stracony w
 * jednym ujęciu może przetrwać w innym), czego pojedyncza iteracja po
 * jednym ujęciu nie ma.
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

  const affectedSpeakerIds: string[] = []
  const shotsAfterRemoval = project.shots.map(shot => {
    const afterRemoval = shot.body.filter(seg => !dropsSegment(seg))
    let body = shot.body
    if (afterRemoval.length !== shot.body.length) {
      const pruned = pruneBody(afterRemoval)
      body = pruned.body
      affectedSpeakerIds.push(...pruned.droppedSpeakerIds)
    }
    return {
      ...shot,
      cameraMoves: shot.cameraMoves.filter(move => !cameras.includes(move.id)),
      dialogue: shot.dialogue.filter(event => !lines.includes(event.id)),
      screenText: shot.screenText.filter(entry => !texts.includes(entry.id)),
      diegeticSfx: shot.diegeticSfx.filter(sound => !sounds.includes(sound.id)),
      body,
    }
  })

  const finalShots = [...new Set(affectedSpeakerIds)].reduce(
    (shots, speakerId) => promoteFirstSurvivingIntroduction(shots, project.video.durationMs, speakerId),
    shotsAfterRemoval,
  )

  return { ...project, shots: finalShots }
}
