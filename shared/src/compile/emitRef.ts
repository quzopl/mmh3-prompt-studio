import type { Project } from '../model/types.js'
import { labelText } from './renderLabel.js'
import { renderShot } from './renderShot.js'

export function renderSubjectDefinitions(project: Project): string {
  return project.labels
    .filter(l => l.standalone)
    .map(l => `${labelText(l, true)} ${l.definition}`)
    .join('\n')
}

export function renderSummary(project: Project): string {
  const prefix = `[${project.ref.taskTypes.join(' + ')}]`
  return `${prefix} ${project.ref.summaryText}`
}

export function renderRetention(project: Project): string {
  return project.ref.retention.map(entry => {
    const label = project.labels.find(l => l.id === entry.labelId)
    if (!label) throw new Error(`Wpis retention wskazuje nieistniejącą etykietę: ${entry.labelId}`)
    const scope = entry.scope ? ` (${entry.scope})` : ''
    return `${labelText(label, true)}${scope}: ${entry.marker} - ${entry.note}`
  }).join('\n')
}

/**
 * W trybie REF zdanie o stylu stoi w osobnej linii przed [Shot 1],
 * a każde ujęcie zaczyna nową linię.
 */
export function renderDetailedDescription(project: Project): string {
  const shots = project.shots
    .slice()
    .sort((a, b) => a.index - b.index)
    .map(shot => renderShot(shot, project, { includeStyle: false }))
  const lines = project.style ? [project.style, ...shots] : shots
  return lines.join('\n')
}

const SECTION_SEPARATOR = '\n\n'

/** Sekcje trybu REF w kolejności, jako pary nazwa/treść. */
export function composeRefSections(project: Project): Array<[string, string]> {
  return [
    ['subject_definitions', renderSubjectDefinitions(project)],
    ['summary', renderSummary(project)],
    ['retention_analysis', renderRetention(project)],
    ['detailed_description', renderDetailedDescription(project)],
    ['overall_soundscape', project.audio.overallSoundscape],
    ['non_diegetic_music', project.audio.nonDiegeticMusic],
  ]
}

export function emitRef(project: Project): string {
  return composeRefSections(project)
    .map(([name, body]) => `${name}:\n${body}`)
    .join(SECTION_SEPARATOR)
}

/**
 * Granice sekcji wyliczone z długości składanych fragmentów.
 * Wcześniej mapa tokenów szukała literału "detailed_description:" w gotowym
 * tekście, co dawało zły wynik, gdy ten sam ciąg pojawił się wcześniej
 * w treści innej sekcji.
 */
export function refSectionOffsets(
  project: Project,
): Array<{ name: string; start: number; end: number }> {
  const out: Array<{ name: string; start: number; end: number }> = []
  let cursor = 0
  const sections = composeRefSections(project)
  sections.forEach(([name, body], index) => {
    const rendered = `${name}:\n${body}`
    out.push({ name, start: cursor, end: cursor + rendered.length })
    cursor += rendered.length
    if (index < sections.length - 1) cursor += SECTION_SEPARATOR.length
  })
  return out
}
