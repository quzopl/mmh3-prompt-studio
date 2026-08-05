import type { Project, Shot } from '../model/types.js'
import { segmentAt } from './segment.js'
import type { PatchOp } from './types.js'

/** Placeholder dla pustego pola — pusty ciąg w diffie wygląda jak błąd renderowania. */
const NOT_DESCRIBED = '(nieopisane)'

const describeText = (text: string): string => (text.trim() === '' ? NOT_DESCRIBED : text)

/**
 * Opisuje operację jako parę ciągów do pokazania w diffie „przed / po" w panelu
 * przeglądu (zadanie 11). Dostaje projekt sprzed operacji, więc — inaczej niż
 * przy pierwotnej wersji tej funkcji — strona „przed" pokazuje prawdziwą
 * bieżącą wartość, a nie tylko nazwę pola, które się zmienia.
 */
export function describeOp(project: Project, op: PatchOp): { before: string; after: string } {
  switch (op.kind) {
    case 'replaceShots':
      return describeReplaceShots(project.shots, op.shots)
    case 'setShotText':
      return describeSetShotText(project, op)
    case 'setAudio':
      return { before: describeText(project.audio[op.field]), after: describeText(op.text) }
    case 'setStyle':
      return { before: describeText(project.style), after: describeText(op.text) }
    case 'setSpeakerDescriptor':
      return describeSetSpeakerDescriptor(project, op)
  }
}

/**
 * Sama liczba ujęć po obu stronach myliłaby wtedy, gdy się nie zmienia, choć
 * treść tak (np. wymiana wszystkich kompozycji przy tej samej liczbie ujęć) —
 * czytałoby się to jak brak zmiany. Dlatego strona „po" dodaje, ile ujęć
 * faktycznie się różni od odpowiednika na tej samej pozycji.
 */
function describeReplaceShots(before: Shot[], after: Shot[]): { before: string; after: string } {
  const changed = countChangedShots(before, after)
  return {
    before: `liczba ujęć: ${before.length}`,
    after: `liczba ujęć: ${after.length}, zmienionych: ${changed}`,
  }
}

function countChangedShots(before: Shot[], after: Shot[]): number {
  const length = Math.max(before.length, after.length)
  let changed = 0
  for (let i = 0; i < length; i += 1) {
    if (!shotsEqual(before[i], after[i])) changed += 1
  }
  return changed
}

function shotsEqual(a: Shot | undefined, b: Shot | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Jedyna operacja, która pisze wewnątrz `body` — i jedyna, gdzie cel może nie
 * istnieć, wskazywać poza `body`, albo trafiać w segment innego rodzaju niż
 * tekst. We wszystkich trzech przypadkach `applyOps` odrzuca operację bez
 * śladu, więc diff nie ma prawa udawać zmiany, która się nie zastosuje: obie
 * strony dostają to samo, wprost powiedziane zdanie zamiast wymyślonej
 * treści. Wiadomość różni się między przypadkami — to różne sytuacje
 * do naprawy (zły identyfikator ujęcia vs zły indeks segmentu vs zły rodzaj
 * segmentu) i użytkownik reaguje na nie inaczej.
 */
function describeSetShotText(
  project: Project,
  op: Extract<PatchOp, { kind: 'setShotText' }>,
): { before: string; after: string } {
  const shot = project.shots.find(s => s.id === op.shotId)
  if (shot === undefined) {
    const message = 'operacja się nie zastosuje — nie ma ujęcia o tym identyfikatorze'
    return { before: message, after: message }
  }
  const segment = segmentAt(shot.body, op.segmentIndex)
  if (segment === undefined) {
    const message = 'operacja się nie zastosuje — ujęcie nie ma segmentu pod tym indeksem'
    return { before: message, after: message }
  }
  if (segment.kind !== 'text') {
    const message = `operacja się nie zastosuje — wskazany segment jest typu „${segment.kind}", nie tekstem`
    return { before: message, after: message }
  }
  return { before: describeText(segment.text), after: describeText(op.text) }
}

function describeSetSpeakerDescriptor(
  project: Project,
  op: Extract<PatchOp, { kind: 'setSpeakerDescriptor' }>,
): { before: string; after: string } {
  const speaker = project.speakers.find(s => s.id === op.speakerId)
  if (speaker === undefined) {
    const message = 'operacja się nie zastosuje — nie ma mówcy o tym identyfikatorze'
    return { before: message, after: message }
  }
  return { before: describeText(speaker[op.field]), after: describeText(op.text) }
}
