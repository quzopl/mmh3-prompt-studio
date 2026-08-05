import { MS_PER_FRAME, type Project, type RetentionEntry, type Shot } from '@mmh3/shared'
import { normalizeShots } from './normalize.js'
import { shotSpans } from './spans.js'
import { speakerIntroducedBefore } from './proposals.js'
import { scopeForLabel } from './retentionScope.js'

const frameIndexOf = (ms: number): number => Math.round(ms / MS_PER_FRAME)
const msOfFrameIndex = (frame: number): number => Math.round(frame * MS_PER_FRAME)

/**
 * Ruch kamery należy do ujęcia i `CAM_IN_SHOT_BOUNDS`
 * (`shared/src/validate/rules/camera.ts`) wymaga, żeby się w nim mieścił.
 * Zadanie 5 zamknęło POŁOWĘ tej gwarancji: przeciąganie klipu ruchu ograniczyło
 * do rozpiętości własnego ujęcia. Druga połowa — ujęcie, które rusza się pod
 * NIERUCHOMYM ruchem — nie miała właściciela: podział ujęcia, usunięcie
 * sąsiada, wpisany czas cięcia i przeciągnięcie granicy potrafiły wypchnąć
 * ruch poza jego ujęcie i zapalić regułę, której użytkownik nie sprowokował
 * (zmierzone: dodaj ruch kamery, kliknij linijkę, naciśnij `S`).
 *
 * Zaciskanie zachowuje DŁUGOŚĆ ruchu, gdy tylko się mieści — te same
 * semantyki co uchwyt `move` w `clipTargetMs` (`clips.ts`): przesuwamy klip w
 * granice, a nie przycinamy go do nich. Dopiero ruch dłuższy niż ujęcie, do
 * którego należy, dostaje całą jego rozpiętość — krótsze wyjście byłoby
 * arbitralne, a `CAM_IN_SHOT_BOUNDS` i tak nie ma innego zdania niż „mieści
 * się albo nie".
 *
 * Rachunek na INDEKSACH KLATEK, nie na milisekundach — tak jak w `clips.ts` i
 * `useDragBoundary.ts`: `MIN_*_MS` to zaokrąglone dwie klatki (83 ms, nie
 * dokładne 83,333…), więc arytmetyka w milisekundach zdejmuje wynik z siatki
 * za każdym razem, gdy punkt odniesienia sam nie leży w klatce zerowej.
 */
function clampMovesIntoShots(shots: Shot[], durationMs: number): Shot[] {
  const spans = shotSpans(shots, durationMs)
  let changed = false
  const next = spans.map(span => {
    const lowest = frameIndexOf(span.startMs)
    const highest = frameIndexOf(span.endMs)
    const room = Math.max(0, highest - lowest)
    let touched = false
    const cameraMoves = span.shot.cameraMoves.map(move => {
      const startFrame = frameIndexOf(move.startMs)
      const endFrame = frameIndexOf(move.endMs)
      const length = Math.max(0, endFrame - startFrame)
      const nextStart = length <= room ? Math.max(lowest, Math.min(startFrame, highest - length)) : lowest
      const nextEnd = length <= room ? nextStart + length : highest
      if (nextStart === startFrame && nextEnd === endFrame) return move
      touched = true
      return { ...move, startMs: msOfFrameIndex(nextStart), endMs: msOfFrameIndex(nextEnd) }
    })
    if (!touched) return span.shot
    changed = true
    return { ...span.shot, cameraMoves }
  })
  return changed ? next : shots
}

/**
 * Pierwsze wystąpienie mówcy w porządku projektu musi nieść pełną formę albo
 * własny opis — tego wymaga `SPEAKER_FIRST_INTRO`. Kiedy segment, który tę
 * rolę pełnił, znika (usunięta kwestia w zadaniu 14, usunięte całe UJĘCIE —
 * dług zapisany w tamtym raporcie i domykany tutaj), rolę przejmuje kolejny
 * PRZETRWAŁY segment tego mówcy: zwykle `'short'`, zostawiony przez
 * `splitAtSceneTrans` w ujęciu, dokąd kwestia przeszła przez cięcie. Bez
 * podniesienia go do `'full'` reguła zapala się na projekcie, który jej przed
 * gestem nie miał.
 *
 * Skanowanie w TYM SAMYM porządku, którego używa reguła i
 * `speakerIntroducedBefore` w `proposals.ts` — ujęcia po `index`, potem `body`
 * po kolejności tablicy. Reużycie `speakerIntroducedBefore` (zamiast drugiej
 * odpowiedzi na to samo pytanie) zostaje z zadania 14: dwie implementacje
 * rozjechałyby się przy pierwszej zmianie jednej z nich.
 *
 * Nie rusza segmentu, który ma już `form: 'full'` albo własny `descriptor` —
 * ani żadnego DALSZEGO wystąpienia. Skrócona forma po pierwszym wprowadzeniu
 * jest tym, czego guide chce, i podnoszenie jej byłoby pisaniem promptu za
 * użytkownika.
 */
function promoteFirstIntroduction(shots: Shot[], durationMs: number, speakerId: string): Shot[] {
  const spans = shotSpans(shots, durationMs)
  for (const [position, span] of spans.entries()) {
    const segIndex = span.shot.body.findIndex(seg => seg.kind === 'speaker' && seg.speakerIds.includes(speakerId))
    if (segIndex === -1) continue
    if (speakerIntroducedBefore(spans, position, speakerId)) return shots
    const segment = span.shot.body[segIndex]
    if (segment === undefined || segment.kind !== 'speaker') return shots
    if (segment.form === 'full' || segment.descriptor) return shots
    return shots.map(shot => (shot.id === span.shot.id
      ? { ...shot, body: shot.body.map((seg, index) => (index === segIndex ? { ...segment, form: 'full' as const } : seg)) }
      : shot))
  }
  return shots
}

function promoteIntroductions(shots: Shot[], durationMs: number): Shot[] {
  const speakerIds = new Set(shots.flatMap(shot =>
    shot.body.flatMap(seg => (seg.kind === 'speaker' ? seg.speakerIds : []))))
  return [...speakerIds].reduce(
    (current, speakerId) => promoteFirstIntroduction(current, durationMs, speakerId),
    shots,
  )
}

/**
 * Zakres etykiety w `retention_analysis` jest w całości WYPROWADZALNY z
 * `labelRefs` ujęć i z ich kolejności — nie jest niezależną informacją.
 * Do recenzji końcowej przeliczał go WYŁĄCZNIE `toggleLabelInShot`, czyli
 * jedyny pisarz `labelRefs`; wszyscy pisarze KOLEJNOŚCI UJĘĆ (usunięcie,
 * podział, wpisany czas cięcia, przeciągnięcie granicy) zostawiali go
 * nietkniętym. Zmierzone: etykieta w ujęciu 3 nadal kompiluje się jako
 * `[Shot 3]` po usunięciu ujęcia 1, choć stoi już w ujęciu 2 — a komentarz
 * `ReferencesTrack.tsx` obiecywał wprost, że to niemożliwe.
 */
function refreshRetention(project: Project): RetentionEntry[] {
  let changed = false
  const next = project.ref.retention.map(entry => {
    const scope = scopeForLabel(project, entry.labelId)
    if (scope === entry.scope) return entry
    changed = true
    return { ...entry, scope }
  })
  return changed ? next : project.ref.retention
}

/**
 * Jedyny właściciel stanu POCHODNEGO projektu — tak jak `normalizeShots` jest
 * jedynym właścicielem kolejności ujęć. Cztery niezmienniki, które trzymają
 * się albo wszystkie, albo żaden, bo wszystkie zależą od tej samej rzeczy
 * (od tego, gdzie i w jakiej kolejności stoją ujęcia):
 *
 * 1. Ujęcia znormalizowane (`normalizeShots` — indeksy, siatka klatek, brak
 *    dwóch ujęć na jednej klatce).
 * 2. Ruchy kamery zaciśnięte do swoich ujęć (`CAM_IN_SHOT_BOUNDS`).
 * 3. Pierwsze wprowadzenie każdego mówcy w formie pełnej (`SPEAKER_FIRST_INTRO`).
 * 4. Zakresy w `retention_analysis` przeliczone z aktualnych numerów ujęć.
 *
 * Recenzja końcowa (znalezisko 3) znalazła trzy osobne objawy tej jednej
 * usterki — po jednym na punkty 2–4 — i wszystkie brały się stąd, że każdy
 * pisarz listy ujęć musiał PAMIĘTAĆ o dopisaniu swojej połowy. Przez tę
 * funkcję przechodzą teraz `splitAtMs`, `setShotStartMs`, `removeShots`,
 * `removeSelected` i przeciąganie granicy w `useDragBoundary`.
 *
 * Funkcja jest czysta i ma krótkie spięcie tożsamościowe: kiedy nic się nie
 * zmieniło, oddaje `project` — TEN SAM obiekt, który dostała — a nie jego
 * kopię. Bez tego `useProject.apply` (porównuje referencyjnie, patrz
 * komentarz tam) dokładałby do historii cofania wpis nieodpowiadający żadnej
 * realnej zmianie, a każdy ruch myszy w geście, który akurat nic nie
 * przesuwa, zapychałby stos identycznymi migawkami.
 *
 * Dlatego nową listę ujęć bierze OSOBNYM argumentem, zamiast czytać ją z
 * podanego projektu: wołający zawsze buduje ją świeżo (`.filter`, `.map`,
 * `[...shots, nowe]`), więc gdyby najpierw wkleił ją do kopii projektu, ta
 * kopia byłaby już nowym obiektem i żadne porównanie w środku nie mogłoby
 * tego cofnąć. Mając oryginał i kandydata osobno, porównanie jest ELEMENTOWE:
 * tablica bywa nowa, a jej zawartość co do jednego elementu ta sama — i wtedy
 * naprawdę nic się nie zmieniło.
 */
export function normalizeProject(project: Project, shots: Shot[]): Project {
  const ordered = normalizeShots(shots, project.video.durationMs)
  const clamped = clampMovesIntoShots(ordered, project.video.durationMs)
  const nextShots = promoteIntroductions(clamped, project.video.durationMs)

  const sameShots = nextShots.length === project.shots.length
    && nextShots.every((shot, index) => shot === project.shots[index])
  const withShots = sameShots ? project : { ...project, shots: nextShots }

  const retention = refreshRetention(withShots)
  if (retention === withShots.ref.retention) return withShots
  return { ...withShots, ref: { ...withShots.ref, retention } }
}
