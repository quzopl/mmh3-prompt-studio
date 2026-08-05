import type { PatchOp } from './types.js'

/**
 * Opisuje operację jako parę ciągów do pokazania w diffie „przed / po".
 *
 * `PatchOp` niesie tylko nową wartość — żadny wariant nie pamięta, co
 * zastępuje — a `describeOp` dostaje samą operację, bez projektu, do którego
 * miałaby się przyłożyć. Prawdziwej poprzedniej wartości więc nie zna i jej
 * nie zgaduje: strona „przed" jest opisowa (nazywa pole, które się zmienia),
 * a konkretną nową treść pokazuje wyłącznie strona „po".
 *
 * Dla `replaceShots` prawdziwej liczby ujęć sprzed operacji z tego samego
 * powodu nie da się poznać — z tego samego powodu strona „przed" zostaje
 * opisowa, a nie liczbowa. Pokazanie liczby po obu stronach byłoby zresztą
 * mylące akurat wtedy, gdy liczba ujęć się nie zmienia, a treść tak
 * (np. wymiana wszystkich kompozycji na nowe przy tej samej liczbie ujęć)
 * — czytałoby się to jak brak zmiany, mimo że operacja zamienia całą oś.
 */
export function describeOp(op: PatchOp): { before: string; after: string } {
  switch (op.kind) {
    case 'replaceShots':
      return { before: 'obecna lista ujęć', after: `${op.shots.length} ujęć` }
    case 'setShotText':
      return { before: 'obecny tekst segmentu', after: op.text }
    case 'setAudio':
      return { before: `obecne pole „${op.field}”`, after: op.text }
    case 'setStyle':
      return { before: 'obecny styl', after: op.text }
    case 'setSpeakerDescriptor':
      return { before: `obecny „${op.field}” mówcy ${op.speakerId}`, after: op.text }
  }
}
