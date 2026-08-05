import type { DialogueEvent } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { same, useSelection } from '../store/selectionStore.js'
import { useSpeechRate } from '../store/speechRateStore.js'
import { useT } from '../i18n/useT.js'
import { msToPx, type Scale } from './scale.js'
import { clipBox } from './clips.js'
import { useDragClip } from './useDragClip.js'
import { shotSpans } from './spans.js'
import { naturalDurationMs } from './speech.js'

/**
 * Kwestia dwóch mówców pojawia się w obu pasach — to ta sama kwestia widziana
 * dwa razy, nie dwie kwestie. `read`/`bounds`/`snapPoints`/`write` w
 * `useDragClip` przyjmują identyfikator KWESTII (nie pasa), a `write` szuka
 * jej po id w całym projekcie — więc klucz sklejania historii w
 * `useProject.apply` pochodzi z tożsamości kwestii, nie z pasa, w którym
 * akurat zaczęto gest. Dwa osobne gesty na tym samym obiekcie (jeden zaczęty
 * w pasie mówcy A, drugi w pasie mówcy B) zostają więc dwoma osobnymi wpisami
 * cofania — tak jak dwa osobne gesty gdziekolwiek indziej — a nie sklejają
 * się ani nie rozjeżdżają w dwie niezależne kopie.
 *
 * `bounds` obejmuje cały materiał (`0` do `scale.durationMs`), nie własne
 * ujęcie jak w `CameraTrack` — kwestia świadomie może przekroczyć cięcie:
 * model tego nie zabrania (żadna reguła walidatora nie wymaga, żeby kwestia
 * mieściła się w jednym ujęciu) i późniejsze zadanie w planie proponuje na
 * taką sytuację `<scenetrans>`. Zawężenie granic gestu do własnego ujęcia,
 * jak przy ruchu kamery, zamknęłoby tę furtkę bez potrzeby.
 *
 * Trzy decyzje z `CameraTrack` przenoszą się tu bez zmian, jako wzorzec dla
 * tej samej maszynerii klipów: etykieta klipu niesie numer kwestii w obrębie
 * własnego ujęcia (sam mówca i tekst nie rozróżniają dwóch kwestii — dwie
 * kwestie tego samego mówcy o identycznym tekście są dopuszczalne przez
 * model, dokładnie jak dwa ruchy kamery tego samego typu); Shift+klik dokłada
 * do zaznaczenia zamiast je zastępować, jak w `ShotTrack`; a uchwyty krawędzi
 * to `role="separator"` bez `tabIndex` z tego samego powodu co tam — zmiana
 * rozmiaru klawiaturą nie istnieje nigdzie w tej maszynerii klipów.
 *
 * Pas renderuje się dla każdego mówcy z listy projektu i osobno dla kwestii
 * bez mówcy, NAWET gdy akurat jest pusty — to stały wiersz przypisany do
 * stałego elementu projektu (mówcy albo „reszty”), a nie widok filtrowany po
 * bieżącej zawartości. Znikający i pojawiający się wiersz przy każdej zmianie
 * przypisania mówcy w kwestii byłby mylący; puste pasy są normalne w
 * edytorach wideo (pusty pas dźwiękowy nie znika, gdy nic na nim nie leży).
 */
export function DialogueTracks({ scale }: { scale: Scale }) {
  const t = useT()
  const project = useProject(state => state.project)
  const selected = useSelection(state => state.selected)
  const select = useSelection(state => state.select)
  const toggle = useSelection(state => state.toggle)
  // Subskrypcja, nie `useSpeechRate.getState()` w ciele pętli renderu — ten
  // sam błąd znaleziony już dwa razy w tym projekcie (`state.isSelected` w
  // `ShotTrack` i w `PromptPanel`): odczyt przez `getState()` w renderze nie
  // rejestruje komponentu jako subskrybenta, więc zmiana tempa w store nie
  // przemalowałaby cienia ani ostrzeżenia.
  const wordsPerMinute = useSpeechRate(state => state.wordsPerMinute)

  const spans = project ? shotSpans(project.shots, project.video.durationMs) : []

  const findEvent = (eventId: string) => {
    for (const span of spans) {
      const event = span.shot.dialogue.find(candidate => candidate.id === eventId)
      if (event) return { span, event }
    }
    return undefined
  }

  const startDrag = useDragClip(scale, {
    read: eventId => {
      const found = findEvent(eventId)
      return found && { id: eventId, startMs: found.event.startMs, endMs: found.event.endMs }
    },
    // Cały materiał, nie własne ujęcie — patrz komentarz nad komponentem.
    bounds: () => ({ lowestMs: 0, highestMs: scale.durationMs }),
    snapPoints: () => spans.map(span => span.startMs),
    toleranceMs: 80,
    write: (eventId, next, coalesceKey) => {
      useProject.getState().apply(
        candidate => ({
          ...candidate,
          shots: candidate.shots.map(shot => ({
            ...shot,
            dialogue: shot.dialogue.map(event =>
              event.id === eventId ? { ...event, ...next } : event),
          })),
        }),
        { coalesceKey },
      )
    },
  })

  if (!project) return null

  const codeOf = (event: DialogueEvent): string =>
    event.speakerIds
      .map(id => project.speakers.find(speakerRecord => speakerRecord.id === id)?.code ?? id)
      .join(', ')

  const lanes: Array<{ key: string; label: string; matches: (event: DialogueEvent) => boolean }> = [
    ...project.speakers.map(speakerRecord => ({
      key: speakerRecord.id,
      label: t('timeline.trackDialogue', { speaker: speakerRecord.code }),
      matches: (event: DialogueEvent) => event.speakerIds.includes(speakerRecord.id),
    })),
    {
      key: 'none',
      label: t('timeline.trackDialogueOther'),
      matches: (event: DialogueEvent) => event.speakerIds.length === 0,
    },
  ]

  return (
    <>
      {lanes.map(lane => (
        <div
          key={lane.key}
          data-track={`dialogue-${lane.key}`}
          aria-label={lane.label}
          className="relative h-8 border-b border-neutral-800"
          style={{ width: msToPx(scale, scale.durationMs) }}
        >
          {spans.flatMap(span => span.shot.dialogue
            .map((event, position) => ({ event, position }))
            .filter(({ event }) => lane.matches(event))
            .map(({ event, position }) => {
              const ref = { kind: 'dialogue' as const, id: event.id }
              const isSelected = selected.some(candidate => same(candidate, ref))
              const label = t('dialogue.clipLabel', {
                speaker: codeOf(event) || '—',
                // 1-liczbowy numer kwestii w obrębie WŁASNEGO ujęcia — patrz
                // komentarz nad komponentem. Ta sama wartość niezależnie od
                // tego, w którym pasie klip akurat się renderuje, bo liczy
                // się z `span.shot.dialogue`, nie z zawartości pasa.
                position: position + 1,
                shot: span.shot.index + 1,
                text: event.text,
              })
              const naturalMs = naturalDurationMs(event.text, wordsPerMinute)
              const actualMs = event.endMs - event.startMs
              const fits = naturalMs <= actualMs
              return (
                <div
                  key={event.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={label}
                  onClick={clickEvent => (clickEvent.shiftKey ? toggle(ref) : select(ref))}
                  onKeyDown={keyEvent => {
                    if (keyEvent.key !== 'Enter' && keyEvent.key !== ' ') return
                    keyEvent.preventDefault()
                    // Jak w `ShotTrack`/`CameraTrack`: klip obsłużył ten
                    // klawisz, więc nie może polecieć dalej do globalnego
                    // skrótu na `window`, gdzie sama spacja przełącza
                    // odtwarzanie.
                    keyEvent.stopPropagation()
                    select(ref)
                  }}
                  onPointerDown={pointerEvent => startDrag(event.id, 'move', pointerEvent)}
                  className={`absolute top-1 h-6 rounded border px-1 text-left text-[10px] ${
                    isSelected
                      ? 'border-emerald-500 bg-emerald-950 text-emerald-100'
                      : 'border-neutral-700 bg-neutral-900 hover:border-neutral-500'
                  }`}
                  style={clipBox(scale, event)}
                >
                  {/*
                    Jak w `ShotTrack`/`CameraTrack`: overflow-hidden tylko na
                    etykiecie, nie na całym klipie — gdyby obcinał całą
                    zawartość, uchwyty krawędzi byłyby nieklikalne na klipach
                    przyciętych do MIN_CLIP_PX (8px).
                  */}
                  <span className="block h-full overflow-hidden">{event.text}</span>
                  {/*
                    Cień naturalnej długości liczonej z liczby słów i tempa z
                    magazynu widoku — patrz komentarz przy `useSpeechRate`
                    wyżej. `pointer-events-none`, bo to tylko wizualna
                    podpowiedź: nie ma własnego gestu i nie może zasłaniać
                    kliknięcia w klip ani w uchwyty krawędzi pod spodem.

                    Celowo POZA drzewem dostępności (`aria-hidden`, bez
                    `aria-label`) — gdy kwestia się mieści, cień powtarza fakt,
                    który czytnik ekranu już usłyszał w etykiecie klipu; gdy
                    się nie mieści, tę samą informację (obie liczby sekund)
                    niesie ostrzeżenie niżej. Osobna etykieta na cieniu byłaby
                    więc drugim przystankiem Tabu na to samo, a przy więcej niż
                    jednej kwestii w pasie (kwestia dwóch mówców pojawia się w
                    obu pasach, patrz komentarz nad komponentem) stały,
                    niesparametryzowany tekst nie dawałby się jednoznacznie
                    zapytać przez `getByLabelText` — stąd zamiast etykiety,
                    `data-natural-length` jako hak do zapytań w testach,
                    jak `data-frame-tick` w `Ruler`.

                    Świadomie rysowany bez ograniczenia szerokości klipu —
                    długa kwestia przy wolnym tempie da cień szerszy niż sam
                    klip. To czytelne, nie szkodliwe: `pointer-events-none`
                    nie blokuje niczego pod spodem, a klip ma `overflow`
                    tylko na etykiecie, nie na kontenerze, więc przelew nie
                    psuje layoutu klipu, w którym mieszka. Tam, gdzie przelewa
                    się na pusty odcinek pasa, pokazuje ile miejsca kwestii
                    naprawdę trzeba; tam, gdzie sięga kolejnego klipu, ten
                    klip renderuje się później w DOM-ie tego samego pasa i bez
                    ustawionego `z-index` maluje się NAD cieniem (późniejszy
                    element w kolejności dokumentu przykrywa wcześniejszy), a
                    jego tło (`bg-neutral-900`/`bg-emerald-950`) nie jest
                    przezroczyste — więc przelew chowa się pod sąsiednim
                    klipem zamiast go zasłaniać.
                  */}
                  <span
                    aria-hidden="true"
                    data-natural-length
                    className="pointer-events-none absolute inset-y-0 left-0 border-r border-dashed border-emerald-300/60"
                    style={{ width: msToPx(scale, naturalMs) }}
                  />
                  {!fits && (
                    <button
                      type="button"
                      aria-label={t('dialogue.tooShort', {
                        needed: (naturalMs / 1000).toFixed(1),
                        actual: (actualMs / 1000).toFixed(1),
                      })}
                      onPointerDown={pointerEvent => pointerEvent.stopPropagation()}
                      onClick={clickEvent => {
                        // Zatrzymaj propagację do klipu-rodzica: bez tego
                        // kliknięcie w plakietkę wywołałoby DRUGI raz
                        // `select`/`toggle` z `onClick` klipu (bąbelkowanie),
                        // a przy Shift+kliknięciu `toggle` zaraz odwróciłby
                        // zaznaczenie, które ta plakietka właśnie ustawiła —
                        // dokładnie ten rodzaj podwójnego wyzwolenia w
                        // zagnieżdżonych elementach interaktywnych, który już
                        // raz ugryzł ten projekt.
                        clickEvent.stopPropagation()
                        select(ref)
                      }}
                      className="absolute -top-1 right-0 h-2 w-2 rounded-full bg-amber-400"
                    />
                  )}
                  <div
                    role="separator"
                    aria-label={t('dialogue.dragStart', { speaker: codeOf(event) || '—' })}
                    onPointerDown={pointerEvent => startDrag(event.id, 'start', pointerEvent)}
                    className="absolute inset-y-0 left-0 w-1 cursor-ew-resize bg-emerald-500/40"
                  />
                  <div
                    role="separator"
                    aria-label={t('dialogue.dragEnd', { speaker: codeOf(event) || '—' })}
                    onPointerDown={pointerEvent => startDrag(event.id, 'end', pointerEvent)}
                    className="absolute inset-y-0 right-0 w-1 cursor-ew-resize bg-emerald-500/40"
                  />
                </div>
              )
            }))}
        </div>
      ))}
    </>
  )
}
