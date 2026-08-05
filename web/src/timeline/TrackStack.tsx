import { useState, type ReactNode } from 'react'
import { useProject } from '../store/projectStore.js'
import { usePlayhead } from '../store/playheadStore.js'
import { useT } from '../i18n/useT.js'
import { msToPx, type Scale } from './scale.js'
import { ShotTrack } from './ShotTrack.js'
import { CameraTrack } from './CameraTrack.js'
import { DialogueTracks, dialogueLaneCount, DIALOGUE_LANE_HEIGHT_PX } from './DialogueTracks.js'
import { ScreenTextTrack, screenTextRowCount, SCREEN_TEXT_ROW_HEIGHT_PX } from './ScreenTextTrack.js'
import { SfxTrack } from './SfxTrack.js'
import { AudioBedTracks } from './AudioBedTracks.js'
import { ReferencesTrack, referenceRowCount, REFERENCE_ROW_HEIGHT_PX } from './ReferencesTrack.js'
import { addCameraMove, addDialogue, addScreenText, addSfx } from './createOnTrack.js'

/** Szerokość kolumny nagłówków — poza `msToPx`, bo nie jest częścią skali czasu. */
const HEADER_WIDTH_PX = 128

/**
 * Jeden wpis kolumny nagłówków i odpowiadający mu wpis obszaru przewijanego.
 * `rowCount` × `unitHeightPx` to wysokość wiersza nagłówka — dla ścieżek o
 * stałej liczbie wierszy (`rowCount: 1`) to zwykła stała wysokość, jak w
 * `CameraTrack`; dla ścieżek, których treść rysuje więcej niż jeden wiersz na
 * wpis (`DialogueTracks`: jeden pas na mówcę plus pas zbiorczy;
 * `ReferencesTrack` w trybie REF: jeden wiersz na etykietę), `rowCount`
 * pochodzi z TEJ SAMEJ funkcji, której używa sama ścieżka do wyrenderowania
 * swoich wierszy (`dialogueLaneCount`/`referenceRowCount`/
 * `screenTextRowCount`) — patrz komentarz nad komponentem niżej, dlaczego to
 * jedyny bezpieczny sposób, żeby te dwie kolumny się nie rozjechały.
 */
interface Row {
  key: string
  title: string
  rowCount: number
  unitHeightPx: number
  render: () => ReactNode
  /** Etykieta i akcja przycisku „+”, jeśli ta ścieżka umie tworzyć nowe obiekty na playheadzie. */
  add?: { label: string; onClick: () => void }
}

interface Props {
  scale: Scale
  /**
   * Linijka i playhead renderują się w `Timeline.tsx` (nie tutaj — ten
   * komponent tylko składa ścieżki z nagłówkami, jak mówi jego interfejs),
   * ale muszą fizycznie leżeć WEWNĄTRZ tego samego przewijanego poziomo
   * kontenera co same ścieżki: playhead ma przecinać cały stos, a oba mają
   * przewijać się razem z klipami, nie stać w miejscu jak nagłówki. Sloty
   * (zamiast np. drugiego, osobno przewijanego kontenera w `Timeline.tsx`)
   * to jedyny sposób osiągnąć to bez duplikowania mechaniki przewijania w
   * dwóch miejscach — a duplikat prowadziłby dokładnie do rozjazdu, przed
   * którym ostrzega reszta tego pliku.
   */
  ruler?: ReactNode
  playhead?: ReactNode
}

/**
 * Nagłówki stoją poza obszarem przewijanym, bo podpis ścieżki musi być
 * widoczny także wtedy, gdy materiał jest przewinięty w prawo. Wysokości obu
 * kolumn muszą się zgadzać wiersz w wiersz — ale „wiersz nagłówka na wpis
 * listy” nie wystarcza, bo trzy ścieżki rysują WIĘCEJ niż jeden wiersz na
 * wpis: `DialogueTracks` (jeden pas na mówcę plus pas zbiorczy — rośnie z
 * każdym dodanym mówcą), `ReferencesTrack` w trybie REF (jeden wiersz na
 * etykietę) i `ScreenTextTrack` (wysokość rośnie z najliczniejszym `ujęciem`
 * pod względem liczby tekstów). Licząc te wysokości NIEZALEŻNIE po obu
 * stronach (np. wpisując `h-8` na sztywno w nagłówku, podczas gdy treść
 * dostaje wysokość z osobnego przeliczenia) obie strony mogłyby się rozjechać
 * przy pierwszym drugim mówcy czy drugiej etykiecie tekstu w ujęciu — stąd
 * `DIALOGUE_LANE_HEIGHT_PX`/`dialogueLaneCount`,
 * `REFERENCE_ROW_HEIGHT_PX`/`referenceRowCount` i
 * `SCREEN_TEXT_ROW_HEIGHT_PX`/`screenTextRowCount` są WYSTAWIONE z tych
 * ścieżek i to jest jedyne miejsce w tym pliku, gdzie liczba/wysokość wierszy
 * jest liczona — ten sam wzór, którego samą ścieżka używa do własnej
 * wysokości, nie jego kopia.
 *
 * Pejzaż i muzyka (`AudioBedTracks`) to w treści zadania DWA osobne rodzaje
 * ścieżek, nie jeden wpis z dwoma wierszami — dostają więc DWA osobne wpisy
 * `rows` (każdy `rowCount: 1`), każdy z własnym zwijaniem. Component
 * `AudioBedTracks` rysuje oba pasy naraz, więc dostaje `only`, żeby jedno
 * wywołanie rysowało tylko swój pas — bez tego treść jednego wpisu `rows`
 * niosłaby DWA wiersze DOM-u, a nagłówek tego wpisu — jeden, dokładnie ten
 * sam rozjazd, przed którym ostrzega akapit wyżej.
 *
 * Grupa referencji dostaje `Math.max(1, …)`, żeby nagłówek „Referencje”
 * (`timeline.trackReferences` — dotąd bez czytelnika, patrz treść zadania)
 * został widoczny nawet w projekcie bez żadnej etykiety; `ReferencesTrack`
 * sama w takim razie nie rysuje żadnego wiersza, więc treść ma wtedy 0 px, a
 * nagłówek — wysokość jednego pustego wiersza. Świadomy, ograniczony
 * wyjątek dla stanu pustego (ten sam wzorzec co `Math.max(1, …)` w
 * `screenTextRowCount`), nie rozjazd: liczba wierszy wciąż pochodzi z JEDNEJ
 * funkcji, `Math.max` tylko podnosi dolną granicę.
 *
 * Zwinięcie działa na cały wpis `rows` naraz (nie na pojedynczy pas mówcy czy
 * pojedynczą etykietę) — `DialogueTracks`/`ReferencesTrack` renderują się
 * jednym wywołaniem, więc zwinięcie wpisu chowa całe wywołanie. Dla wpisów
 * wieloliniowych (dialog, referencje) nagłówek NIE kurczy się do zera po
 * zwinięciu — zostaje pełnej wysokości, jak pojedyncza ścieżka w brzmieniu
 * zadania („zwinięcie chowa klipy, ale zostawia nagłówek”); to jedyny
 * przycisk zwijania na cały pas, więc musi mieć gdzie stać.
 */
export function TrackStack({ scale, ruler, playhead }: Props) {
  const t = useT()
  const project = useProject(state => state.project)
  const [collapsed, setCollapsed] = useState<readonly string[]>([])

  if (!project) return null

  const rows: Row[] = [
    { key: 'shots', title: t('timeline.trackShots'), rowCount: 1, unitHeightPx: 40, render: () => <ShotTrack scale={scale} /> },
    {
      key: 'camera', title: t('timeline.trackCamera'), rowCount: 1, unitHeightPx: 32,
      render: () => <CameraTrack scale={scale} />,
      add: {
        label: t('track.addCamera'),
        onClick: () => useProject.getState().apply(candidate => addCameraMove(candidate, usePlayhead.getState().ms)),
      },
    },
    {
      key: 'dialogue', title: t('timeline.trackDialogueAll'),
      rowCount: dialogueLaneCount(project), unitHeightPx: DIALOGUE_LANE_HEIGHT_PX,
      render: () => <DialogueTracks scale={scale} />,
      add: {
        // `null` — bez wyboru mówcy, jak dotąd tylko pas zbiorczy umiał
        // dodawać (patrz `DialogueTracks.tsx` sprzed tego zadania); wybór
        // konkretnego mówcy zostaje ręczną edycją w inspektorze.
        label: t('track.addDialogue'),
        onClick: () => useProject.getState().apply(candidate => addDialogue(candidate, usePlayhead.getState().ms, null)),
      },
    },
    {
      key: 'screenText', title: t('timeline.trackScreenText'),
      rowCount: screenTextRowCount(project), unitHeightPx: SCREEN_TEXT_ROW_HEIGHT_PX,
      render: () => <ScreenTextTrack scale={scale} />,
      add: {
        label: t('track.addScreenText'),
        onClick: () => useProject.getState().apply(candidate => addScreenText(candidate, usePlayhead.getState().ms)),
      },
    },
    {
      key: 'sfx', title: t('timeline.trackSfx'), rowCount: 1, unitHeightPx: 32,
      render: () => <SfxTrack scale={scale} />,
      add: {
        label: t('track.addSfx'),
        onClick: () => useProject.getState().apply(candidate => addSfx(candidate, usePlayhead.getState().ms)),
      },
    },
    {
      key: 'soundscape', title: t('timeline.trackSoundscape'), rowCount: 1, unitHeightPx: 32,
      render: () => <AudioBedTracks scale={scale} only="overallSoundscape" />,
    },
    {
      key: 'music', title: t('timeline.trackMusic'), rowCount: 1, unitHeightPx: 32,
      render: () => <AudioBedTracks scale={scale} only="nonDiegeticMusic" />,
    },
    ...(project.mode === 'REF'
      ? [{
          key: 'references', title: t('timeline.trackReferences'),
          rowCount: Math.max(1, referenceRowCount(project)), unitHeightPx: REFERENCE_ROW_HEIGHT_PX,
          render: () => <ReferencesTrack scale={scale} />,
        }]
      : []),
  ]

  const isCollapsed = (key: string): boolean => collapsed.includes(key)
  const toggle = (key: string): void => setCollapsed(current =>
    (current.includes(key) ? current.filter(entry => entry !== key) : [...current, key]))

  return (
    <div aria-label={t('timeline.tracks')} className="flex">
      <div data-headers className="shrink-0 border-r border-neutral-800" style={{ width: HEADER_WIDTH_PX }}>
        {rows.map(row => (
          <div
            key={row.key}
            data-header-row={row.key}
            data-rows={row.rowCount}
            style={{ height: row.rowCount * row.unitHeightPx }}
            className="flex items-center justify-between gap-1 border-b border-neutral-800 px-2 py-1 text-[10px]"
          >
            <span className="truncate">{row.title}</span>
            <span className="flex shrink-0 items-center gap-1">
              {row.add && (
                <button
                  type="button"
                  aria-label={row.add.label}
                  onClick={row.add.onClick}
                  className="px-1 text-neutral-400 hover:text-neutral-100"
                >
                  +
                </button>
              )}
              <button
                type="button"
                aria-label={isCollapsed(row.key)
                  ? t('timeline.expand', { track: row.title })
                  : t('timeline.collapse', { track: row.title })}
                onClick={() => toggle(row.key)}
                className="px-1 text-neutral-400 hover:text-neutral-100"
              >
                {isCollapsed(row.key) ? '▸' : '▾'}
              </button>
            </span>
          </div>
        ))}
      </div>
      <div data-scroller className="relative flex-1 overflow-x-auto">
        <div className="relative" style={{ width: msToPx(scale, scale.durationMs) }}>
          {ruler}
          {rows.map(row => (
            <div key={row.key} data-content-row={row.key}>
              {isCollapsed(row.key) ? null : row.render()}
            </div>
          ))}
          {playhead}
        </div>
      </div>
    </div>
  )
}
