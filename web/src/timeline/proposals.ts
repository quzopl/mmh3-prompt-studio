import { CONTINUITY_PHRASES, type DialogueEvent, type Project, type Segment } from '@mmh3/shared'
import { shotSpans } from './spans.js'
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
 * Segment mówcy dla nowej połówki kwestii — TEN SAM kształt (`speakerIds`,
 * `descriptor`, `form`) co segment mówcy, który w `body` WŁASNEGO ujęcia
 * oryginału wprowadza jego segment dialogowy. Bez własnego segmentu mówcy
 * kontynuacja wylądowałaby w skompilowanym prompcie jako blok `<d>` bez
 * żadnej atrybucji do postaci — żadna reguła walidatora tego nie łapie (nic
 * nie sprawdza, czy segment dialogowy ma poprzedzający go segment mówcy),
 * więc błąd eksportowałby się po cichu.
 *
 * Szuka WSTECZ od segmentu dialogowego, przechodząc przez segmenty tekstowe
 * (`kind: 'text'`) — nie tylko sprawdza jeden poprzedni element. Prawdziwa
 * proza rzadko stawia segment mówcy TUŻ przed segmentem dialogowym: golden
 * fixture (`shared/test/golden/fixtures/base.ts`) ma między nimi opisowy
 * tekst („places a fresh loaf on the wooden counter and "), a nawet goły
 * separator to osobny segment tekstowy (jedna spacja). Napotkanie segmentu
 * innego rodzaju (kamera, etykieta, inny dialog) przerywa szukanie — to
 * oznacza, że wyszliśmy poza wprowadzenie TEJ kwestii.
 *
 * Gdy oryginał nie ma w ogóle takiego segmentu (np. `body` jeszcze nie
 * zredagowane ręcznie) — domyślny kształt to `'short'`: to kontynuacja
 * kwestii już w toku, nie jej pierwsze wystąpienie, które wymagałoby
 * `'full'` albo opisu (patrz reguła `SPEAKER_FIRST_INTRO`).
 */
function speakerSegmentLike(ownerBody: Segment[], eventId: string, event: DialogueEvent): Segment {
  const dialogueIndex = ownerBody.findIndex(seg => seg.kind === 'dialogue' && seg.eventId === eventId)
  for (let i = dialogueIndex - 1; i >= 0; i -= 1) {
    const candidate = ownerBody[i]
    if (candidate?.kind === 'speaker') return { ...candidate }
    if (candidate?.kind !== 'text') break
  }
  return { kind: 'speaker', speakerIds: event.speakerIds, form: 'short' }
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
 * `cutoff` liczy się NIEZALEŻNIE dla każdej połówki z jej WŁASNEGO nowego
 * `endMs` względem `durationMs` — nie kopiuje się ze `...event`. Bez tego
 * (odrzucona wersja z Rundy 2) oryginał, spreadowany z `...event`, zostawał
 * z `cutoff: true` mimo że jego nowy koniec (granica cięcia) leży w środku
 * materiału, a nowa połówka dostawała na sztywno `cutoff: false` mimo że to
 * WŁAŚNIE ona dziedziczy przekraczający koniec oryginału. Kolejność kliknięć
 * „najpierw `cutoff`, potem `scenetrans`" na tym samym klipie (obie
 * plakietki potrafią stać razem, patrz `DialogueTracks.tsx`) jest zwykłą
 * ścieżką, nie naciąganym przypadkiem — i bez tej naprawy zostawiała
 * `CUTOFF_AT_END` włączone na obu połówkach zamiast na żadnej.
 *
 * Nowy obiekt trzeba też dopiąć do `body` NASTĘPNEGO ujęcia — nie samym
 * segmentem `{ kind: 'dialogue', eventId }`, jak w pierwszej wersji tej
 * funkcji, tylko razem z segmentem mówcy (`speakerSegmentLike`) i separatorami
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
    cutoff: event.endMs > project.video.durationMs,
  }
  const continuationSegments: Segment[] = [
    speakerSegmentLike(owner.shot.body, eventId, event),
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
