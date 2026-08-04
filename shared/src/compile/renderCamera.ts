import type { CameraMove } from '../model/types.js'
import { cameraVerb } from '../vocab/camera.js'

/**
 * Fraza ruchu kamery jako naturalne zdanie angielskie.
 * Guide wymaga wplecenia ruchu w prozę, nie doklejania etykiet na końcu.
 */
export function renderCameraMove(move: CameraMove): string {
  if (move.customPhrase) return move.customPhrase
  const parts = ['The camera', cameraVerb(move.type)]
  if (move.amplitude) parts.push(`with ${move.amplitude} amplitude`)
  if (move.speed) parts.push(`at ${move.speed} speed`)
  if (move.target) parts.push(move.target)
  return parts.join(' ')
}
