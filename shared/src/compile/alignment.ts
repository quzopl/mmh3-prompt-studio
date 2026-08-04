import type { Project } from '../model/types.js'
import { formatAlignSeconds } from '../time/format.js'

/**
 * Linia instrukcji wyrównania klatek. Szablony przepisane dosłownie
 * z guide_base.md §2.1 — zapis etykiet różni się między trybami
 * (FL2VA bez nawiasów kątowych, I2VA i L2VA z nawiasami).
 */
export function alignmentLine(project: Project): string | null {
  const lastShotNumber = Math.max(1, project.shots.length)
  const end = formatAlignSeconds(project.video.durationMs)

  switch (project.mode) {
    case 'T2VA':
    case 'REF':
      return null
    case 'I2VA':
      return 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'
    case 'FL2VA':
      return 'How the reference pictures align with the target video — '
        + 'Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; '
        + `Picture 2 (from Shot ${lastShotNumber}) aligns with the ${end}-second mark of the target video.`
    case 'L2VA':
      return 'How the reference pictures align with the target video — '
        + `<Picture 1> (from [Shot ${lastShotNumber}]) aligns with the ${end}-second mark of the target video.`
  }
}
