/** Dokładna fraza wymagana przez guide dla voiceoveru. */
export const VOICEOVER_PHRASE = 'says in an off-screen voiceover'

/** Dozwolone zdania o ciągłości dźwięku przez cięcie. */
export const CONTINUITY_PHRASES = [
  'continues seamlessly across the cut',
  'continues uninterrupted into the next shot',
  'carries over from the previous shot',
  'remains audible across the transition',
] as const
