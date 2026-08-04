import { snapToFrame, type Project, type Shot } from '@mmh3/shared'
import { MIN_SHOT_MS } from './useDragBoundary.js'

const renumber = (shots: Shot[]): Shot[] =>
  [...shots]
    .sort((a, b) => a.startMs - b.startMs)
    .map((shot, index) => ({ ...shot, index, startMs: index === 0 ? 0 : shot.startMs }))

/**
 * Wstawia cięcie na playheadzie. Odmawia, gdy nowe ujęcie byłoby krótsze niż
 * minimum albo gdy w tym miejscu cięcie już jest — model nie dopuszcza dwóch
 * ujęć o tym samym czasie.
 */
export function splitAtMs(project: Project, ms: number): Project {
  const at = snapToFrame(ms)
  if (at <= 0 || at >= project.video.durationMs) return project

  const starts = project.shots.map(shot => shot.startMs)
  const tooClose = starts.some(start => Math.abs(start - at) < MIN_SHOT_MS)
  if (tooClose) return project
  if (project.video.durationMs - at < MIN_SHOT_MS) return project

  const shot: Shot = {
    id: `shot-${at}-${project.shots.length + 1}`,
    index: 0,
    startMs: at,
    cutType: 'cut',
    cutPhrase: 'the camera cuts to',
    composition: '',
    body: [],
    cameraMoves: [],
    dialogue: [],
    screenText: [],
    diegeticSfx: [],
    labelRefs: [],
    anchors: [],
  }

  return { ...project, shots: renumber([...project.shots, shot]) }
}

/**
 * Projekt bez ujęć nie skompilowałby się, więc ostatnie zawsze zostaje. Brief
 * tego zadania proponował tu inny kod: gdy usunięcie obejmowało wszystkie
 * ujęcia, cofał operację w całości i oddawał `project` bez zmian — dla
 * `removeShots(project, ['a', 'b'])` zwracał więc dwa ujęcia, choć własny
 * test (`nigdy nie usuwa ostatniego ujęcia`) oczekuje jednego. To sprzeczność
 * między testem a implementacją w briefie, nie literówka: „ostatnie zostaje”
 * ma sens tylko jako „zachowaj jedno ujęcie”, nigdy jako „nie usuwaj niczego”.
 * Implementacja poniżej usuwa więc wszystko, co się da, i dopiero gdyby lista
 * ocalałych była pusta, zostawia jedno — ostatnie w kolejności ujęć.
 */
export function removeShots(project: Project, ids: string[]): Project {
  if (ids.length === 0) return project
  const survivors = project.shots.filter(shot => !ids.includes(shot.id))
  if (survivors.length > 0) return { ...project, shots: renumber(survivors) }

  const ordered = [...project.shots].sort((a, b) => a.index - b.index)
  const last = ordered[ordered.length - 1]
  if (!last) return project
  return { ...project, shots: renumber([last]) }
}
