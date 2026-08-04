import { z } from 'zod'
import type { Project } from './types.js'

export const CameraMotionSchema = z.enum([
  'zoom-in', 'zoom-out', 'push-in', 'pull-out',
  'pan-left', 'pan-right', 'truck-left', 'truck-right',
  'tilt-up', 'tilt-down', 'pedestal-up', 'pedestal-down',
  'arc', 'tracking', 'static',
  'shake-slightly', 'shake-strongly',
  'pov', 'roll-cw', 'roll-ccw',
])

export const CameraMoveSchema = z.object({
  id: z.string(),
  type: CameraMotionSchema,
  amplitude: z.enum(['small', 'large']).optional(),
  speed: z.enum(['slow', 'fast']).optional(),
  target: z.string().optional(),
  customPhrase: z.string().optional(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
})

export const SpeakerSchema = z.object({
  id: z.string(),
  code: z.string(),
  characterType: z.string(),
  age: z.string(),
  gender: z.string(),
  pitch: z.string(),
  timbre: z.string(),
  rate: z.string(),
  accent: z.string(),
  onScreen: z.boolean(),
  fullDescriptor: z.string(),
  shortDescriptor: z.string(),
})

export const DialogueEventSchema = z.object({
  id: z.string(),
  speakerIds: z.array(z.string()).min(1),
  verb: z.string(),
  punctuation: z.enum([':', ',']),
  language: z.string(),
  text: z.string(),
  voiceover: z.boolean(),
  lipsClause: z.string().optional(),
  sceneTransBefore: z.boolean(),
  sceneTransAfter: z.boolean(),
  continuityPhrase: z.string().optional(),
  cutoff: z.boolean(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
})

export const SegmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('camera'), moveId: z.string() }),
  z.object({
    kind: z.literal('speaker'),
    speakerId: z.string(),
    descriptor: z.string().optional(),
    form: z.enum(['full', 'short', 'idOnly']),
  }),
  z.object({ kind: z.literal('dialogue'), eventId: z.string() }),
  z.object({
    kind: z.literal('label'),
    labelId: z.string(),
    speakerId: z.string().optional(),
    bracketed: z.boolean(),
  }),
  z.object({ kind: z.literal('screenText'), id: z.string() }),
])

export const ShotSchema = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  cutType: z.enum(['cut', 'cross-dissolve', 'fade', 'wipe']),
  cutPhrase: z.enum([
    'the camera cuts to',
    'the shot cuts to',
    'the shot transitions to',
    'the shot changes to',
    'the shot switches to',
  ]),
  composition: z.string(),
  body: z.array(SegmentSchema),
  cameraMoves: z.array(CameraMoveSchema),
  dialogue: z.array(DialogueEventSchema),
  screenText: z.array(z.object({ id: z.string(), text: z.string() })),
  diegeticSfx: z.array(z.object({
    id: z.string(),
    description: z.string(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
  })),
  labelRefs: z.array(z.string()),
  anchor: z.enum(['none', 'picture-first', 'picture-last', 'keyframe']),
})

export const LabelSchema = z.object({
  id: z.string(),
  kind: z.enum(['subject', 'picture', 'video', 'audio']),
  index: z.number().int().positive(),
  assetIds: z.array(z.string()),
  definition: z.string(),
  role: z.string(),
  standalone: z.boolean(),
})

export const RetentionEntrySchema = z.object({
  id: z.string(),
  labelId: z.string(),
  scope: z.string(),
  marker: z.enum([
    'fully_preserved', 'partially_preserved', 'attribute_transfer',
    'fully_copy', 'partially_copy', 'reference', 'weak_reference',
  ]),
  note: z.string(),
})

export const ProjectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  mode: z.enum(['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF']),
  video: z.object({
    durationMs: z.number().int().positive(),
    fps: z.literal(24),
    aspect: z.enum(['16:9', '4:3', '1:1', '9:16']),
    resolution: z.string(),
  }),
  style: z.string(),
  assets: z.array(z.object({
    id: z.string(),
    kind: z.enum(['image', 'video', 'audio']),
    path: z.string(),
    fileName: z.string(),
  })),
  labels: z.array(LabelSchema),
  speakers: z.array(SpeakerSchema),
  shots: z.array(ShotSchema),
  audio: z.object({
    overallSoundscape: z.string(),
    nonDiegeticMusic: z.string(),
  }),
  ref: z.object({
    taskTypes: z.array(z.enum([
      'keyframe completion', 'reference generation', 'video editing',
      'video continuation', 'audio reuse', 'audio reference',
    ])),
    summaryText: z.string(),
    retention: z.array(RetentionEntrySchema),
  }),
})

export function parseProject(input: unknown): Project {
  return ProjectSchema.parse(input) as Project
}
