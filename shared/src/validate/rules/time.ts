import { MAX_DURATION_MS, MIN_DURATION_MS } from '../../model/types.js'
import { isFrameAligned } from '../../time/frames.js'
import { defineRule, makeDiagnostic, type Rule } from '../types.js'

const durationRange = defineRule({
  id: 'DURATION_RANGE',
  severity: 'error',
  guideRef: 'karta modelu MiniMax-H3 — długość 4–15 s',
  run: ({ project }) => {
    const { durationMs } = project.video
    if (durationMs >= MIN_DURATION_MS && durationMs <= MAX_DURATION_MS) return []
    return [makeDiagnostic(
      durationRange,
      { kind: 'project', id: project.id },
      `Długość wideo ${durationMs} ms jest poza zakresem 4000–15000 ms.`,
      `Video duration ${durationMs} ms is outside the 4000–15000 ms range.`,
    )]
  },
})

const shot1NoTimestamp = defineRule({
  id: 'SHOT1_NO_TIMESTAMP',
  severity: 'error',
  guideRef: 'guide_base §4.2',
  run: ({ project }) => {
    const first = [...project.shots].sort((a, b) => a.index - b.index)[0]
    if (!first || first.startMs === 0) return []
    return [makeDiagnostic(
      shot1NoTimestamp,
      { kind: 'shot', id: first.id },
      'Pierwsze ujęcie musi zaczynać się w 0 ms i nie otrzymuje timestampu.',
      'The first shot must start at 0 ms and carries no timestamp.',
    )]
  },
})

const shotTimeMonotonic = defineRule({
  id: 'SHOT_TIME_MONOTONIC',
  severity: 'error',
  guideRef: 'guide_base §4.2',
  run: ({ project }) => {
    const shots = [...project.shots].sort((a, b) => a.index - b.index)
    return shots.flatMap((shot, i) => {
      const prev = shots[i - 1]
      if (!prev || shot.startMs > prev.startMs) return []
      return [makeDiagnostic(
        shotTimeMonotonic,
        { kind: 'shot', id: shot.id },
        `Czas cięcia ujęcia ${shot.index + 1} nie jest większy od poprzedniego.`,
        `Cut time of shot ${shot.index + 1} is not greater than the previous one.`,
      )]
    })
  },
})

const shotTimeInRange = defineRule({
  id: 'SHOT_TIME_IN_RANGE',
  severity: 'error',
  guideRef: 'guide_base §4.2',
  run: ({ project }) => project.shots
    .filter(shot => shot.startMs >= project.video.durationMs)
    .map(shot => makeDiagnostic(
      shotTimeInRange,
      { kind: 'shot', id: shot.id },
      `Cięcie ujęcia ${shot.index + 1} wypada poza długością wideo.`,
      `The cut of shot ${shot.index + 1} falls outside the video duration.`,
    )),
})

const shotIndexSequential = defineRule({
  id: 'SHOT_INDEX_SEQUENTIAL',
  severity: 'error',
  guideRef: 'guide_base §4.2',
  run: ({ project }) => {
    const indexes = project.shots.map(s => s.index).sort((a, b) => a - b)
    const broken = indexes.some((value, position) => value !== position)
    if (!broken) return []
    return [makeDiagnostic(
      shotIndexSequential,
      { kind: 'project', id: project.id },
      'Numery ujęć muszą tworzyć ciąg bez dziur i powtórzeń, zaczynający się od pierwszego ujęcia.',
      'Shot numbers must form a gapless, duplicate-free sequence starting at the first shot.',
    )]
  },
})

const frameSnap = defineRule({
  id: 'FRAME_SNAP',
  severity: 'warning',
  guideRef: '24 FPS — karta modelu',
  run: ({ project }) => project.shots
    .filter(shot => !isFrameAligned(shot.startMs))
    .map(shot => makeDiagnostic(
      frameSnap,
      { kind: 'shot', id: shot.id },
      `Czas cięcia ${shot.startMs} ms nie leży na granicy klatki przy 24 fps.`,
      `Cut time ${shot.startMs} ms is not aligned to a frame boundary at 24 fps.`,
    )),
})

export const timeRules: Rule[] = [
  durationRange, shot1NoTimestamp, shotTimeMonotonic, shotTimeInRange,
  shotIndexSequential, frameSnap,
]
