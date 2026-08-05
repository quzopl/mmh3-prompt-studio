import type { Speaker } from '@mmh3/shared'

/**
 * Minimalny, ale WAŻNY względem `SpeakerSchema` mówca — wszystkie pola
 * opisowe puste, bo interfejs nie ma prawa zgadywać wieku, barwy ani akcentu
 * za użytkownika (`describeSpeaker` uzupełni je dopiero z jego danych).
 *
 * Numer kodu z MAKSIMUM już zajętych, nie z liczby mówców — ten sam idiom co
 * `nextId` (`web/src/timeline/ids.ts`) i `nextShotNumber`
 * (`web/src/timeline/shotOperations.ts`): licząc po `speakers.length` wystarczy
 * usunąć mówcę, żeby kolejny dostał kod żywego, a `SPEAKER_ID_STABLE`
 * (`shared/src/validate/rules/speech.ts`) zgłasza wtedy błąd, którego
 * użytkownik nie popełnił.
 *
 * Jedna implementacja dla obu miejsc, które umieją stworzyć mówcę: przycisku
 * „Dodaj mówcę" w `AssetBin.tsx` i przycisku „+" pasa dialogów
 * (`createOnTrack.addDialogue`, gdy projekt nie ma jeszcze żadnego mówcy).
 * Druga kopia rozjechałaby się z pierwszą przy pierwszym nowym polu w
 * `SpeakerSchema` — a rozjazd oznaczałby mówcę odrzucanego przez schemat,
 * czyli zablokowany autozapis (patrz komentarz przy `expectParses` w
 * `web/test/timeline/createOnTrack.test.ts`).
 *
 * Świeżo utworzony mówca nie zapala żadnej reguły, o ile dostaje kwestię w
 * tym samym geście: `SPEAKER_SILENT_NO_ID` patrzy na obecność kwestii (nie na
 * treść opisu), a `SPEAKER_FIRST_INTRO` na FORMĘ segmentu w `body`
 * (`'full'` przechodzi niezależnie od tego, czy `fullDescriptor` jest pusty).
 * Pusty opis daje ubogi prompt — to widać w podglądzie — ale nie diagnostykę.
 */
export function newSpeaker(existing: Speaker[]): Speaker {
  const nextNumber = Math.max(0, ...existing
    .map(speaker => Number(speaker.code.slice(1)))
    .filter(Number.isFinite)) + 1
  const code = `S${nextNumber}`
  return {
    id: `speaker-${code}`,
    code,
    characterType: '', age: '', gender: '', pitch: '', timbre: '', rate: '', accent: '',
    onScreen: true, fullDescriptor: '', shortDescriptor: '',
  }
}
