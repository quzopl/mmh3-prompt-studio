import type { LabelKind, Project } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { useT } from '../i18n/useT.js'
import { msToPx, type Scale } from './scale.js'
import { clipBox } from './clips.js'
import { shotSpans } from './spans.js'
import { toggleLabelInShot } from './retentionScope.js'

/** Jak `LABEL_NAME` w `AssetBin.tsx` — ta sama nazwa rodziny etykiety. */
const LABEL_NAME: Record<LabelKind, string> = {
  subject: 'Subject', picture: 'Picture', video: 'Video', audio: 'Audio',
}

/** Wysokość JEDNEGO wiersza etykiety (`h-6` niżej) — patrz `DIALOGUE_LANE_HEIGHT_PX` w `DialogueTracks.tsx`, ten sam powód. */
export const REFERENCE_ROW_HEIGHT_PX = 24

/** Liczba wierszy: jeden na etykietę projektu — jedno źródło dla `TrackStack` (zadanie 12) i tego komponentu. */
export const referenceRowCount = (project: Project): number => project.labels.length

/**
 * Ścieżka istnieje tylko w trybie REF, bo tylko tam etykiety mają sens — poza
 * nim `labelRefs` nie trafia do promptu i pokazywanie kratek sugerowałoby
 * działanie, którego nie ma.
 *
 * Wiersz na etykietę, kratka na ujęcie — kliknięcie przełącza obecność
 * etykiety w tym ujęciu i od razu przelicza zakres w `retention_analysis`
 * (`toggleLabelInShot`), więc `(appears in …)` w skompilowanym prompcie nigdy
 * nie rozjeżdża się z tym, co pokazuje kratka.
 *
 * To zdanie było do recenzji końcowej FAŁSZYWE dla drugiej połowy problemu:
 * zakres zależy nie tylko od `labelRefs` (jedyny pisarz: `toggleLabelInShot`),
 * ale i od NUMERU ujęcia, który zmienia każdy pisarz listy ujęć — usunięcie,
 * podział, wpisany czas cięcia, przeciągnięcie granicy. Zmierzone: etykieta w
 * ujęciu 3 kompilowała się nadal jako `[Shot 3]` po usunięciu ujęcia 1.
 * Właścicielem obu połówek jest dziś `normalizeProject`
 * (`web/src/timeline/normalizeProject.ts`), przez które przechodzi każdy z
 * tych pisarzy — gwarancja wyżej jest więc prawdziwa dopiero razem z nim.
 *
 * Kratka to `role="button"` div z jawną obsługą klawiatury, jak w
 * `ScreenTextTrack`/`ShotTrack`, a nie natywny `<button>` — sama spacja bez
 * `stopPropagation` poleciałaby dalej do globalnego `useTimelineShortcuts` na
 * `window`, gdzie przełącza odtwarzanie jako efekt uboczny aktywacji kratki.
 * Ordinal do rozróżnienia klipów (jak w `CameraTrack`/`ScreenTextTrack`) tu
 * nie jest potrzebny — jedna etykieta w jednym ujęciu to już unikalna para.
 */
export function ReferencesTrack({ scale }: { scale: Scale }) {
  const t = useT()
  const project = useProject(state => state.project)

  if (!project || project.mode !== 'REF') return null

  const spans = shotSpans(project.shots, project.video.durationMs)

  return (
    <>
      {project.labels.map(label => {
        const name = `<${LABEL_NAME[label.kind]} ${label.index}>`
        return (
          <div
            key={label.id}
            data-track={`references-${label.id}`}
            aria-label={t('references.rowLabel', { label: name })}
            className="relative border-b border-neutral-800"
            style={{ width: msToPx(scale, scale.durationMs), height: REFERENCE_ROW_HEIGHT_PX }}
          >
            {spans.map((span, position) => {
              const present = span.shot.labelRefs.includes(label.id)
              const toggle = () => useProject.getState().apply(
                candidate => toggleLabelInShot(candidate, label.id, span.shot.id))
              return (
                <div
                  key={span.shot.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={present}
                  aria-label={t('references.cell', { label: name, shot: position + 1 })}
                  onClick={toggle}
                  onKeyDown={event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    // Kratka obsłużyła ten klawisz — nie może polecieć dalej do
                    // globalnego skrótu na `window`, gdzie sama spacja przełącza
                    // odtwarzanie.
                    event.stopPropagation()
                    toggle()
                  }}
                  className={`absolute top-1 h-4 rounded-sm border ${
                    present
                      ? 'border-teal-400 bg-teal-500/60'
                      : 'border-neutral-700 bg-neutral-900 hover:border-neutral-500'
                  }`}
                  style={clipBox(scale, { id: span.shot.id, startMs: span.startMs, endMs: span.endMs })}
                />
              )
            })}
          </div>
        )
      })}
    </>
  )
}
