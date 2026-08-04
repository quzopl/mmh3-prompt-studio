import type { CutType } from '../model/types.js'

/**
 * Frazy przejść innych niż zwykłe cięcie. Guide dopuszcza cross-dissolve,
 * fade i wipe na wyraźne życzenie, ale nie dyktuje ich brzmienia — poniższe
 * sformułowania są konwencją aplikacji, spójną ze stylem fraz cięcia z §4.2.
 */
export const TRANSITION_PHRASES: Record<Exclude<CutType, 'cut'>, string> = {
  'cross-dissolve': 'the shot cross-dissolves to',
  fade: 'the shot fades to',
  wipe: 'the shot wipes to',
}
