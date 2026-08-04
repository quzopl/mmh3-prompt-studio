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

export function emitRef(project: Project): string {
  const sections: Array<[string, string]> = [
    ['subject_definitions', renderSubjectDefinitions(project)],
    ['summary', renderSummary(project)],
    ['retention_analysis', renderRetention(project)],
    ['detailed_description', renderDetailedDescription(project)],
    ['overall_soundscape', project.audio.overallSoundscape],
    ['non_diegetic_music', project.audio.nonDiegeticMusic],
  ]
  return sections.map(([name, body]) => `${name}:\n${body}`).join('\n\n')
}
