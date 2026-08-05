import type { Project } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { same, useSelection } from '../store/selectionStore.js'
import { useT } from '../i18n/useT.js'
import { msToPx, type Scale } from './scale.js'
import { clipBox } from './clips.js'
import { shotSpans } from './spans.js'

/** Wysokość jednego wiersza klipu — jak `h-8` gdzie indziej na tej osi. */
export const SCREEN_TEXT_ROW_HEIGHT_PX = 32

/**
 * Liczba wierszy ścieżki — najliczniejsze `screenText` z ujęć projektu, min. 1
 * (patrz akapit o wysokości niżej w komentarzu komponentu). Wystawione, żeby
 * `TrackStack` (zadanie 12) mógł policzyć wysokość wiersza nagłówka z TEGO
 * SAMEGO wzoru, którego używa sama ścieżka do własnej wysokości — jedno
 * źródło, nie dwa niezależne przeliczenia, które mogłyby się rozjechać.
 */
export const screenTextRowCount = (project: Project): number =>
  Math.max(1, ...project.shots.map(shot => shot.screenText.length))

/**
 * `ScreenText` nie ma własnych czasów — należy do ujęcia i tyle. Klip pokrywa
 * więc rozpiętość ujęcia i nie da się go przeciągnąć (brak `onPointerDown`,
 * brak uchwytów krawędzi). Dokładanie czasów do modelu tylko po to, żeby dało
 * się je przesuwać, zmieniłoby schemat dla wygody rysowania.
 *
 * Kilka tekstów w jednym ujęciu dzielą dokładnie tę samą rozpiętość czasu —
 * bez rozsunięcia rysowałyby się jeden na drugim: nierozróżnialne, a myszą
 * osiągalny tylko ten najwyżej w dokumencie. Wiersz w pionie bierze się więc
 * z pozycji tekstu we WŁASNYM `shot.screenText` (nie z globalnego licznika) —
 * dwa teksty z RÓŻNYCH ujęć mogą bezpiecznie dzielić ten sam wiersz, bo ich
 * rozpiętości czasu (rozpiętości ich ujęć) nigdy się nie pokrywają. Wysokość
 * ścieżki rośnie do najliczniejszego ujęcia w projekcie, żeby żaden wiersz
 * nie wypadł poza widoczny obszar.
 *
 * Trzy decyzje z `CameraTrack` przenoszą się tu bez zmian: etykieta klipu
 * niesie numer tekstu w obrębie własnego ujęcia (patrz akapit wyżej — bez
 * niego dwa identyczne teksty w tym samym ujęciu dostałyby identyczną nazwę
 * dostępną); Shift+klik dokłada do zaznaczenia zamiast je zastępować, jak w
 * `ShotTrack`; klip jest `role="button"` z jawną obsługą klawiatury zamiast
 * natywnego `<button>` — spacja na natywnym przycisku nie zatrzymałaby się na
 * `stopPropagation` i poleciałaby dalej do `useTimelineShortcuts` na
 * `window`, gdzie przełącza odtwarzanie jako efekt uboczny aktywacji klipu.
 */
export function ScreenTextTrack({ scale }: { scale: Scale }) {
  const t = useT()
  const project = useProject(state => state.project)
  const selected = useSelection(state => state.selected)
  const select = useSelection(state => state.select)
  const toggle = useSelection(state => state.toggle)

  if (!project) return null

  const spans = shotSpans(project.shots, project.video.durationMs)
  const rows = screenTextRowCount(project)

  return (
    <div
      data-track="screen-text"
      aria-label={t('timeline.trackScreenText')}
      className="relative border-b border-neutral-800"
      style={{ width: msToPx(scale, scale.durationMs), height: rows * SCREEN_TEXT_ROW_HEIGHT_PX }}
    >
      {spans.flatMap(span =>
        span.shot.screenText.map((entry, position) => {
          const ref = { kind: 'screenText' as const, id: entry.id }
          const isSelected = selected.some(candidate => same(candidate, ref))
          const label = t('screenText.clipLabel', {
            shot: span.shot.index + 1,
            // 1-liczbowy numer tekstu w obrębie WŁASNEGO ujęcia — patrz
            // komentarz nad komponentem.
            position: position + 1,
            text: entry.text,
          })
          return (
            <div
              key={entry.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={label}
              onClick={event => (event.shiftKey ? toggle(ref) : select(ref))}
              onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                select(ref)
              }}
              className={`absolute h-6 overflow-hidden rounded border px-1 text-left text-[10px] ${
                isSelected
                  ? 'border-amber-500 bg-amber-950 text-amber-100'
                  : 'border-neutral-700 bg-neutral-900 hover:border-neutral-500'
              }`}
              style={{ ...clipBox(scale, { id: entry.id, startMs: span.startMs, endMs: span.endMs }), top: position * SCREEN_TEXT_ROW_HEIGHT_PX + 4 }}
            >
              {entry.text}
            </div>
          )
        }))}
    </div>
  )
}
