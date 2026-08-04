import type { Speaker } from '../model/types.js'

/**
 * Buduje opis tożsamości głosu z pól strukturalnych mówcy.
 *
 * Guide (§4.4) wymaga, żeby przy pierwszym wystąpieniu mówcy ustalić typ
 * postaci, wiek, płeć, obecność w kadrze oraz wysokość, barwę, tempo i akcent.
 * Te dane żyją w rekordzie mówcy, ale do promptu trafiają `fullDescriptor`
 * i `shortDescriptor`. Ta funkcja jest mostem między jednym a drugim:
 * edytor generuje nią opis, a użytkownik może go potem nadpisać ręcznie.
 * Kompilator nadal czyta wyłącznie gotowe pola opisowe, więc wygenerowany
 * tekst nigdy nie wchodzi do promptu bez wiedzy użytkownika.
 */
export function describeSpeaker(speaker: Speaker): { full: string; short: string } {
  const subject = [speaker.age, speaker.characterType]
    .map(part => part.trim())
    .filter(Boolean)
    .join(' ')

  if (!subject) return { full: '', short: '' }

  const voiceQualities = [speaker.rate, speaker.timbre]
    .map(part => part.trim())
    .filter(Boolean)
    .join(', ')

  const full = voiceQualities
    ? `the ${subject} with a ${voiceQualities} voice`
    : `the ${subject}`

  const short = speaker.characterType.trim()
    ? `the ${speaker.characterType.trim()}`
    : `the ${subject}`

  return { full, short }
}
