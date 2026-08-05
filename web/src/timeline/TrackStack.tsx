import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { useProject } from '../store/projectStore.js'
import { usePlayhead } from '../store/playheadStore.js'
import { useT } from '../i18n/useT.js'
import { msToPx, type Scale } from './scale.js'
import { ShotTrack, SHOT_TRACK_HEIGHT_PX } from './ShotTrack.js'
import { CameraTrack, CAMERA_TRACK_HEIGHT_PX } from './CameraTrack.js'
import { DialogueTracks, dialogueLaneCount, DIALOGUE_LANE_HEIGHT_PX } from './DialogueTracks.js'
import { ScreenTextTrack, screenTextRowCount, SCREEN_TEXT_ROW_HEIGHT_PX } from './ScreenTextTrack.js'
import { SfxTrack, SFX_TRACK_HEIGHT_PX } from './SfxTrack.js'
import { AudioBedTracks, AUDIO_BED_HEIGHT_PX } from './AudioBedTracks.js'
import { ReferencesTrack, referenceRowCount, REFERENCE_ROW_HEIGHT_PX } from './ReferencesTrack.js'
import { RULER_HEIGHT_PX } from './Ruler.js'
import { addCameraMove, addDialogue, addScreenText, addSfx } from './createOnTrack.js'

/**
 * Szerokość kolumny nagłówków — poza `msToPx`, bo nie jest częścią skali
 * czasu. Wystawiona: `Timeline.tsx` odejmuje ją od zmierzonej szerokości
 * kontenera przy liczeniu zoomu „Dopasuj” (runda poprawek 1, znalezisko 4) —
 * bez tego „Dopasuj” traktowałoby całą zmierzoną szerokość (nagłówki +
 * klipy) jako należącą do samych klipów i produkowało poziomy suwak.
 */
export const HEADER_WIDTH_PX = 128

/**
 * Jeden wpis kolumny nagłówków i odpowiadający mu wpis obszaru przewijanego.
 * `unitHeightPx` w KAŻDYM wpisie pochodzi ze stałej WYSTAWIONEJ z tej samej
 * ścieżki, której komponent faktycznie renderuje tę wysokość jako `style`
 * (nie jako osobną klasę Tailwind gdzie indziej) — `SHOT_TRACK_HEIGHT_PX`,
 * `CAMERA_TRACK_HEIGHT_PX`, `DIALOGUE_LANE_HEIGHT_PX`,
 * `SCREEN_TEXT_ROW_HEIGHT_PX`, `SFX_TRACK_HEIGHT_PX`, `AUDIO_BED_HEIGHT_PX`,
 * `REFERENCE_ROW_HEIGHT_PX`. Runda poprawek 1 (recenzja w Chromium) złapała
 * dwa niezależne wpisane na sztywno „32”/„40” w tym pliku, które nigdy nie
 * były sprawdzane względem tego, co dana ścieżka NAPRAWDĘ rysuje — literały
 * usunięte, każdy wiersz niżej niesie import, nie liczbę.
 *
 * `rowCount` — dla ścieżek o stałej liczbie wierszy (`rowCount: 1`) to
 * zwykłe „jeden”; dla ścieżek, których treść rysuje więcej niż jeden wiersz
 * na wpis (`DialogueTracks`: jeden pas na mówcę plus pas zbiorczy;
 * `ReferencesTrack` w trybie REF: jeden wiersz na etykietę), pochodzi z TEJ
 * SAMEJ funkcji, której używa sama ścieżka do wyrenderowania swoich wierszy
 * (`dialogueLaneCount`/`referenceRowCount`/`screenTextRowCount`) — patrz
 * komentarz nad komponentem niżej.
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
   *
   * Runda poprawek 1: `ruler` renderuje się jako PIERWSZE dziecko w obszarze
   * przewijanym, przed wierszami ścieżek — a kolumna nagłówków nie miała
   * odpowiednika. Efekt (złapany w Chromium): każdy wiersz treści siedział
   * `RULER_HEIGHT_PX` niżej niż jego nagłówek, od pierwszej klatki. Nagłówki
   * dostają teraz odstępnik dokładnie tej wysokości, WYSTAWIONEJ z
   * `Ruler.tsx` — ta sama stała, którą sama linijka faktycznie renderuje.
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
 * stronach obie strony mogłyby się rozjechać przy pierwszym drugim mówcy czy
 * drugiej etykiecie tekstu w ujęciu.
 *
 * Pejzaż i muzyka (`AudioBedTracks`) to w treści zadania DWA osobne rodzaje
 * ścieżek, nie jeden wpis z dwoma wierszami — dostają więc DWA osobne wpisy
 * `rows` (każdy `rowCount: 1`), każdy z własnym zwijaniem. Component
 * `AudioBedTracks` rysuje oba pasy naraz, więc dostaje `only`, żeby jedno
 * wywołanie rysowało tylko swój pas.
 *
 * Grupa referencji dostaje `Math.max(1, …)`, żeby nagłówek „Referencje”
 * (`timeline.trackReferences` — dotąd bez czytelnika, patrz treść zadania)
 * został widoczny nawet w projekcie bez żadnej etykiety. Świadomy,
 * ograniczony wyjątek dla stanu pustego (ten sam wzorzec co `Math.max(1, …)`
 * w `screenTextRowCount`), nie rozjazd: liczba wierszy wciąż pochodzi z
 * JEDNEJ funkcji, `Math.max` tylko podnosi dolną granicę.
 *
 * `rowHeightPx` niżej to JEDYNE miejsce, gdzie wysokość wiersza (nagłówka
 * ALBO treści) jest liczona — runda poprawek 1 (recenzja w Chromium) złapała
 * błąd, w którym nagłówek zwiniętego wiersza zostawał pełnej wysokości
 * (`rowCount × unitHeightPx`), a treść znikała do zera: wszystko PONIŻEJ
 * zwiniętego wiersza przesuwało się o jego pełną wysokość, a błąd się
 * kumulował z każdym kolejnym zwinięciem. Teraz OBIE strony (styl wiersza
 * nagłówka i odstępnik treści przy zwinięciu) wołają tę samą funkcję z tym
 * samym stanem zwinięcia — zwinięty wiersz ma wysokość `unitHeightPx`
 * (jeden wiersz — nagłówek zostaje czytelny, jak wymaga brzmienie zadania
 * „zwinięcie chowa klipy, ale zostawia nagłówek”) po OBU stronach naraz,
 * nie zero po jednej i pełną wysokość po drugiej.
 */
export function TrackStack({ scale, ruler, playhead }: Props) {
  const t = useT()
  const project = useProject(state => state.project)
  const [collapsed, setCollapsed] = useState<readonly string[]>([])

  if (!project) return null

  const rows: Row[] = [
    { key: 'shots', title: t('timeline.trackShots'), rowCount: 1, unitHeightPx: SHOT_TRACK_HEIGHT_PX, render: () => <ShotTrack scale={scale} /> },
    {
      key: 'camera', title: t('timeline.trackCamera'), rowCount: 1, unitHeightPx: CAMERA_TRACK_HEIGHT_PX,
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
        // `null` — „bez wskazania mówcy", nie „bez mówcy": `addDialogue`
        // bierze wtedy PIERWSZEGO mówcę projektu, a gdy projekt nie ma
        // jeszcze żadnego, tworzy minimalnego w tym samym geście (patrz
        // komentarz przy `addDialogue` w `createOnTrack.ts` — recenzja
        // końcowa, znalezisko 1). Kwestia bez mówcy nie jest ważnym
        // dokumentem, więc przycisk nie ma jak jej stworzyć; wybór innego
        // mówcy zostaje ręczną edycją.
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
      key: 'sfx', title: t('timeline.trackSfx'), rowCount: 1, unitHeightPx: SFX_TRACK_HEIGHT_PX,
      render: () => <SfxTrack scale={scale} />,
      add: {
        label: t('track.addSfx'),
        onClick: () => useProject.getState().apply(candidate => addSfx(candidate, usePlayhead.getState().ms)),
      },
    },
    {
      key: 'soundscape', title: t('timeline.trackSoundscape'), rowCount: 1, unitHeightPx: AUDIO_BED_HEIGHT_PX,
      render: () => <AudioBedTracks scale={scale} only="overallSoundscape" />,
    },
    {
      key: 'music', title: t('timeline.trackMusic'), rowCount: 1, unitHeightPx: AUDIO_BED_HEIGHT_PX,
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

  // Jedyne miejsce, gdzie liczy się wysokość wiersza — patrz komentarz nad komponentem.
  const rowHeightPx = (row: Row): number => (isCollapsed(row.key) ? row.unitHeightPx : row.rowCount * row.unitHeightPx)

  /**
   * Aktywacja klawiaturą dla `role="button"` w tej kolumnie — jak w
   * `CameraTrack`/`ReferencesTrack`. Native `<button>` nie wystarczy: sama
   * spacja na natywnym przycisku i tak bąbelkuje do `window`, gdzie
   * `useTimelineShortcuts` woła `preventDefault` na KAŻDEJ spacji bez
   * modyfikatora i przełącza odtwarzanie — czwarty raz w tym planie (po
   * zadaniach 9, 10 i 11) złapany dokładnie ten sam błąd. `stopPropagation`
   * musi więc polecieć TU, zanim zdarzenie w ogóle dotrze do `window`.
   */
  const activateOnKey = (action: () => void) => (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    action()
  }

  return (
    <div aria-label={t('timeline.tracks')} className="flex">
      <div data-headers className="shrink-0 border-r border-neutral-800" style={{ width: HEADER_WIDTH_PX }}>
        {ruler && (
          <div
            data-header-row="ruler"
            aria-hidden="true"
            className="border-b border-neutral-800"
            style={{ height: RULER_HEIGHT_PX }}
          />
        )}
        {rows.map(row => (
          <div
            key={row.key}
            data-header-row={row.key}
            style={{ height: rowHeightPx(row) }}
            className="flex items-center justify-between gap-1 border-b border-neutral-800 px-2 py-1 text-[10px]"
          >
            <span className="truncate">{row.title}</span>
            <span className="flex shrink-0 items-center gap-1">
              {row.add && (
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={row.add.label}
                  onClick={row.add.onClick}
                  onKeyDown={activateOnKey(row.add.onClick)}
                  className="cursor-pointer px-1 text-neutral-400 hover:text-neutral-100"
                >
                  +
                </div>
              )}
              <div
                role="button"
                tabIndex={0}
                aria-expanded={!isCollapsed(row.key)}
                aria-label={isCollapsed(row.key)
                  ? t('timeline.expand', { track: row.title })
                  : t('timeline.collapse', { track: row.title })}
                onClick={() => toggle(row.key)}
                onKeyDown={activateOnKey(() => toggle(row.key))}
                className="cursor-pointer px-1 text-neutral-400 hover:text-neutral-100"
              >
                {isCollapsed(row.key) ? '▸' : '▾'}
              </div>
            </span>
          </div>
        ))}
      </div>
      <div data-scroller className="relative flex-1 overflow-x-auto">
        <div className="relative" style={{ width: msToPx(scale, scale.durationMs) }}>
          {ruler}
          {rows.map(row => (
            <div
              key={row.key}
              data-content-row={row.key}
              style={isCollapsed(row.key) ? { height: rowHeightPx(row) } : undefined}
            >
              {isCollapsed(row.key) ? null : row.render()}
            </div>
          ))}
          {playhead}
        </div>
      </div>
    </div>
  )
}
