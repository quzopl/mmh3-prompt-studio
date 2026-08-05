import type { Project } from '@mmh3/shared'
import { shotSpans } from './spans.js'

/**
 * Treść nawiasu do `retention_analysis`. Guide każe wskazać ujęcia tylko wtedy,
 * gdy etykieta nie dotyczy całego materiału — przy występowaniu wszędzie nawias
 * jest szumem, a przy nieobecności nie ma czego wskazywać.
 *
 * Numeracja idzie po kolejności na osi czasu, nie po pozycji w tablicy: to samo
 * ujęcie musi nazywać się `[Shot 3]` tu i w skompilowanym prompcie —
 * `shotSpans` sortuje po `index` tak samo, jak `renderDetailedDescription`
 * w `shared/src/compile/emitRef.ts` sortuje ujęcia przed wyliczeniem numerów.
 */
export function scopeForLabel(project: Project, labelId: string): string {
  const spans = shotSpans(project.shots, project.video.durationMs)
  const numbers = spans
    .map((span, position) => span.shot.labelRefs.includes(labelId) ? position + 1 : null)
    .filter((value): value is number => value !== null)

  if (numbers.length === 0 || numbers.length === spans.length) return ''
  return `appears in ${numbers.map(number => `[Shot ${number}]`).join(', ')}`
}

/**
 * Przełącza obecność etykiety w ujęciu i od razu przelicza zakres w jej wpisie
 * retencji — te dwie rzeczy opisują ten sam fakt, więc rozjazd między nimi
 * byłby widoczny dopiero w gotowym prompcie.
 *
 * Wpisów retencji dla tej etykiety może nie być wcale (etykieta niestandalone
 * nie musi mieć wpisu — `REF_RETENTION_COMPLETE` wymaga go tylko dla etykiet
 * `standalone`) — wtedy nie dokładamy nowego, bo zgadywalibyśmy `marker`
 * i `note`, których użytkownik nie podał, a zły `marker` od razu włączyłby
 * `REF_MARKER_VOCAB`. Może ich też być kilka dla tego samego `labelId` (schemat
 * tego nie zabrania) — wtedy przeliczamy zakres we wszystkich, bo każdy z nich
 * opisuje tę samą etykietę i ten sam fakt.
 */
export function toggleLabelInShot(project: Project, labelId: string, shotId: string): Project {
  if (!project.shots.some(shot => shot.id === shotId)) return project

  const shots = project.shots.map(shot => {
    if (shot.id !== shotId) return shot
    const present = shot.labelRefs.includes(labelId)
    return {
      ...shot,
      labelRefs: present
        ? shot.labelRefs.filter(id => id !== labelId)
        : [...shot.labelRefs, labelId],
    }
  })

  const withShots = { ...project, shots }
  return {
    ...withShots,
    ref: {
      ...withShots.ref,
      retention: withShots.ref.retention.map(entry =>
        entry.labelId === labelId ? { ...entry, scope: scopeForLabel(withShots, labelId) } : entry),
    },
  }
}
