/**
 * Abstrakcyjne określenia nastroju zabronione w non_diegetic_music.
 * Guide wymaga instrumentacji, tempa, rytmu i dynamiki zamiast nazywania emocji.
 * Świadomie NIE zawiera słów opisujących dynamikę (soft, gentle, sparse),
 * bo te są dozwolone.
 */
export const MOOD_WORDS = [
  'melancholic', 'melancholy', 'uplifting', 'tense', 'joyful', 'sad', 'happy',
  'hopeful', 'dramatic', 'epic', 'emotional', 'nostalgic', 'romantic', 'eerie',
  'triumphant', 'somber', 'mysterious', 'haunting', 'whimsical', 'menacing',
  'heartwarming', 'bittersweet', 'ominous', 'euphoric', 'poignant',
] as const

/** Źródła dźwięku słyszalne dla postaci — nie należą do non_diegetic_music. */
export const DIEGETIC_SOURCES = [
  'radio', 'television', 'tv set', 'phone speaker', 'loudspeaker',
  'jukebox', 'record player', 'someone sings', 'she sings', 'he sings',
] as const
