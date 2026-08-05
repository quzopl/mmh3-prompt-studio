import {
  MS_PER_FRAME, snapToFrame, type ObjectRef, type Project, type Segment,
} from '@mmh3/shared'
import { DICT } from '../i18n/dict.js'
import { newSpeaker } from '../model/speakers.js'
import { shotSpans } from './spans.js'
import { DIALOGUE_ID_PREFIX, nextId } from './ids.js'
import { normalizeProject } from './normalizeProject.js'

/** Domyślna długość nowego obiektu: sekunda, przycięta do tego, co zostało. */
const DEFAULT_LENGTH_MS = 1000

const frameIndexOf = (ms: number): number => Math.round(ms / MS_PER_FRAME)
const msOfFrameIndex = (frame: number): number => Math.round(frame * MS_PER_FRAME)

/**
 * Ujęcie pod playheadem. Przedziały są PÓŁOTWARTE (`[start, end)`), bo koniec
 * jednego ujęcia to początek następnego i wspólna klatka musi należeć do
 * dokładnie jednego z nich — ale OSTATNIE ujęcie nie ma następnika, więc jego
 * ostatnia chwila nie należałaby do niczego.
 *
 * Recenzja końcowa, znalezisko 5: playhead potrafi stanąć DOKŁADNIE na
 * `durationMs` — klawisz End go tam stawia (`useTimelineShortcuts`), a każda
 * długość będąca wielokrotnością klatki (8000, 7500, 5000 ms) trafia tam też
 * przez przewijanie klatka po klatce. Przy warunku `atMs < span.endMs` żadne
 * ujęcie wtedy nie pasowało i KAŻDY przycisk „+" po prostu milczał: bez
 * obiektu, bez błędu, bez śladu w interfejsie. Ostatnie ujęcie jest więc
 * właścicielem swojej ostatniej chwili — przedział domknięty tylko na samym
 * końcu materiału, gdzie nie ma z kim go dzielić.
 */
const spanAt = (project: Project, atMs: number) => {
  const spans = shotSpans(project.shots, project.video.durationMs)
  const lastPosition = spans.length - 1
  return spans.find((span, position) => atMs >= span.startMs
    && (atMs < span.endMs || (position === lastPosition && atMs <= span.endMs)))
}

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

/**
 * Kwestia dialogowa jest ZAWSZE przypisana do mówcy. Nie jest to ozdoba
 * modelu: `DialogueEventSchema` wymaga `speakerIds.min(1)`, a
 * `PUT /api/projects/:slug` waliduje tym samym schematem — kwestia z pustą
 * tablicą wraca z kodem 400, a że autozapis wysyła CAŁY projekt, JEDNO
 * kliknięcie psuło autozapis do końca sesji (recenzja końcowa, znalezisko 1;
 * odtworzone w Chromium: klik, dalsza zwykła praca, przeładowanie — cała
 * sesja od utworzenia projektu przepadła). Zgadza się to też z guide: kwestia
 * mówiona ma mówcę, a narracja bez mówcy to proza w `body`, nie
 * `DialogueEvent`.
 *
 * Wybór mówcy, w kolejności:
 *  - podany `speakerId`, o ile ISTNIEJE w `project.speakers` — nieznany
 *    identyfikator to pomyłka wołającego i oddajemy projekt bez zmian, bo
 *    `renderSpeakerSegment` (shared/src/compile/renderSpeaker.ts) rzuca na
 *    nierozwiązywalny identyfikator, a `buildPrompt` zamienia to w
 *    `COMPILE_FAILED` na projekcie, który przed wywołaniem się kompilował;
 *  - `null` (tak woła przycisk „+" w `TrackStack`) — PIERWSZY mówca projektu;
 *  - a gdy projekt nie ma ŻADNEGO mówcy (stan świeżo utworzonego projektu,
 *    patrz `server/src/storage/newProject.ts`) — minimalny nowy mówca,
 *    dokładnie tego samego kształtu co z przycisku „Dodaj mówcę" w
 *    `AssetBin` (`web/src/model/speakers.ts`, jedna implementacja).
 *
 * Trzecia gałąź, a nie wyszarzony przycisk: pas dialogów jest jedynym pasem,
 * którego przycisk „+" musiałby milczeć w stanie, w jakim KAŻDY projekt się
 * zaczyna, a znalezisko 5 tej samej recenzji dotyczyło właśnie przycisków
 * cicho nic nierobiących. Cena — mówca dopisany do obsady gestem na osi
 * czasu — jest widoczna (pojawia się nowy pas i wpis w koszu zasobów) i
 * cofalna jednym Ctrl+Z, a przede wszystkim DOWIEDZIONA jako niewnosząca
 * żadnej diagnostyki: `SPEAKER_FIRST_INTRO` patrzy na FORMĘ segmentu
 * (dostaje `'full'`), a `SPEAKER_SILENT_NO_ID` na to, czy mówca ma jakąś
 * kwestię (dostaje ją w tym samym geście) — przemiot różnicowy w
 * `createOnTrack.test.ts` („świeżo utworzony mówca nie zapala żadnej nowej
 * diagnostyki").
 *
 * `form: 'full'` niezależnie od tego, czy mówca był już wcześniej
 * wprowadzony. To bezpieczne wyłącznie względem `SPEAKER_FIRST_INTRO`
 * (shared/src/validate/rules/speech.ts): ta reguła sprawdza formę TYLKO
 * przy pierwszym w całym projekcie wystąpieniu danego mówcy w `body`, a
 * `'full'` ten warunek zawsze spełnia; przy kolejnych wystąpieniach reguła
 * w ogóle nie patrzy na formę segmentu. To NIE znaczy „bezpieczne w każdym
 * przypadku" (złapane w rundzie 1 recenzji zadania 14): jeśli
 * `speaker.fullDescriptor` jest puste (dopuszczalny, realny stan — mówca
 * dodany i jeszcze nie opisany), `renderSpeakerSegment` odda pusty opis przed
 * `(Sx)` — walidator tego nie złapie (reguła patrzy na `form`/`descriptor`
 * SEGMENTU, nie na treść rozstrzygniętego opisu), ale prompt i tak wyjdzie
 * ubogi. A dla mówcy z już bogatym opisem, użytym gdzie indziej, każde
 * kolejne dodanie kwestii tym przyciskiem powtarza ten sam pełny opis w
 * prozie — bez błędu, ale coraz bardziej rozwlekle. Odtworzenie pełnej logiki
 * „czy to pierwsze wystąpienie" z `proposals.ts` (`speakerIntroducedBefore`)
 * nie naprawia żadnej z tych dwóch rzeczy (żadna z nich nie zależy od pozycji
 * w projekcie) — zostaje więc jako świadomy kompromis, nie przeoczenie.
 */
export function addDialogue(project: Project, atMs: number, speakerId: string | null): Project {
  const span = spanAt(project, atMs)
  if (!span) return project

  const owner = speakerId === null
    ? project.speakers[0] ?? newSpeaker(project.speakers)
    : project.speakers.find(candidate => candidate.id === speakerId)
  if (!owner) return project

  const speakers = project.speakers.some(candidate => candidate.id === owner.id)
    ? project.speakers
    : [...project.speakers, owner]

  const range = rangeFrom(Math.max(atMs, span.startMs), project.video.durationMs)
  const id = nextId(DIALOGUE_ID_PREFIX, project.shots.flatMap(shot => shot.dialogue).map(event => event.id))

  const additions: Segment[] = [
    { kind: 'speaker', speakerIds: [owner.id], form: 'full' },
    { kind: 'text', text: ' ' },
    { kind: 'dialogue', eventId: id },
  ]

  return {
    ...project,
    speakers,
    shots: project.shots.map(shot => shot.id === span.shot.id
      ? {
          ...shot,
          dialogue: [...shot.dialogue, {
            id,
            speakerIds: [owner.id],
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
 * Recenzja końcowa (znalezisko 3): ta funkcja NIE odpowiada już za formę
 * wprowadzenia mówcy, który przez sprzątanie stracił swój segment. Poprzednia
 * wersja zwracała `droppedSpeakerIds`, żeby `removeSelected` mogło podnieść
 * przetrwałe wystąpienie do formy pełnej — ale ta sama potrzeba powstaje przy
 * usunięciu całego UJĘCIA (`removeShots`), gdzie żaden `pruneBody` w ogóle
 * nie biegnie. Odpowiedzialność przeszła więc w całości do
 * `normalizeProject` (`normalizeProject.ts`), przez które przechodzą OBIE
 * drogi usuwania — a tu zostaje samo sprzątanie `body`.
 */
function pruneBody(body: Segment[]): Segment[] {
  const withoutOrphanSpeakers = body.filter((seg, index) => {
    if (seg.kind !== 'speaker') return true
    const rest = body.slice(index + 1)
    const nextSpeakerOffset = rest.findIndex(candidate => candidate.kind === 'speaker')
    const run = nextSpeakerOffset === -1 ? rest : rest.slice(0, nextSpeakerOffset)
    if (!run.every(candidate => isWhitespaceText(candidate))) return true
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
  return collapsed
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
 * Wynik przechodzi przez `normalizeProject` (`normalizeProject.ts`), które
 * jako jedyny właściciel stanu pochodnego podnosi formę pierwszego
 * przetrwałego wprowadzenia mówcy — poprzednio robił to ten plik na własną
 * rękę, przez co usunięcie całego UJĘCIA (`removeShots`, druga droga
 * usuwania) tej samej ochrony nie miało. Wywołanie stoi PO tym, jak
 * WSZYSTKIE ujęcia dostały już swoje przycięte `body`, bo wymaga widoku na
 * CAŁY projekt naraz (mówca stracony w jednym ujęciu może przetrwać w innym),
 * czego pojedyncza iteracja po jednym ujęciu nie ma.
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

  const shotsAfterRemoval = project.shots.map(shot => {
    const afterRemoval = shot.body.filter(seg => !dropsSegment(seg))
    const body = afterRemoval.length === shot.body.length ? shot.body : pruneBody(afterRemoval)
    return {
      ...shot,
      cameraMoves: shot.cameraMoves.filter(move => !cameras.includes(move.id)),
      dialogue: shot.dialogue.filter(event => !lines.includes(event.id)),
      screenText: shot.screenText.filter(entry => !texts.includes(entry.id)),
      diegeticSfx: shot.diegeticSfx.filter(sound => !sounds.includes(sound.id)),
      body,
    }
  })

  return normalizeProject(project, shotsAfterRemoval)
}
