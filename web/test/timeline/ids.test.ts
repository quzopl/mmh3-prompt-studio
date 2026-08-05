import { describe, expect, it } from 'vitest'
import type { Project } from '@mmh3/shared'
import { DIALOGUE_ID_PREFIX, nextId } from '../../src/timeline/ids.js'
import { addDialogue } from '../../src/timeline/createOnTrack.js'
import { applyProposal } from '../../src/timeline/proposals.js'
import { baseProject, emptyShot, line, speaker } from './fixtures.js'

describe('nextId', () => {
  it('liczy z MAKSIMUM istniejących numerów, nie z ich liczby', () => {
    // Po usunięciu `move-2` zostaje jeden ruch, ale numer 3 jest już zajęty —
    // numerowanie po liczbie wpisów oddałoby `move-2`, czyli identyfikator,
    // który już raz żył, a numerowanie po maksimum oddaje `move-4`.
    expect(nextId('move', ['move-1', 'move-3'])).toBe('move-4')
  })

  it('pusta lista zaczyna od jedynki', () => {
    expect(nextId('move', [])).toBe('move-1')
  })

  /**
   * Wzorzec musi używać PODWÓJNEGO backslasha: w template literalu JS `\d` nie
   * jest metaznakiem cyfry, tylko degraduje się do litery `d` (`` `\d` === 'd'
   * ``). Z pojedynczym `\d` `pattern` dopasowywałby wyłącznie literalne
   * „move-d", nigdy istniejące id — `highest` zostawałby na zerze i KAŻDE
   * wywołanie oddawałoby ten sam identyfikator. Ta asercja łapie to wprost,
   * a nie okrężnie przez „dwa obiekty mają różne id".
   */
  it('rozpoznaje cyfry w istniejących identyfikatorach, a nie literę „d"', () => {
    expect(nextId('move', ['move-7'])).toBe('move-8')
    expect(nextId('move', ['move-d'])).toBe('move-1')
  })

  it('nie liczy identyfikatorów z innym prefiksem ani z ogonem po numerze', () => {
    expect(nextId('move', ['text-9', 'move-2-kopia', 'ruch-5'])).toBe('move-1')
  })
})

/**
 * Runda 2 recenzji końcowej. Scalenie dwóch liczników w jeden (`nextId` +
 * `DIALOGUE_ID_PREFIX` zamiast `nextId('line', …)` w `createOnTrack.ts` i
 * osobnego `nextDialogueNumber` w `proposals.ts`) nie dawało się zaczerwienić
 * przez kolizję — obie stare funkcje czytały cały projekt i każda oddawała
 * wartość większą od każdego zajętego numeru, więc przy RÓŻNYCH prefiksach
 * (`line-N` kontra `dialogue-N`) kolizja była nieosiągalna.
 *
 * Ale scalenie ma skutek, który zaczerwienić się DAJE i który jest nieprawdą o
 * kodzie sprzed poprawki: obie drogi tworzenia kwestii biją dziś w JEDNEJ
 * rodzinie identyfikatorów. To właśnie ta własność sprawia, że dwa liczniki
 * przestałyby być niegroźne — i to ona ma być przypięta, a nie jej skutek
 * uboczny.
 */
describe('rodzina identyfikatorów kwestii dialogowych', () => {
  const crossingLine = (): Project => ({
    ...baseProject([
      {
        ...emptyShot('a', 0, 0),
        dialogue: [line('d1', ['s1'], 'przechodzi przez ciecie', 3000, 5000)],
        body: [
          { kind: 'speaker', speakerIds: ['s1'], form: 'full' },
          { kind: 'text', text: ' ' },
          { kind: 'dialogue', eventId: 'd1' },
        ],
      },
      emptyShot('b', 1, 4000),
    ]),
    speakers: [speaker('s1', 'S1')],
  })

  const dialogueIds = (project: Project): string[] =>
    project.shots.flatMap(shot => shot.dialogue).map(event => event.id)

  it('przycisk „+" bije w rodzinie `line-N`', () => {
    const added = addDialogue(crossingLine(), 1000, 's1')
    const created = dialogueIds(added).filter(id => id !== 'd1')
    expect(created).toEqual([`${DIALOGUE_ID_PREFIX}-1`])
  })

  it('podział na <scenetrans> bije w TEJ SAMEJ rodzinie, nie we własnej', () => {
    const split = applyProposal(crossingLine(), { eventId: 'd1', kind: 'scenetrans' })
    const created = dialogueIds(split).filter(id => id !== 'd1')
    expect(created).toEqual([`${DIALOGUE_ID_PREFIX}-1`])
  })

  it('obie drogi razem dają jeden ciąg numerów bez powtórzeń i bez dziur', () => {
    const split = applyProposal(crossingLine(), { eventId: 'd1', kind: 'scenetrans' })
    const added = addDialogue(split, 1000, 's1')
    // Posortowane: kolejność wynika z tego, do KTÓREGO ujęcia trafił każdy z
    // obiektów (kontynuacja do 'b', nowa kwestia do 'a'), a pytanie brzmi o
    // numerację, nie o miejsce w projekcie.
    const created = dialogueIds(added).filter(id => id !== 'd1').sort()
    expect(created).toEqual([`${DIALOGUE_ID_PREFIX}-1`, `${DIALOGUE_ID_PREFIX}-2`])
  })
})
