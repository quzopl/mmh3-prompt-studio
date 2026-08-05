import type { Project, Shot, Speaker } from '../model/types.js'
import { segmentAt } from './segment.js'
import type { PatchOp } from './types.js'

/**
 * Nakłada operacje po kolei na projekt. Czysta funkcja, bez zależności od
 * `web/` — używana też przez `server/`.
 *
 * Operacja, która nie znajduje swojego celu (np. wskazuje nieistniejące
 * ujęcie, mówcę albo segment innego rodzaju niż tekst) ALBO której cel
 * istnieje, ale nowa wartość jest identyczna z obecną, zwraca dokładnie ten
 * sam obiekt projektu, który dostała — nie tylko referencyjnie różny obiekt
 * o tej samej treści. `useProject.apply` odróżnia „nic się nie zmieniło" po
 * równości referencji (`===`), nie po równości głębokiej, więc łatka
 * powtarzająca już obecną wartość musi oddać dokładnie ten sam obiekt: bez
 * tego przyjęcie takiej łatki i tak zapisałoby pusty wpis w historii
 * cofania i oznaczyło projekt jako „niezapisany".
 *
 * Wyjątek: `replaceShots` porównuje referencję tablicy `shots`, a nie jej
 * zawartość. Nowa tablica o identycznej zawartości to wciąż realna podmiana
 * na tym poziomie — głębokie porównanie „taki sam wynik, nic nie rób"
 * należy do zadań językowych, które budują tę tablicę, a nie do tej warstwy.
 */
export function applyOps(project: Project, ops: PatchOp[]): Project {
  return ops.reduce(applyOp, project)
}

function applyOp(project: Project, op: PatchOp): Project {
  switch (op.kind) {
    case 'replaceShots':
      if (op.shots === project.shots) return project
      return { ...project, shots: op.shots }
    case 'setShotText':
      return applySetShotText(project, op)
    case 'setAudio':
      if (project.audio[op.field] === op.text) return project
      return { ...project, audio: { ...project.audio, [op.field]: op.text } }
    case 'setStyle':
      if (project.style === op.text) return project
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
 * istniejącego — i tylko wtedy, gdy treść faktycznie się różni.
 */
function applySetShotText(
  project: Project,
  op: Extract<PatchOp, { kind: 'setShotText' }>,
): Project {
  const shotIndex = project.shots.findIndex(shot => shot.id === op.shotId)
  if (shotIndex === -1) return project
  const shot = project.shots[shotIndex]
  if (shot === undefined) return project

  const segment = segmentAt(shot.body, op.segmentIndex)
  if (segment === undefined || segment.kind !== 'text') return project
  if (segment.text === op.text) return project

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
  if (speaker[op.field] === op.text) return project

  const nextSpeaker: Speaker = { ...speaker, [op.field]: op.text }
  const nextSpeakers = project.speakers.slice()
  nextSpeakers[speakerIndex] = nextSpeaker
  return { ...project, speakers: nextSpeakers }
}
