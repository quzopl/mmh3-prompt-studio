import { MS_PER_FRAME, snapToFrame } from '@mmh3/shared'
import { msToPx, snapMs, type Scale } from './scale.js'

export interface TimeClip {
  id: string
  startMs: number
  endMs: number
}

export type ClipGrip = 'move' | 'start' | 'end'

/** Najwęższy klip, jaki da się jeszcze chwycić myszą. */
export const MIN_CLIP_PX = 8

/**
 * Indeks klatki najbliższej danemu czasowi i odwrotność — te same wzory co w
 * `useDragBoundary.ts`. Liczymy na indeksach klatek, nie na milisekundach,
 * bo `startMs + MIN_CLIP_MS` wygląda prościej, ale `MIN_CLIP_MS` to
 * zaokrąglone dwie klatki (83 ms, nie dokładne 83,333…), więc dodane do
 * czasu spoza klatki zerowej zdejmuje wynik z siatki.
 */
const frameIndexOf = (ms: number): number => Math.round(ms / MS_PER_FRAME)
const msOfFrameIndex = (frame: number): number => Math.round(frame * MS_PER_FRAME)

/** Najkrótszy klip w klatkach — poniżej dwóch klatek krawędzie zlewają się po przyciągnięciu. */
const MIN_CLIP_FRAMES = 2

export const MIN_CLIP_MS = msOfFrameIndex(MIN_CLIP_FRAMES)

/**
 * Prostokąt klipu przycięty do widocznego obszaru. Klip wykraczający poza
 * materiał jest błędem, który walidator zgłasza — ale narysowany poza ekranem
 * byłby nie do chwycenia, więc jedyny klip wymagający naprawy byłby jedynym
 * nieosiągalnym. Przypinamy go do krawędzi zamiast gubić.
 */
export function clipBox(scale: Scale, clip: TimeClip): { left: number; width: number } {
  const edge = msToPx(scale, scale.durationMs)
  const left = Math.min(msToPx(scale, clip.startMs), edge - MIN_CLIP_PX)
  const right = Math.min(msToPx(scale, clip.endMs), edge)
  return { left: Math.max(0, left), width: Math.max(MIN_CLIP_PX, right - left) }
}

export interface ClipTargetArgs {
  grip: ClipGrip
  clip: TimeClip
  /** Czas pod kursorem. */
  desiredMs: number
  /** Odległość od początku klipu do punktu chwycenia — tylko dla `move`. */
  grabOffsetMs: number
  lowestMs: number
  highestMs: number
  snapPoints: number[]
  toleranceMs: number
}

/**
 * Nowe czasy klipu. Kolejność jak przy granicy ujęcia: najpierw przyciąganie do
 * punktów, potem do klatki, na końcu ograniczenia — postawione na końcu nie da
 * się ich obejść żadnym przyciąganiem.
 *
 * Ograniczenia potrafią się skrzyżować: klip może być dłuższy niż dostępny
 * zakres (`move`), albo krótszy niż dwie klatki, przez co jego własny koniec
 * pomniejszony o `MIN_CLIP_FRAMES` wypada poniżej dolnej granicy (`start`).
 * Tak jak w `boundaryTargetMs`, rozstrzyga to zawsze dolne ograniczenie —
 * `Math.max(lowest, Math.min(x, highest))`, nie odwrotnie. Odwrotna kolejność
 * (`Math.min(Math.max(x, lowest), highest)`) przy skrzyżowaniu oddaje wartość
 * z górnego ograniczenia, które w tej sytuacji leży poniżej dolnego —
 * potrafi więc wyjść ujemna, a `ShotSchema` odrzuca ujemny czas i każdy
 * kolejny autozapis wraca z kodem 400. Gałąź `end` ma odwrotną parę
 * ograniczeń (górne z przyciągania, dolne z sąsiedztwa), więc tam ten sam
 * wzorzec — dolne na zewnątrz — wygląda jak `Math.max(Math.min(x, highest),
 * lowerBound)`.
 */
export function clipTargetMs(args: ClipTargetArgs): { startMs: number; endMs: number } {
  const lowest = frameIndexOf(args.lowestMs)
  const highest = frameIndexOf(args.highestMs)
  const snapped = frameIndexOf(snapToFrame(snapMs(args.desiredMs, args.snapPoints, args.toleranceMs)))

  if (args.grip === 'move') {
    const lengthFrames = frameIndexOf(args.clip.endMs) - frameIndexOf(args.clip.startMs)
    const wanted = snapped - frameIndexOf(args.grabOffsetMs)
    const start = Math.max(lowest, Math.min(wanted, highest - lengthFrames))
    return { startMs: msOfFrameIndex(start), endMs: msOfFrameIndex(start + lengthFrames) }
  }

  if (args.grip === 'start') {
    const endFrame = frameIndexOf(args.clip.endMs)
    const start = Math.max(lowest, Math.min(snapped, endFrame - MIN_CLIP_FRAMES))
    return { startMs: msOfFrameIndex(start), endMs: msOfFrameIndex(endFrame) }
  }

  const startFrame = frameIndexOf(args.clip.startMs)
  const end = Math.max(Math.min(snapped, highest), startFrame + MIN_CLIP_FRAMES)
  return { startMs: msOfFrameIndex(startFrame), endMs: msOfFrameIndex(end) }
}
