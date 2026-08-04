import type { CameraMotion } from '../model/types.js'

export interface CameraMotionSpec {
  type: CameraMotion
  /** Etykieta z tabeli guide'a. */
  label: string
  /** Forma czasownikowa wstawiana po "The camera ". */
  verb: string
  /** Kategoria z tabeli guide'a — 12 wierszy tabeli. */
  category: string
}

export const CAMERA_MOTIONS: readonly CameraMotionSpec[] = [
  { type: 'zoom-in',        label: 'Zoom In',        verb: 'zooms in',                 category: 'zoom' },
  { type: 'zoom-out',       label: 'Zoom Out',       verb: 'zooms out',                category: 'zoom' },
  { type: 'push-in',        label: 'Push In',        verb: 'pushes in',                category: 'dolly' },
  { type: 'pull-out',       label: 'Pull Out',       verb: 'pulls out',                category: 'dolly' },
  { type: 'pan-left',       label: 'Pan Left',       verb: 'pans left',                category: 'pan' },
  { type: 'pan-right',      label: 'Pan Right',      verb: 'pans right',               category: 'pan' },
  { type: 'truck-left',     label: 'Truck Left',     verb: 'trucks left',              category: 'truck' },
  { type: 'truck-right',    label: 'Truck Right',    verb: 'trucks right',             category: 'truck' },
  { type: 'tilt-up',        label: 'Tilt Up',        verb: 'tilts up',                 category: 'tilt' },
  { type: 'tilt-down',      label: 'Tilt Down',      verb: 'tilts down',               category: 'tilt' },
  { type: 'pedestal-up',    label: 'Pedestal Up',    verb: 'pedestals up',             category: 'pedestal' },
  { type: 'pedestal-down',  label: 'Pedestal Down',  verb: 'pedestals down',           category: 'pedestal' },
  { type: 'arc',            label: 'Arc Shot',       verb: 'arcs around the subject',  category: 'arc' },
  { type: 'tracking',       label: 'Tracking Shot',  verb: 'tracks the subject',       category: 'tracking' },
  { type: 'static',         label: 'Static Shot',    verb: 'holds a static shot',      category: 'static' },
  { type: 'shake-slightly', label: 'Shake Slightly', verb: 'shakes slightly',          category: 'shake' },
  { type: 'shake-strongly', label: 'Shake Strongly', verb: 'shakes strongly',          category: 'shake' },
  { type: 'pov',            label: 'POV',            verb: 'holds a POV shot',         category: 'pov' },
  { type: 'roll-cw',        label: 'Roll Clockwise', verb: 'rolls clockwise',          category: 'roll' },
  { type: 'roll-ccw',       label: 'Roll Counterclockwise', verb: 'rolls counterclockwise', category: 'roll' },
]

const VERB_BY_TYPE = new Map(CAMERA_MOTIONS.map(m => [m.type, m.verb]))

export function cameraVerb(type: CameraMotion): string {
  const verb = VERB_BY_TYPE.get(type)
  if (!verb) throw new Error(`Nieznany typ ruchu kamery: ${type}`)
  return verb
}
