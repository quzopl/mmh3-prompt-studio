import type { Mode, Project } from '../../model/types.js'
import { defineRule, makeDiagnostic, type Diagnostic, type Rule } from '../types.js'

const REQUIRED_PICTURES: Partial<Record<Mode, number>> = {
  I2VA: 1,
  FL2VA: 2,
  L2VA: 1,
}

const pictureCount = (project: Project): number =>
  project.labels.filter(l => l.kind === 'picture').length

const anchorRequired = defineRule({
  id: 'ANCHOR_REQUIRED',
  severity: 'error',
  guideRef: 'guide_base §2.1, §3',
  run: ({ project }) => {
    const required = REQUIRED_PICTURES[project.mode]
    const out: Diagnostic[] = []

    if (required === undefined) {
      if (project.mode === 'T2VA' && pictureCount(project) > 0) {
        out.push(makeDiagnostic(
          anchorRequired, { kind: 'project', id: project.id },
          'Tryb T2VA nie korzysta z obrazów referencyjnych.',
          'T2VA mode does not use reference images.',
        ))
      }
      return out
    }

    if (pictureCount(project) !== required) {
      out.push(makeDiagnostic(
        anchorRequired, { kind: 'project', id: project.id },
        `Tryb ${project.mode} wymaga dokładnie ${required} obrazów referencyjnych, a jest ich ${pictureCount(project)}.`,
        `Mode ${project.mode} requires exactly ${required} reference image(s), but there are ${pictureCount(project)}.`,
      ))
    }

    if (!project.shots.some(s => s.anchor !== 'none')) {
      out.push(makeDiagnostic(
        anchorRequired, { kind: 'project', id: project.id },
        `Tryb ${project.mode} wymaga wskazania ujęcia zakotwiczonego na klatce referencyjnej.`,
        `Mode ${project.mode} requires a shot anchored to a reference frame.`,
      ))
    }

    return out
  },
})

const fl2vaPreferSingleShot = defineRule({
  id: 'FL2VA_PREFER_SINGLE_SHOT',
  severity: 'warning',
  guideRef: 'guide_base §3.2',
  run: ({ project }) => {
    if (project.mode !== 'FL2VA' || project.shots.length <= 1) return []
    return [makeDiagnostic(
      fl2vaPreferSingleShot, { kind: 'project', id: project.id },
      'FL2VA preferuje pojedyncze ujęcie, żeby model mógł interpolować od pierwszej do ostatniej klatki.',
      'FL2VA prefers a single shot so the model can interpolate from the first to the last frame.',
    )]
  },
})

const l2vaAnchorLastShot = defineRule({
  id: 'L2VA_ANCHOR_LAST_SHOT',
  severity: 'error',
  guideRef: 'guide_base §3.3',
  run: ({ project }) => {
    if (project.mode !== 'L2VA') return []
    const shots = [...project.shots].sort((a, b) => a.index - b.index)
    const last = shots[shots.length - 1]
    if (!last) return []
    const anchored = shots.filter(s => s.anchor === 'picture-last')
    if (anchored.length === 1 && anchored[0]!.id === last.id) return []
    return [makeDiagnostic(
      l2vaAnchorLastShot, { kind: 'project', id: project.id },
      'W trybie L2VA klatka referencyjna należy do ostatniego ujęcia.',
      'In L2VA mode the reference frame belongs to the last shot.',
    )]
  },
})

export const anchorRules: Rule[] = [
  anchorRequired, fl2vaPreferSingleShot, l2vaAnchorLastShot,
]
