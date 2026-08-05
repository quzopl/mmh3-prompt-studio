import { MS_PER_FRAME } from '@mmh3/shared'

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 64

/**
 * Poniżej tej gęstości znaczniki klatek zlewają się w szarą plamę. Przy zoomie 1
 * i ośmiu sekundach odstęp klatki wynosi 4,17 px, więc próg musi być wyższy —
 * inaczej pierwszy poziom przybliżenia od razu rysowałby dwieście kresek.
 */
const MIN_FRAME_GAP_PX = 6

export interface Scale {
  durationMs: number
  widthPx: number
  zoom: number
  pxPerMs: number
}

export const clampZoom = (zoom: number): number =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

export function createScale(durationMs: number, widthPx: number, zoom: number): Scale {
  const safeZoom = clampZoom(zoom)
  const pxPerMs = durationMs > 0 ? (widthPx * safeZoom) / durationMs : 0
  return { durationMs, widthPx, zoom: safeZoom, pxPerMs }
}

export const msToPx = (scale: Scale, ms: number): number => ms * scale.pxPerMs

export function pxToMs(scale: Scale, px: number): number {
  if (scale.pxPerMs === 0) return 0
  const ms = px / scale.pxPerMs
  return Math.min(scale.durationMs, Math.max(0, ms))
}

/**
 * Poniżej tego odstępu etykiety sekund zaczynają na siebie nachodzić. Etykieta
 * ma trzy znaki („15s") w foncie 10 px, czyli około 18 px, plus 4 px odsunięcia
 * od kreski.
 */
const MIN_SECOND_GAP_PX = 24

/** Kroki rzedzenia w sekundach. Stały krok czyta się lepiej niż nierówne odstępy. */
const SECOND_STEPS = [1, 2, 5, 10]

export function secondTicks(scale: Scale): number[] {
  const step = SECOND_STEPS.find(seconds => msToPx(scale, seconds * 1000) >= MIN_SECOND_GAP_PX)
    ?? SECOND_STEPS[SECOND_STEPS.length - 1]
    ?? 1

  const ticks: number[] = []
  for (let ms = 0; ms <= scale.durationMs; ms += step * 1000) ticks.push(ms)
  const last = ticks[ticks.length - 1]
  if (last !== undefined && last !== scale.durationMs) ticks.push(scale.durationMs)
  return ticks
}

export function frameTicks(scale: Scale): number[] {
  if (msToPx(scale, MS_PER_FRAME) < MIN_FRAME_GAP_PX) return []
  const ticks: number[] = []
  for (let frame = 0; frame * MS_PER_FRAME <= scale.durationMs; frame += 1) {
    ticks.push(Math.round(frame * MS_PER_FRAME))
  }
  return ticks
}

/** Przyciąga do najbliższego punktu, o ile mieści się w tolerancji. */
export function snapMs(ms: number, points: number[], toleranceMs: number): number {
  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const point of points) {
    const distance = Math.abs(point - ms)
    if (distance > toleranceMs || distance >= bestDistance) continue
    best = point
    bestDistance = distance
  }
  return best ?? ms
}
