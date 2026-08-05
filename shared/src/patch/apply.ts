import type { Project, Shot, Speaker } from '../model/types.js'
import type { PatchOp } from './types.js'

/**
 * Nakłada operacje po kolei na projekt. Czysta funkcja, bez zależności od
 * `web/` — używana też przez `server/`.
 *
 * Każda operacja, która nie znajduje swojego celu (np. wskazuje nieistniejące
 * ujęcie, mówcę albo segment innego rodzaju niż tekst), zwraca dokładnie ten
 * sam obiekt projektu, który dostała. Dzięki temu pusta lista operacji — albo
 * lista złożona wyłącznie z operacji bez celu — zwraca ten sam obiekt na
 * wejściu: `useProject.apply` odróżnia „nic się nie zmieniło" po równości
 * referencji i bez tego przyjęta łatka bez efektu i tak zapisałaby pusty wpis
 * w historii cofania.
 */
export function applyOps(project: Project, ops: PatchOp[]): Project {
  return ops.reduce(applyOp, project)
}

function applyOp(project: Project, op: PatchOp): Project {
  switch (op.kind) {
    case 'replaceShots':
      return { ...project, shots: op.shots }
    case 'setShotText':
      return applySetShotText(project, op)
    case 'setAudio':
      return { ...project, audio: { ...project.audio, [op.field]: op.text } }
    case 'setStyle':
      return { ...project, style: op.text }
    case 'setSpeakerDescriptor':
      return applySetSpeakerDescriptor(project, op)
  }
}

/**
 * Jedyna operacja, która pisze wewnątrz `body`. Pisze tylko wtedy, gdy
 * segment pod wskazanym indeksem istnieje i ma `kind === 'text'` — model,
 * który poda indeks segmentu kamery albo mówcy, nie ma prawa zamienić go
 * w prozę. Nie tworzy ani nie usuwa segmentów, tylko podmienia treść
 * istniejącego.
 */
function applySetShotText(
  project: Project,
  op: Extract<PatchOp, { kind: 'setShotText' }>,
): Project {
  const shotIndex = project.shots.findIndex(shot => shot.id === op.shotId)
  if (shotIndex === -1) return project
  const shot = project.shots[shotIndex]
  if (shot === undefined) return project

  const segment = shot.body[op.segmentIndex]
  if (segment === undefined || segment.kind !== 'text') return project

  const nextBody = shot.body.slice()
  nextBody[op.segmentIndex] = { kind: 'text', text: op.text }
  const nextShot: Shot = { ...shot, body: nextBody }

  const nextShots = project.shots.slice()
  nextShots[shotIndex] = nextShot
  return { ...project, shots: nextShots }
}

function applySetSpeakerDescriptor(
  project: Project,
  op: Extract<PatchOp, { kind: 'setSpeakerDescriptor' }>,
): Project {
  const speakerIndex = project.speakers.findIndex(speaker => speaker.id === op.speakerId)
  if (speakerIndex === -1) return project
  const speaker = project.speakers[speakerIndex]
  if (speaker === undefined) return project

  const nextSpeaker: Speaker = { ...speaker, [op.field]: op.text }
  const nextSpeakers = project.speakers.slice()
  nextSpeakers[speakerIndex] = nextSpeaker
  return { ...project, speakers: nextSpeakers }
}
