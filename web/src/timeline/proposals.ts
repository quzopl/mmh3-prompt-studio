import type { Project } from '@mmh3/shared'
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
 * Kwestia mogąca przechodzić przez WIĘCEJ niż jedno cięcie (dwa ujęcia w
 * środku jej zakresu) dostaje mimo to tylko JEDNĄ propozycję `scenetrans` —
 * `some()` niżej pyta tylko, czy jakiekolwiek cięcie leży w środku, nie ile.
 * To zgodne z modelem: `DialogueEvent` niesie dokładnie dwie flagi,
 * `sceneTransBefore` i `sceneTransAfter`, a nie znacznik na cięcie — nie ma
 * w schemacie miejsca na osobny znacznik dla każdego przecięcia, więc druga
 * propozycja tego samego rodzaju byłaby fikcją bez odpowiednika w modelu.
 */
export function dialogueProposals(project: Project): DialogueProposal[] {
  const spans = shotSpans(project.shots, project.video.durationMs)
  const cuts = spans.map(span => span.startMs).filter(ms => ms > 0)
  const proposals: DialogueProposal[] = []

  for (const span of spans) {
    for (const event of span.shot.dialogue) {
      const crossesCut = cuts.some(cut => event.startMs < cut && event.endMs > cut)
      if (crossesCut && !(event.sceneTransBefore && event.sceneTransAfter)) {
        proposals.push({ eventId: event.id, kind: 'scenetrans' })
      }
      if (event.endMs > project.video.durationMs && !event.cutoff) {
        proposals.push({ eventId: event.id, kind: 'cutoff' })
      }
    }
  }
  return proposals
}

/** Nie zmienia niczego poza jednym znacznikiem jednej kwestii. */
export function applyProposal(project: Project, proposal: DialogueProposal): Project {
  let touched = false
  const shots = project.shots.map(shot => ({
    ...shot,
    dialogue: shot.dialogue.map(event => {
      if (event.id !== proposal.eventId) return event
      touched = true
      return proposal.kind === 'scenetrans'
        ? { ...event, sceneTransBefore: true, sceneTransAfter: true }
        : { ...event, cutoff: true }
    }),
  }))
  return touched ? { ...project, shots } : project
}
