import { useProject } from '../store/projectStore.js'
import { same, useSelection } from '../store/selectionStore.js'
import { useT } from '../i18n/useT.js'
import type { TKey } from '../i18n/dict.js'
import { msToPx, type Scale } from './scale.js'

/**
 * Pejzaż dźwiękowy i muzyka opisują całe wideo, nie jego fragment — w modelu
 * to dwa pola tekstowe (`project.audio.overallSoundscape` i
 * `nonDiegeticMusic`), nie obiekty o czasach. Ich klipy nie mają więc krawędzi
 * do przeciągania (brak `onPointerDown`, brak uchwytów granic) i pokrywają
 * cały materiał: pokazują treść i otwierają inspektor. Rysowanie ich jako
 * przeciągalnych sugerowałoby możliwość, której model nie ma.
 *
 * Dwie z trzech reguł szablonu z `CameraTrack` NIE mają tu zastosowania i
 * celowo ich nie ma: etykieta nie niesie numeru porządkowego, bo jest
 * dokładnie jeden pejzaż i jedna muzyka na projekt — nic nie trzeba
 * odróżniać, w przeciwieństwie do kilku ruchów kamery czy tekstów w jednym
 * ujęciu; a uchwytów krawędzi nie ma wcale, bo nie ma czego przeciągać
 * (patrz akapit wyżej).
 *
 * Pozostałe dwie decyzje przenoszą się bez zmian: Shift+klik dokłada do
 * zaznaczenia zamiast je zastępować, jak w `ShotTrack`/`CameraTrack`; a klip
 * jest `role="button"` z jawną obsługą klawiatury zamiast natywnego
 * `<button>`, jak w `ScreenTextTrack` — spacja na natywnym przycisku nie
 * zatrzymałaby się na `stopPropagation` i poleciałaby dalej do
 * `useTimelineShortcuts` na `window`, gdzie przełącza odtwarzanie jako efekt
 * uboczny aktywacji klipu.
 *
 * Identyfikatory w `ObjectRef` to NAZWY PÓL modelu (`overallSoundscape`,
 * `nonDiegeticMusic`), nie wymyślone przez ten komponent skróty. Te same
 * identyfikatory nosi już `{ kind: 'audio', id: … }` w diagnostykach
 * `shared/src/validate/rules/audio.ts` — gdyby ścieżka wymyśliła własne (np.
 * `soundscape`/`music`), klik w diagnostykę w `ValidationPanel` (który woła
 * `select(diagnostic.ref)`) ustawiałby zaznaczenie, którego `same()` nigdy by
 * tu nie dopasował. Byłaby to jedyna ścieżka w całej maszynerii klipów, na
 * której przejście z panelu walidacji do klipu by nie działało — wszystkie
 * pozostałe (`camera`, `dialogue`, `screenText`, `sfx`, `shot`, `speaker`)
 * niosą w diagnostyce identyfikator tego samego obiektu modelu, po który
 * sięga ich klip.
 *
 * Sama akcja tej ścieżki (zaznaczenie) nigdy nie woła `useProject.apply` —
 * `select`/`toggle` piszą wyłącznie do `useSelection`, więc nie ma śladu,
 * po którym walidator mógłby cokolwiek przeliczyć. `SOUNDSCAPE_NA_ONLY_IF_SILENT`
 * (jedyna reguła audio wrażliwa na kontekst, nie tylko na treść własnego pola)
 * czyta treść `overallSoundscape` i obecność dialogu/SFX w ujęciach — żadne z
 * nich zaznaczenie nie zmienia.
 *
 * Pusty opis renderuje się jako `audio.empty` w treści widocznej — ale ta
 * sama treść wchodzi też parametrem `{text}` do etykiety dostępnej
 * (`audio.soundscapeClip`/`audio.musicClip`), tak jak `text`/`description` w
 * etykietach innych ścieżek. Stały `aria-label` bez parametru zostawiłby
 * czytnik ekranu bez informacji, którą osoba widząca odczytuje wprost z
 * klipu („nie opisano").
 */
/** Identyfikator pola modelu za jednym z dwóch pasów — patrz komentarz nad komponentem. */
export type AudioBedId = 'overallSoundscape' | 'nonDiegeticMusic'

/** Wysokość jednego pasa jako liczba — `TrackStack` (zadanie 12) liczy z TEJ SAMEJ stałej, nie z osobnej klasy `h-8`. */
export const AUDIO_BED_HEIGHT_PX = 32

interface Props {
  scale: Scale
  /**
   * `TrackStack` (zadanie 12) daje pejzażowi i muzyce osobne wiersze
   * nagłówka z osobnym zwijaniem — a te dwa pasy dziś rysuje JEDEN
   * komponent. `only` pozwala TEJ SAMEJ liście `beds` niżej (jedno źródło
   * etykiet i treści dla obu pasów, patrz komentarz nad komponentem) wydać
   * tylko jeden z dwóch wierszy DOM-u na jedno wywołanie, więc
   * `TrackStack` woła komponent dwukrotnie (raz na pas) zamiast dostawać
   * oba pasy sklejone w jednym wierszu treści, którego wiersz nagłówka nie
   * dałby się dopasować 1:1. Bez parametru (jak dotąd) renderują się oba —
   * zachowanie sprzed zadania 12 i istniejące testy tego komponentu.
   */
  only?: AudioBedId
}

export function AudioBedTracks({ scale, only }: Props) {
  const t = useT()
  const project = useProject(state => state.project)
  const selected = useSelection(state => state.selected)
  const select = useSelection(state => state.select)
  const toggle = useSelection(state => state.toggle)

  if (!project) return null

  const width = msToPx(scale, scale.durationMs)

  // Adnotacja typu na `allBeds`, PRZED `.filter` — kontekst typu z adnotacji
  // na `const x: T = wyrażenie` nie przechodzi przez wywołanie metody
  // (`.filter(...)` na literale tablicy), więc literały obiektów niżej
  // dostałyby poszerzone `id: string` zamiast `AudioBedId`, gdyby adnotacja
  // stała dopiero na wyniku `.filter`.
  const allBeds: Array<{ id: AudioBedId; dataTrack: string; trackLabel: string; labelKey: TKey; text: string }> = [
    {
      id: 'overallSoundscape',
      dataTrack: 'audio-soundscape',
      trackLabel: t('timeline.trackSoundscape'),
      labelKey: 'audio.soundscapeClip',
      text: project.audio.overallSoundscape,
    },
    {
      id: 'nonDiegeticMusic',
      dataTrack: 'audio-music',
      trackLabel: t('timeline.trackMusic'),
      labelKey: 'audio.musicClip',
      text: project.audio.nonDiegeticMusic,
    },
  ]
  const beds = allBeds.filter(bed => only === undefined || bed.id === only)

  return (
    <>
      {beds.map(bed => {
        const ref = { kind: 'audio' as const, id: bed.id }
        const isSelected = selected.some(candidate => same(candidate, ref))
        const displayText = bed.text === '' ? t('audio.empty') : bed.text
        const label = t(bed.labelKey, { text: displayText })
        return (
          <div
            key={bed.id}
            data-track={bed.dataTrack}
            aria-label={bed.trackLabel}
            className="relative border-b border-neutral-800"
            style={{ width, height: AUDIO_BED_HEIGHT_PX }}
          >
            <div
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={label}
              onClick={event => (event.shiftKey ? toggle(ref) : select(ref))}
              onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                // Jak w `ScreenTextTrack`: klip obsłużył ten klawisz, więc nie
                // może polecieć dalej do globalnego skrótu na `window`, gdzie
                // sama spacja przełącza odtwarzanie.
                event.stopPropagation()
                select(ref)
              }}
              className={`absolute top-1 h-6 overflow-hidden rounded border px-2 text-left text-[10px] ${
                isSelected
                  ? 'border-fuchsia-500 bg-fuchsia-950 text-fuchsia-100'
                  : 'border-neutral-700 bg-neutral-900 hover:border-neutral-500'
              }`}
              style={{ left: 0, width }}
            >
              {bed.text === '' ? <span className="text-neutral-500">{displayText}</span> : bed.text}
            </div>
          </div>
        )
      })}
    </>
  )
}
