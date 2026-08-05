import { CONTINUITY_PHRASES, type DialogueEvent, type Project } from '@mmh3/shared'
import { shotSpans } from './spans.js'

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
 */
export function dialogueProposals(project: Project): DialogueProposal[] {
  const spans = shotSpans(project.shots, project.video.durationMs)
  const proposals: DialogueProposal[] = []

  spans.forEach((span, position) => {
    const hasNextShot = position + 1 < spans.length
    for (const event of span.shot.dialogue) {
      const crossesOwnCut = hasNextShot && event.startMs < span.endMs && event.endMs > span.endMs
      if (crossesOwnCut && !event.sceneTransAfter) {
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
 * Punkt podziału tekstu to szacunek proporcjonalny do czasu, nie pomiar —
 * nic w modelu nie wie, ile faktycznie trwa pojedyncze słowo. Przy dwóch i
 * więcej słowach obie strony dostają co najmniej jedno (`clamp` do
 * `[1, words.length - 1]`) — inaczej podział blisko któregoś końca kwestii
 * zostawiłby drugą stronę z pustym tekstem, którego guide (i zwykły sens
 * promptu) nie chce, nawet jeśli sam schemat (`text: z.string()`, bez
 * `min(1)`) pustego stringa nie odrzuca. Kwestia jednosłowna (albo pusta)
 * nie ma jak podzielić się bez pustej strony po jednej z nich — zostaje z
 * tym ograniczeniem świadomie: to skrajny przypadek, edytowalny ręcznie po
 * fakcie, a łamanie samych słów byłoby poza tym, o co prosi to zadanie.
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
 * Nowy obiekt trzeba też dopiąć do `body` NASTĘPNEGO ujęcia jako segment
 * `{ kind: 'dialogue', eventId }`. Bez tego istniałby w `shot.dialogue` (i
 * na osi czasu, która czyta stamtąd wprost), ale kompilator by go nie
 * zobaczył: `renderSegments` idzie po `shot.body`, nie po `shot.dialogue`
 * (`shared/src/compile/renderShot.ts`) — druga połowa kwestii zniknęłaby ze
 * skompilowanego promptu mimo istnienia w modelu. Segment ląduje na
 * POCZĄTKU `body`, nie na końcu: to kontynuacja zdania sprzed cięcia, więc
 * czyta się jako pierwsza rzecz powiedziana w tym ujęciu, zaraz po frazie
 * przejścia w nagłówku (`renderShot`), nie po reszcie jego treści.
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

  const { before, after } = splitTextAtFraction(event.text, (cutMs - event.startMs) / (event.endMs - event.startMs))

  const trimmedOriginal: DialogueEvent = {
    ...event,
    text: before,
    endMs: cutMs,
    sceneTransAfter: true,
    continuityPhrase: CONTINUITY_PHRASES[0],
  }
  const continuation: DialogueEvent = {
    ...event,
    id: `dialogue-${nextDialogueNumber(project)}`,
    text: after,
    startMs: cutMs,
    sceneTransBefore: true,
    sceneTransAfter: false,
    cutoff: false,
    continuityPhrase: undefined,
  }

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
        body: [{ kind: 'dialogue' as const, eventId: continuation.id }, ...shot.body],
      }
    }
    return shot
  })

  return { ...project, shots }
}
