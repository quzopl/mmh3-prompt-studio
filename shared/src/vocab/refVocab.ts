import type { AudioMarker, RefTaskType, VisualMarker } from '../model/types.js'

export const REF_TASK_TYPES: readonly RefTaskType[] = [
  'keyframe completion',
  'reference generation',
  'video editing',
  'video continuation',
  'audio reuse',
  'audio reference',
]

export const VISUAL_MARKERS: readonly VisualMarker[] = [
  'fully_preserved', 'partially_preserved', 'attribute_transfer', 'weak_reference',
]

export const AUDIO_MARKERS: readonly AudioMarker[] = [
  'fully_copy', 'partially_copy', 'reference', 'weak_reference',
]

/** Zdanie otwierające summary dla zadań montażowych. */
export const VIDEO_EDIT_SUMMARY_OPENING = 'The target video is an edited version of <Video 1>.'
