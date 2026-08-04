import type { DialogueEvent } from '../model/types.js'
import { VOICEOVER_PHRASE } from '../vocab/continuity.js'

/**
 * Blok dialogowy. Treść wewnątrz <d> jest verbatim i nigdy nie jest modyfikowana.
 * Umiejscowienie <scenetrans> i <cutoff> to konwencja aplikacji — guide podaje
 * wymóg ich użycia, ale nie precyzuje pozycji w zdaniu.
 */
export function renderDialogue(event: DialogueEvent): string {
  const head = event.voiceover ? VOICEOVER_PHRASE : event.verb
  const parts: string[] = []
  if (event.sceneTransBefore) parts.push('<scenetrans>')
  parts.push(`${head}${event.punctuation} <d>[${event.language}] ${event.text}</d>`)
  if (event.voiceover && event.lipsClause) parts.push(event.lipsClause)
  if (event.cutoff) parts.push('<cutoff>')
  if (event.sceneTransAfter) parts.push('<scenetrans>')
  if (event.continuityPhrase) parts.push(event.continuityPhrase)
  return parts.join(' ')
}
