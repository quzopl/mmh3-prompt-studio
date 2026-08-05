import { CONTINUITY_PHRASES, type DialogueEvent, type Project, type Segment } from '@mmh3/shared'
import { shotSpans, type ShotSpan } from './spans.js'
import { countWords } from './speech.js'

export type ProposalKind = 'scenetrans' | 'cutoff'

export interface DialogueProposal {
  eventId: string
  kind: ProposalKind
}

/**
 * Propozycje wynikające z samego układu klipów, nie z reguł walidatora.
 * Kwestia przechodząca przez cięcie brzmi w prompcie jak przerwana, chyba że
 * po obu stronach stoi `<scenetrans>`; kwestia wystająca poza materiał kończy
 * się w połowie, co guide zapisuje przez `<cutoff>`. Jedno i drugie widać z
 * geometrii, więc oś czasu może o tym powiedzieć — ale nie zmienia modelu bez
 * decyzji użytkownika.
 *
 * „Cięcie", przez które kwestia przechodzi, to zawsze koniec WŁASNEGO ujęcia
 * kwestii (`span.endMs`, czyli start ujęcia NASTĘPNEGO) — nie jakiekolwiek
 * cięcie w całym projekcie, jak w pierwszej wersji tego pliku. To musi się
 * zgadzać z `applyProposal`: guide (i `SCENETRANS_BOTH_SIDES` w walidatorze,
 * `shared/src/validate/rules/speech.ts`) modeluje „linię usłyszaną przez
 * cięcie" jako DWA osobne bloki `<d>`, po jednym w każdym z sąsiadujących
 * ujęć — nie jeden obiekt z dwiema flagami na sobie. Ustawienie obu flag na
 * tym samym, geometrycznie rozciągniętym zdarzeniu (odrzucona pierwsza
 * wersja) tej reguły nie spełniało: `sceneTransAfter` każe jej szukać
 * OSOBNEJ kwestii z `sceneTransBefore` w NASTĘPNYM ujęciu, a takiej nie było.
 *
 * Guard `!event.sceneTransAfter` (nie sprawdzanie obu flag naraz, jak w
 * odrzuconej wersji) odzwierciedla, że po zastosowaniu propozycji tylko ta
 * jedna flaga ląduje na ORYGINALNYM obiekcie — drugą (`sceneTransBefore`)
 * dostaje NOWY obiekt w sąsiednim ujęciu.
 *
 * Kwestia rozciągnięta na trzy i więcej ujęć dostaje przez to tylko jedną
 * propozycję na raz: po zastosowaniu jej druga połówka, teraz żyjąca w
 * kolejnym ujęciu, sama przechodzi przez SWOJE własne cięcie i przy
 * następnym przebiegu `dialogueProposals` dostaje kolejną propozycję —
 * jeden podział na kliknięcie, nie jeden wielostronny podział na cały zasięg
 * kwestii. Kwestia w ostatnim ujęciu projektu nie może dostać `scenetrans`
 * z tego samego powodu, dla którego nie miałaby gdzie wylądować druga
 * połówka (`hasNextShot` niżej) — wystawanie poza koniec MATERIAŁU to
 * przypadek `cutoff`, nie `scenetrans`.
 *
 * `countWords(event.text) >= 2` — kwestia jedno- (albo zero-, sam biały
 * znak) wyrazowa nie ma jak podzielić się na dwa NIEPUSTE bloki `<d>` (patrz
 * `splitAtSceneTrans`/`splitTextAtFraction`). Lepszy brak plakietki niż
 * plakietka, która po kliknięciu produkuje `<d>[English] </d>` — schemat go
 * nie odrzuci i żadna reguła walidatora tego nie łapie, więc taki eksport
 * przeszedłby po cichu.
 */
export function dialogueProposals(project: Project): DialogueProposal[] {
  const spans = shotSpans(project.shots, project.video.durationMs)
  const proposals: DialogueProposal[] = []

  spans.forEach((span, position) => {
    const hasNextShot = position + 1 < spans.length
    for (const event of span.shot.dialogue) {
      const crossesOwnCut = hasNextShot && event.startMs < span.endMs && event.endMs > span.endMs
      if (crossesOwnCut && !event.sceneTransAfter && countWords(event.text) >= 2) {
        proposals.push({ eventId: event.id, kind: 'scenetrans' })
      }
      if (event.endMs > project.video.durationMs && !event.cutoff) {
        proposals.push({ eventId: event.id, kind: 'cutoff' })
      }
    }
  })
  return proposals
}

export function applyProposal(project: Project, proposal: DialogueProposal): Project {
  return proposal.kind === 'cutoff'
    ? markCutoff(project, proposal.eventId)
    : splitAtSceneTrans(project, proposal.eventId)
}

/** Nie zmienia niczego poza jednym znacznikiem jednej kwestii. */
function markCutoff(project: Project, eventId: string): Project {
  let touched = false
  const shots = project.shots.map(shot => ({
    ...shot,
    dialogue: shot.dialogue.map(event => {
      if (event.id !== eventId) return event
      touched = true
      return { ...event, cutoff: true }
    }),
  }))
  return touched ? { ...project, shots } : project
}

/**
 * Numer w identyfikatorze nowej (drugiej) połówki kwestii — po maksimum już
 * zajętych numerów w CAŁYM projekcie, nie po liczbie kwestii. Ten sam idiom
 * co `nextShotNumber` w `shotOperations.ts` i numerowanie etykiet/mówców w
 * `AssetBin.tsx`: `dialogue.length + 1` wraca do już zajętej wartości za
 * każdym razem, gdy jakaś kwestia zniknie (np. drugi podział po usunięciu
 * pierwszego), więc kolejna nowa kwestia dostałaby identyfikator żywego
 * obiektu — dokładnie ten scenariusz, który w tym projekcie już raz zepsuł
 * przeciągnięcie (patrz komentarz przy `nextShotNumber`). Maksimum plus
 * jeden jest zawsze większe od każdego zajętego numeru, więc kolizja jest
 * niemożliwa niezależnie od historii usunięć.
 */
const nextDialogueNumber = (project: Project): number =>
  Math.max(0, ...project.shots.flatMap(shot => shot.dialogue).map(event => {
    const parsed = Number(/(\d+)$/.exec(event.id)?.[1])
    return Number.isFinite(parsed) ? parsed : 0
  })) + 1

/**
 * Czy mówca ma już JAKIEKOLWIEK wprowadzenie (segment `speaker` wskazujący
 * na niego, albo segment `label` z jego `speakerId`) w którymś z ujęć ŚCIŚLE
 * PRZED podaną pozycją w `spans`. Ten sam zakres skanowania, którego używa
 * `SPEAKER_FIRST_INTRO` (`shared/src/validate/rules/speech.ts`): kolejność
 * ujęć po indeksie, potem kolejność segmentów w `body` — łącznie z formą
 * segmentu, nie tylko jego istnieniem: nawet wprowadzenie, które SAMO łamie
 * regułę (forma `'short'` bez opisu przy pierwszym pojawieniu), i tak zdejmuje
 * mówcę ze zbioru „świeżych" w oczach tej reguły (`introduced.add(id)`
 * wykonuje się TAM zanim reguła w ogóle sprawdzi formę), więc liczy się też
 * tutaj — poprawianie cudzego istniejącego naruszenia nie jest naszą sprawą.
 */
function speakerIntroducedBefore(spans: ShotSpan[], beforePosition: number, speakerId: string): boolean {
  return spans.slice(0, beforePosition).some(span =>
    span.shot.body.some(seg =>
      (seg.kind === 'speaker' && seg.speakerIds.includes(speakerId))
      || (seg.kind === 'label' && seg.speakerId === speakerId)))
}

/**
 * Segment mówcy dla nowej połówki kwestii. Forma liczy się z historii
 * wprowadzeń w ujęciach PRZED ujęciem DOCELOWYM (tym, do którego trafia
 * kontynuacja) — nie ze skopiowanego kształtu segmentu w ujęciu ŹRÓDŁOWYM,
 * jak w odrzuconej wersji z Rundy 2. Ten sam rachunek naprawia dwie
 * usterki tamtej wersji naraz:
 *
 * 1. Gdy źródło nie miało segmentu mówcy przed swoim segmentem dialogowym
 *    (np. `body` jeszcze nie zredagowane ręcznie), domyślne `'short'` z
 *    Rundy 2 mogło stać się PIERWSZYM wprowadzeniem tego mówcy w całym
 *    projekcie — kontynuacja ląduje zawsze na POCZĄTKU `body` ujęcia
 *    docelowego (patrz `splitAtSceneTrans`), więc w kolejności skanowania
 *    `SPEAKER_FIRST_INTRO` to WŁAŚNIE nasz nowy segment byłby świeżym
 *    wprowadzeniem — `'short'` włączało regułę na projekcie, który przed
 *    kliknięciem był czysty. Uzasadnienie w Rundzie 2 („to kontynuacja, nie
 *    pierwsze wystąpienie") było odwrócone dokładnie w tym przypadku:
 *    pozycyjnie, w oczach reguły, to BYŁO pierwsze wystąpienie.
 * 2. Gdy źródło WŁAŚNIE wprowadzało mówcę pełną formą tuż przed swoim
 *    segmentem dialogowym, kopiowanie tego kształtu powtarzało pełny opis
 *    DRUGI raz w kontynuacji, zamiast skrócić się do `'short'`, skoro mówca
 *    został wprowadzony chwilę wcześniej (w tym samym lub poprzednim
 *    ujęciu) i nie trzeba go przedstawiać ponownie.
 *
 * Sprawdzenie „czy WSZYSCY mówcy tej kwestii mają już wprowadzenie" (nie
 * „czy KTÓRYKOLWIEK") — `SPEAKER_FIRST_INTRO` wymaga formy pełnej / opisu,
 * gdy CHOĆ JEDEN z `speakerIds` segmentu jest wciąż świeży; `'short'` jest
 * bezpieczne tylko wtedy, gdy żaden nie jest.
 */
function speakerSegmentFor(spans: ShotSpan[], ownerPosition: number, event: DialogueEvent): Segment {
  const allAlreadyIntroduced = event.speakerIds
    .every(speakerId => speakerIntroducedBefore(spans, ownerPosition + 1, speakerId))
  return { kind: 'speaker', speakerIds: event.speakerIds, form: allAlreadyIntroduced ? 'short' : 'full' }
}

/**
 * Punkt podziału tekstu to szacunek proporcjonalny do czasu, nie pomiar —
 * nic w modelu nie wie, ile faktycznie trwa pojedyncze słowo. Obie strony
 * dostają co najmniej jedno słowo (`clamp` do `[1, words.length - 1]`) —
 * inaczej podział blisko któregoś końca kwestii zostawiłby drugą stronę z
 * pustym tekstem. Wołający (`splitAtSceneTrans`, i wcześniej
 * `dialogueProposals` przez `countWords(...) >= 2`) gwarantuje co najmniej
 * dwa słowa, zanim ta funkcja się wywoła — strażnik `words.length < 2`
 * niżej zostaje mimo to jako druga linia obrony, nie jedyna.
 */
function splitTextAtFraction(text: string, fraction: number): { before: string; after: string } {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) return { before: text, after: '' }
  const raw = Math.round(fraction * words.length)
  const splitIndex = Math.min(Math.max(raw, 1), words.length - 1)
  return { before: words.slice(0, splitIndex).join(' '), after: words.slice(splitIndex).join(' ') }
}

/**
 * Dzieli kwestię DOKŁADNIE na granicy własnego ujęcia (patrz komentarz przy
 * `dialogueProposals`) na dwa obiekty: oryginał zostaje w bieżącym ujęciu,
 * skrócony do cięcia i z `sceneTransAfter`, a nowy ląduje w NASTĘPNYM z
 * `sceneTransBefore`. To jedyny kształt, który `SCENETRANS_BOTH_SIDES`
 * faktycznie przyjmuje — reguła szuka OSOBNEJ kwestii w sąsiednim ujęciu,
 * nie dwóch flag na jednym obiekcie.
 *
 * `cutoff` na ORYGINALE (`trimmedOriginal`) liczy się GEOMETRYCZNIE z jego
 * WŁASNEGO nowego `endMs` (granica cięcia) względem `durationMs` — nie
 * kopiuje się ze `...event`. Ta połówka strukturalnie prawie nigdy nie
 * wystaje poza materiał (granica cięcia leży w środku niego), więc geometria
 * sama daje właściwą odpowiedź: `false`. Bez tego (odrzucona wersja z Rundy
 * 2) oryginał, spreadowany z `...event`, zostawał z `cutoff: true` mimo że
 * jego nowy koniec leży w środku materiału — `CUTOFF_AT_END` włączało się
 * na połówce, która wcale nie wystaje.
 *
 * `cutoff` na KONTYNUACJI nie liczy się z geometrii wcale — DZIEDZICZY się
 * wprost z `event.cutoff`, czyli z decyzji, którą użytkownik już podjął (albo
 * nie podjął) o CAŁEJ kwestii przed podziałem. To jest osobna naprawa od
 * powyższej, z Rundy 3: geometryczne przeliczanie kontynuacji
 * (`event.endMs > durationMs`, wersja z Rundy 2) po cichu ZAPALAŁO
 * `<cutoff>` na wystającej kwestii, której użytkownik nigdy nie oznaczył —
 * dokładnie ta decyzja za użytkownika, przeciw której cała ta funkcja jest
 * zbudowana (propozycja nigdy nie stosuje się sama). Kwestia wystająca, ale
 * BEZ oznaczonego `cutoff`, zostaje po podziale nadal bez niego — i nadal
 * dostaje własną plakietkę `cutoff` (patrz `dialogueProposals`), żeby
 * użytkownik mógł się na to świadomie zgodzić. Kwestia z JUŻ oznaczonym
 * `cutoff` (kolejność kliknięć „najpierw cutoff, potem scenetrans" — obie
 * plakietki potrafią stać razem, patrz `DialogueTracks.tsx` — zwykła
 * ścieżka, nie naciągany przypadek) przekazuje `true` tej połówce, która
 * faktycznie wystaje.
 *
 * Nowy obiekt trzeba też dopiąć do `body` NASTĘPNEGO ujęcia — nie samym
 * segmentem `{ kind: 'dialogue', eventId }`, jak w pierwszej wersji tej
 * funkcji, tylko razem z segmentem mówcy (`speakerSegmentFor`) i separatorami
 * tekstowymi po obu stronach. Bez segmentu mówcy kontynuacja nie ma żadnej
 * atrybucji głosu w prompcie; bez separatorów `renderSegments`
 * (`shared/src/compile/renderShot.ts`) skleja sąsiednie segmenty bez spacji
 * (łączy je pustym stringiem) — nowa kwestia wylądowałaby zlepiona z tym,
 * co w `body` następnego ujęcia stało PRZED naszym wstawieniem (bo segmenty
 * lądują na POCZĄTKU, patrz niżej) i z tym, co zostało PO nim.
 *
 * Segmenty lądują na POCZĄTKU `body`, nie na końcu: to kontynuacja zdania
 * sprzed cięcia, więc czyta się jako pierwsza rzecz powiedziana w tym
 * ujęciu, zaraz po frazie przejścia w nagłówku (`renderShot`), nie po
 * reszcie jego treści.
 */
function splitAtSceneTrans(project: Project, eventId: string): Project {
  const spans = shotSpans(project.shots, project.video.durationMs)
  const ownerPosition = spans.findIndex(span => span.shot.dialogue.some(candidate => candidate.id === eventId))
  const owner = spans[ownerPosition]
  const next = spans[ownerPosition + 1]
  if (!owner || !next) return project

  const event = owner.shot.dialogue.find(candidate => candidate.id === eventId)
  if (!event) return project

  const cutMs = owner.endMs
  if (!(event.startMs < cutMs && event.endMs > cutMs)) return project
  if (countWords(event.text) < 2) return project

  const { before, after } = splitTextAtFraction(event.text, (cutMs - event.startMs) / (event.endMs - event.startMs))

  const trimmedOriginal: DialogueEvent = {
    ...event,
    text: before,
    endMs: cutMs,
    sceneTransAfter: true,
    continuityPhrase: CONTINUITY_PHRASES[0],
    cutoff: cutMs > project.video.durationMs,
  }
  const continuationId = `dialogue-${nextDialogueNumber(project)}`
  const continuation: DialogueEvent = {
    ...event,
    id: continuationId,
    text: after,
    startMs: cutMs,
    sceneTransBefore: true,
    sceneTransAfter: false,
    continuityPhrase: undefined,
    cutoff: event.cutoff,
  }
  const continuationSegments: Segment[] = [
    speakerSegmentFor(spans, ownerPosition, event),
    { kind: 'text', text: ' ' },
    { kind: 'dialogue', eventId: continuationId },
    { kind: 'text', text: ' ' },
  ]

  const shots = project.shots.map(shot => {
    if (shot.id === owner.shot.id) {
      return {
        ...shot,
        dialogue: shot.dialogue.map(candidate => (candidate.id === eventId ? trimmedOriginal : candidate)),
      }
    }
    if (shot.id === next.shot.id) {
      return {
        ...shot,
        dialogue: [...shot.dialogue, continuation],
        body: [...continuationSegments, ...shot.body],
      }
    }
    return shot
  })

  return { ...project, shots }
}
