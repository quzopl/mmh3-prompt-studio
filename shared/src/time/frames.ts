import { FPS } from '../model/types.js'

export const MS_PER_FRAME = 1000 / FPS

/** Przyciąga czas do najbliższej granicy klatki przy 24 fps. */
export function snapToFrame(ms: number): number {
  return Math.round(Math.round(ms / MS_PER_FRAME) * MS_PER_FRAME)
}

export function isFrameAligned(ms: number): boolean {
  return snapToFrame(ms) === ms
}
