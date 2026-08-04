import type { Project } from '../model/types.js'
import { renderShot } from './renderShot.js'
import { alignmentLine } from './alignment.js'

/**
 * Emiter trybów T2VA / I2VA / FL2VA / L2VA.
 * Wszystkie ujęcia idą w jednym akapicie, oddzielone pojedynczą spacją.
 */
export function emitBase(project: Project): string {
  const blocks: string[] = []

  const instruction = alignmentLine(project)
  if (instruction) blocks.push(instruction)

  const shots = project.shots
    .slice()
    .sort((a, b) => a.index - b.index)
    .map(shot => renderShot(shot, project, { includeStyle: true }))
    .join(' ')

  blocks.push(`integrated_multimodal_description: ${shots}`)
  blocks.push(`overall_soundscape: ${project.audio.overallSoundscape}`)
  blocks.push(`non_diegetic_music: ${project.audio.nonDiegeticMusic}`)

  return blocks.join('\n\n')
}
