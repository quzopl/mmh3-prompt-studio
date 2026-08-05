import type { Project, Shot } from '../model/types.js'
import { segmentAt } from './segment.js'
import type { PatchOp } from './types.js'

/**
 * Wartość jednej kolumny diffu ("przed" albo "po"). Struktura, NIE gotowe
 * zdanie po polsku — ekran przeglądu (`web/src/llm/PatchReview.tsx`) jest
 * JEDYNYM konsumentem tego typu w całej aplikacji i to on renderuje go przez
 * `useT`, więc to on ma zdecydować, w jakim języku i jakimi słowami to
 * pokazać. `shared/` nie ma i nie ma mieć zależności od `i18n/` — stąd
 * struktura zamiast gotowego stringa (fix round 1/5, zadanie 11, punkt 5:
 * `describeOp` wcześniej zwracał surowe polskie zdania, więc interfejs
 * angielski i tak pokazywał polski tekst).
 */
export type DescribedValue =
  | { kind: 'text'; text: string }
  | { kind: 'empty' }
  /** Wyłącznie strona „przed" dla `replaceShots` — sama liczba ujęć, bo cała
   * ich treść w diffie tekstowym byłaby nieczytelna (brief zadania 4). */
  | { kind: 'shotCount'; count: number }
  /**
   * Wyłącznie strona „po" dla `replaceShots`. Liczone po IDENTYFIKATORZE
   * ujęcia, nie po pozycji w tablicy (fix round 1/5, zadanie 11, punkt 6):
   * poprzednia wersja porównywała `before[i]` z `after[i]` pozycyjnie, więc
   * dodanie JEDNEGO ujęcia przesuwało wszystkie kolejne pozycje i pokazywało
   * je jako „zmienione" — w tym ujęcie, które użytkownik sam dopisał PO
   * wygenerowaniu łatki, a które `replaceShots` i tak nadpisze, bo nie ma go
   * w `op.shots`. Diff po id nazywa to wprost: ujęcie, którego id nie ma w
   * „przed", jest DODANE; ujęcie, którego id zniknęło z „po", jest USUNIĘTE;
   * ujęcie o tym samym id z inną treścią jest ZMIENIONE. Recenzent
   * skonstruował dokładnie ten scenariusz („user dodaje ujęcie, wiersz mówi
   * 2 → 1, zmienionych: 2, użytkownik zatwierdza, jego nowe ujęcie znika") —
   * z tym podsumowaniem ten sam scenariusz pokazuje `removed: 1` wprost.
   */
  | { kind: 'shotSummary'; added: number; removed: number; altered: number }

/**
 * Powód, dla którego operacja się NIE zastosuje — cel nie istnieje (ujęcie,
 * mówca, etykieta, wpis retencji) albo, dla `setShotText`, istnieje, ale
 * wskazany indeks jest poza `body` albo trafia w segment złego rodzaju.
 * Każdy wariant ma własny klucz tłumaczenia po stronie ekranu przeglądu —
 * `shared/` nie skleja tu gotowego zdania z tego samego powodu co przy
 * `DescribedValue`.
 */
export type InapplicableReason =
  | { kind: 'missingShot' }
  | { kind: 'missingSegment' }
  | { kind: 'wrongSegmentKind'; segmentKind: string }
  | { kind: 'missingSpeaker' }
  | { kind: 'missingLabel' }
  | { kind: 'missingRetentionEntry' }

/**
 * Opis operacji do pokazania w wierszu przeglądu. Dwuwariantowy dyskryminator
 * (`status`), NIE dwa identyczne komunikaty wciśnięte w `before`/`after` —
 * poprzednia wersja pisała ten sam string po obu stronach dla operacji bez
 * celu, co w interfejsie wyglądało jak usterka renderowania (dwa identyczne
 * wiersze), nie jak ostrzeżenie (fix round 1/5, zadanie 11, punkt 7).
 */
export type OpDescription =
  | { status: 'applicable'; before: DescribedValue; after: DescribedValue }
  | { status: 'inapplicable'; reason: InapplicableReason }

const textValue = (text: string): DescribedValue => (text.trim() === '' ? { kind: 'empty' } : { kind: 'text', text })

const applicableText = (before: string, after: string): OpDescription =>
  ({ status: 'applicable', before: textValue(before), after: textValue(after) })

/**
 * Opisuje operację jako parę wartości do pokazania w diffie „przed / po" w
 * panelu przeglądu (zadanie 11). Dostaje projekt sprzed operacji, więc strona
 * „przed" pokazuje prawdziwą bieżącą wartość, nie tylko nazwę pola, które się
 * zmienia.
 */
export function describeOp(project: Project, op: PatchOp): OpDescription {
  switch (op.kind) {
    case 'replaceShots':
      return {
        status: 'applicable',
        before: { kind: 'shotCount', count: project.shots.length },
        after: { kind: 'shotSummary', ...summarizeShotChanges(project.shots, op.shots) },
      }
    case 'setShotText':
      return describeSetShotText(project, op)
    case 'setAudio':
      return applicableText(project.audio[op.field], op.text)
    case 'setStyle':
      return applicableText(project.style, op.text)
    case 'setSpeakerDescriptor':
      return describeSetSpeakerDescriptor(project, op)
    case 'setLabelField':
      return describeSetLabelField(project, op)
    case 'setRetentionText':
      return describeSetRetentionText(project, op)
  }
}

function summarizeShotChanges(before: Shot[], after: Shot[]): { added: number; removed: number; altered: number } {
  const beforeById = new Map(before.map(shot => [shot.id, shot]))
  let added = 0
  let altered = 0
  for (const shot of after) {
    const previous = beforeById.get(shot.id)
    if (previous === undefined) added += 1
    else if (JSON.stringify(previous) !== JSON.stringify(shot)) altered += 1
  }
  const afterIds = new Set(after.map(shot => shot.id))
  const removed = before.filter(shot => !afterIds.has(shot.id)).length
  return { added, removed, altered }
}

/**
 * Jedyna operacja, która pisze wewnątrz `body` — i jedyna, gdzie cel może nie
 * istnieć, wskazywać poza `body`, albo trafiać w segment innego rodzaju niż
 * tekst. We wszystkich trzech przypadkach `applyOps` odrzuca operację bez
 * śladu, więc diff nie ma prawa udawać zmiany, która się nie zastosuje.
 */
function describeSetShotText(
  project: Project,
  op: Extract<PatchOp, { kind: 'setShotText' }>,
): OpDescription {
  const shot = project.shots.find(s => s.id === op.shotId)
  if (shot === undefined) return { status: 'inapplicable', reason: { kind: 'missingShot' } }
  const segment = segmentAt(shot.body, op.segmentIndex)
  if (segment === undefined) return { status: 'inapplicable', reason: { kind: 'missingSegment' } }
  if (segment.kind !== 'text') {
    return { status: 'inapplicable', reason: { kind: 'wrongSegmentKind', segmentKind: segment.kind } }
  }
  return applicableText(segment.text, op.text)
}

function describeSetSpeakerDescriptor(
  project: Project,
  op: Extract<PatchOp, { kind: 'setSpeakerDescriptor' }>,
): OpDescription {
  const speaker = project.speakers.find(s => s.id === op.speakerId)
  if (speaker === undefined) return { status: 'inapplicable', reason: { kind: 'missingSpeaker' } }
  return applicableText(speaker[op.field], op.text)
}

function describeSetLabelField(
  project: Project,
  op: Extract<PatchOp, { kind: 'setLabelField' }>,
): OpDescription {
  const label = project.labels.find(l => l.id === op.labelId)
  if (label === undefined) return { status: 'inapplicable', reason: { kind: 'missingLabel' } }
  return applicableText(label[op.field], op.text)
}

function describeSetRetentionText(
  project: Project,
  op: Extract<PatchOp, { kind: 'setRetentionText' }>,
): OpDescription {
  // `scope` w osobnej stałej — zawężenie na zagnieżdżonym `op.scope.kind` nie
  // przechodzi do domknięcia `find` niżej (ten sam powód co w `apply.ts`).
  const scope = op.scope
  if (scope.kind === 'summary') return applicableText(project.ref.summaryText, op.text)
  const entry = project.ref.retention.find(e => e.id === scope.entryId)
  if (entry === undefined) return { status: 'inapplicable', reason: { kind: 'missingRetentionEntry' } }
  return applicableText(entry.note, op.text)
}
