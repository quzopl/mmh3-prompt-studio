import { useProject } from '../store/projectStore.js'
import { same, useSelection } from '../store/selectionStore.js'
import { useT } from '../i18n/useT.js'
import { msToPx, type Scale } from './scale.js'
import { clipBox } from './clips.js'
import { useDragClip } from './useDragClip.js'
import { shotSpans } from './spans.js'

/** Wysokość ścieżki jako liczba — `TrackStack` (zadanie 12) liczy z TEJ SAMEJ stałej, nie z osobnej klasy `h-8`. */
export const SFX_TRACK_HEIGHT_PX = 32

/**
 * Dźwięk diegetyczny nie jest przywiązany do własnego ujęcia — żadna reguła
 * walidatora tego nie wymaga (patrz `shared/src/validate/rules/audio.ts`:
 * jedyne reguły dotyczące `diegeticSfx` liczą, czy coś w ogóle brzmi, nie
 * gdzie leży w czasie), a krok wchodzący w następne ujęcie jest zwyczajnym
 * zabiegiem montażowym. Ograniczeniem gestu jest więc materiał (`0` do
 * `scale.durationMs`), nie rozpiętość ujęcia — jak kwestia dialogowa w
 * `DialogueTracks`, nie jak ruch kamery w `CameraTrack`.
 *
 * Trzy decyzje z `CameraTrack` przenoszą się tu bez zmian: etykieta klipu
 * niesie numer dźwięku w obrębie własnego ujęcia (sam opis nie rozróżnia
 * dwóch dźwięków o identycznej treści w tym samym ujęciu — model tego nie
 * zabrania, tak jak nie zabrania dwóch identycznych ruchów kamery); Shift+klik
 * dokłada do zaznaczenia zamiast je zastępować; a uchwyty krawędzi to
 * `role="separator"` bez `tabIndex` — zmiana rozmiaru klawiaturą nie istnieje
 * nigdzie w tej maszynerii klipów.
 *
 * Renderowanie po posortowanej KOPII (`sorted` niżej), nie po `sounds` prosto
 * z modelu — jak w `DialogueTracks`: przeciągnięcie zmienia `startMs`/`endMs`
 * przez `write`, nigdy kolejność w `shot.diegeticSfx`, a dźwięki mogą się
 * nachodzić (patrz akapit wyżej), więc kolejność w DOM-ie musi iść za czasem,
 * żeby klip późniejszy w czasie malował się NAD wcześniejszym, a Tab
 * odwiedzał klipy od lewej do prawej.
 */
export function SfxTrack({ scale }: { scale: Scale }) {
  const t = useT()
  const project = useProject(state => state.project)
  const selected = useSelection(state => state.selected)
  const select = useSelection(state => state.select)
  const toggle = useSelection(state => state.toggle)

  const spans = project ? shotSpans(project.shots, project.video.durationMs) : []

  const findSound = (soundId: string) => {
    for (const span of spans) {
      const sound = span.shot.diegeticSfx.find(candidate => candidate.id === soundId)
      if (sound) return { span, sound }
    }
    return undefined
  }

  const startDrag = useDragClip(scale, {
    read: soundId => {
      const found = findSound(soundId)
      return found && { id: soundId, startMs: found.sound.startMs, endMs: found.sound.endMs }
    },
    // Cały materiał, nie własne ujęcie — patrz komentarz nad komponentem.
    bounds: () => ({ lowestMs: 0, highestMs: scale.durationMs }),
    snapPoints: () => spans.map(span => span.startMs),
    toleranceMs: 80,
    write: (soundId, next, coalesceKey) => {
      useProject.getState().apply(
        candidate => ({
          ...candidate,
          shots: candidate.shots.map(shot => ({
            ...shot,
            diegeticSfx: shot.diegeticSfx.map(sound =>
              sound.id === soundId ? { ...sound, ...next } : sound),
          })),
        }),
        { coalesceKey },
      )
    },
  })

  if (!project) return null

  const sounds = spans.flatMap(span =>
    span.shot.diegeticSfx.map((sound, position) => ({ span, sound, position })))
  const sorted = [...sounds].sort((a, b) => a.sound.startMs - b.sound.startMs)

  return (
    <div
      data-track="sfx"
      aria-label={t('timeline.trackSfx')}
      className="relative border-b border-neutral-800"
      style={{ width: msToPx(scale, scale.durationMs), height: SFX_TRACK_HEIGHT_PX }}
    >
      {sorted.map(({ span, sound, position }) => {
        const ref = { kind: 'sfx' as const, id: sound.id }
        const isSelected = selected.some(candidate => same(candidate, ref))
        const label = t('sfx.clipLabel', {
          description: sound.description,
          // 1-liczbowy numer dźwięku w obrębie WŁASNEGO ujęcia — patrz
          // komentarz nad komponentem.
          position: position + 1,
          shot: span.shot.index + 1,
        })
        return (
          <div
            key={sound.id}
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            aria-label={label}
            onClick={event => (event.shiftKey ? toggle(ref) : select(ref))}
            onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              // Jak w `ShotTrack`/`CameraTrack`: klip obsłużył ten klawisz, więc
              // nie może polecieć dalej do globalnego skrótu na `window`, gdzie
              // sama spacja przełącza odtwarzanie.
              event.stopPropagation()
              select(ref)
            }}
            onPointerDown={event => startDrag(sound.id, 'move', event)}
            className={`absolute top-1 h-6 rounded border px-1 text-left text-[10px] ${
              isSelected
                ? 'border-cyan-500 bg-cyan-950 text-cyan-100'
                : 'border-neutral-700 bg-neutral-900 hover:border-neutral-500'
            }`}
            style={clipBox(scale, sound)}
          >
            <span className="block h-full overflow-hidden">{sound.description}</span>
            <div
              role="separator"
              aria-label={t('sfx.dragStart', { description: sound.description })}
              onPointerDown={event => startDrag(sound.id, 'start', event)}
              className="absolute inset-y-0 left-0 w-1 cursor-ew-resize bg-cyan-500/40"
            />
            <div
              role="separator"
              aria-label={t('sfx.dragEnd', { description: sound.description })}
              onPointerDown={event => startDrag(sound.id, 'end', event)}
              className="absolute inset-y-0 right-0 w-1 cursor-ew-resize bg-cyan-500/40"
            />
          </div>
        )
      })}
    </div>
  )
}
