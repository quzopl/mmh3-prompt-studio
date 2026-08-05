import { snapToFrame, type Project, type Shot } from '@mmh3/shared'
import { boundaryTargetMs, MIN_SHOT_MS } from './useDragBoundary.js'
import { normalizeShots } from './normalize.js'
import { shotSpans } from './spans.js'

/**
 * Numer w identyfikatorze nowego ujęcia — po maksimum już zajętych, nie po
 * liczbie wpisów. `shots.length + 1` wraca do przebytej już wartości za każdym
 * razem, gdy jakieś ujęcie zniknie, więc drugie cięcie postawione w tym samym
 * czasie co kiedyś dostawało identyfikator żywego ujęcia. Skutek nie jest
 * kosmetyczny: `useDragBoundary`, `AnchorBadges.toggle`, `removeShots` i
 * zaznaczenie dopasowują ujęcie po `shot.id`. `ProjectSchema` dziś odrzuci
 * taki duplikat, ale to obrona drugiej linii — to numerowanie ma nie
 * dopuścić, żeby duplikat w ogóle powstał, bo odrzucenie przez schemat i tak
 * oznaczałoby utracony autozapis. Maksimum powiększone o jeden jest zawsze
 * większe od każdego zajętego numeru, więc kolizja jest niemożliwa
 * niezależnie od historii usunięć — ten sam idiom, co numerowanie etykiet
 * i mówców w `AssetBin`.
 */
const nextShotNumber = (shots: Shot[]): number =>
  Math.max(0, ...shots.map(shot => {
    const parsed = Number(/-(\d+)$/.exec(shot.id)?.[1])
    return Number.isFinite(parsed) ? parsed : 0
  })) + 1

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
    id: `shot-${at}-${nextShotNumber(project.shots)}`,
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

  return { ...project, shots: normalizeShots([...project.shots, shot], project.video.durationMs) }
}

/**
 * Ustawia czas cięcia ujęcia — droga dla wpisu z inspektora, równoważna
 * przeciągnięciu granicy. Ta sama polityka co w geście myszą, bo wyraża ją ta
 * sama funkcja `boundaryTargetMs`: przyciągnięcie do siatki klatek i
 * ograniczenie sąsiadami o minimalną długość ujęcia (dla ostatniego ujęcia
 * sąsiadem jest koniec materiału). Bez tego pole inspektora było jedynym
 * pisarzem ujęć, który nie trzymał żadnego z tych niezmienników: wpisanie
 * czasu większego niż następne cięcie rozjeżdżało porządek `index` z porządkiem
 * `startMs`, a `spans.ts` i `useDragBoundary` zakładają, że oba są zgodne.
 *
 * Bez punktów przyciągania (`snapPoints: []`) i z zerową tolerancją: wpisana
 * liczba jest deklaracją użytkownika, a nie pozycją kursora, więc nie ma czego
 * przyciągać do sąsiednich cięć. Zwraca ten sam projekt, gdy nic się nie
 * zmienia — `projectStore.apply` nie dokłada wtedy wpisu do historii.
 */
export function setShotStartMs(project: Project, shotId: string, ms: number): Project {
  const spans = shotSpans(project.shots, project.video.durationMs)
  const position = spans.findIndex(span => span.shot.id === shotId)
  // Pierwsze ujęcie zaczyna się w zerze z definicji i nie ma granicy do ruszenia.
  if (position <= 0) return project

  const startMs = boundaryTargetMs({
    desiredMs: ms,
    previousMs: spans[position - 1]?.startMs ?? 0,
    nextMs: spans[position + 1]?.startMs ?? project.video.durationMs,
    snapPoints: [],
    toleranceMs: 0,
  })
  if (startMs === spans[position]?.startMs) return project

  return {
    ...project,
    shots: normalizeShots(
      project.shots.map(shot => shot.id === shotId ? { ...shot, startMs } : shot),
      project.video.durationMs,
    ),
  }
}

/**
 * Projekt bez ujęć nie skompilowałby się, więc jedno zawsze zostaje. Brief
 * tego zadania proponował tu inny kod: gdy usunięcie obejmowało wszystkie
 * ujęcia, cofał operację w całości i oddawał `project` bez zmian — dla
 * `removeShots(project, ['a', 'b'])` zwracał więc dwa ujęcia, choć własny
 * test (`nigdy nie usuwa ostatniego ujęcia`) oczekuje jednego. To sprzeczność
 * między testem a implementacją w briefie, nie literówka: „ostatnie zostaje”
 * ma sens tylko jako „zachowaj jedno ujęcie”, nigdy jako „nie usuwaj niczego”.
 * Implementacja poniżej usuwa więc wszystko, co się da, i dopiero gdyby lista
 * ocalałych była pusta, zostawia jedno — pierwsze w kolejności ujęć, czyli to,
 * które już stało przy lewej krawędzi osi czasu. Ocalałe zawsze ląduje po
 * `normalizeShots` na indeksie 0 i czasie 0, więc ten niezmiennik nie
 * rozstrzyga, które ujęcie wybrać — rozstrzyga to, że jego treść jest tam,
 * gdzie użytkownik ją ostatnio widział; ostatnie w kolejności podmieniłoby ją
 * na treść z drugiego końca materiału.
 */
export function removeShots(project: Project, ids: string[]): Project {
  if (ids.length === 0) return project
  const survivors = project.shots.filter(shot => !ids.includes(shot.id))
  if (survivors.length > 0) {
    return { ...project, shots: normalizeShots(survivors, project.video.durationMs) }
  }

  const ordered = [...project.shots].sort((a, b) => a.index - b.index)
  const first = ordered[0]
  if (!first) return project
  return { ...project, shots: normalizeShots([first], project.video.durationMs) }
}
