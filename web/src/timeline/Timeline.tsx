import { useEffect, useState } from 'react'
import { useProject } from '../store/projectStore.js'
import { usePlayhead } from '../store/playheadStore.js'
import { useT } from '../i18n/useT.js'
import { clampZoom, createScale } from './scale.js'
import { Ruler } from './Ruler.js'
import { TrackStack } from './TrackStack.js'
import { Playhead } from './Playhead.js'
import { usePlayback } from './usePlayback.js'
import { splitAtMs } from './shotOperations.js'

/**
 * Szerokość osi przy zoomie 1. Baza do przeliczeń zoomu (przybliż/oddal
 * mnożą tę wartość) i wartość zastępcza, dopóki kontener nie zdążył się
 * jeszcze zmierzyć — pierwsza klatka renderu, a w testach jsdom, które
 * `ResizeObserver` w ogóle nie zna.
 */
const BASE_WIDTH_PX = 900
const ZOOM_STEP = 2

/**
 * Zoom, przy którym cały materiał zajmuje dokładnie zmierzoną szerokość
 * kontenera — `widthPx * zoom` w `createScale` to całkowita szerokość osi
 * w pikselach, więc odwrócenie tego równania daje zoom docelowy. Bez pomiaru
 * (jeszcze nie zaobserwowany albo `ResizeObserver` niedostępny) wraca do
 * zoomu bazowego zamiast zgadywać.
 *
 * Znany, świadomie zaakceptowany niedoskonałość od zadania 12: `container`
 * mierzy CAŁĄ szerokość (nagłówki `TrackStack` + obszar klipów), a wzór
 * niżej zakłada, że cała zmierzona szerokość należy do klipów — „Dopasuj"
 * więc odrobinę przeszacowuje i zostawia klipy odrobinę szersze niż
 * widoczny po nagłówkach obszar. Odjęcie stałej szerokości nagłówka
 * naprawiłoby to, ale zmieniłoby dotychczasowe, przetestowane wartości
 * pikseli w `timeline.test.tsx` („dopasowanie…” dają dziś dokładnie
 * `measuredWidthPx`) — kosmetyczna poprawka, którą zostawiam jako osobną
 * decyzję, nie coś do przemycenia przy okazji tego zadania.
 */
function fitZoom(measuredWidthPx: number | null): number {
  if (measuredWidthPx === null || measuredWidthPx <= 0) return 1
  return clampZoom(measuredWidthPx / BASE_WIDTH_PX)
}

export function Timeline() {
  const t = useT()
  const project = useProject(state => state.project)
  const apply = useProject(state => state.apply)
  const ms = usePlayhead(state => state.ms)
  const playing = usePlayhead(state => state.playing)
  const toggle = usePlayhead(state => state.toggle)
  const [zoom, setZoom] = useState(1)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null)

  const durationMs = project?.video.durationMs ?? 0
  usePlayback(durationMs)

  // Callback-ref (`setContainer`) zamiast `useRef` + efekt z pustą tablicą
  // zależności: gdyby projekt nie był jeszcze załadowany przy pierwszym
  // montowaniu, węzeł kontenera pojawiłby się dopiero w kolejnym commit-cie,
  // a efekt z `[]` już by nie zadziałał. Zależność `[container]` obserwuje
  // węzeł, gdy tylko faktycznie istnieje.
  useEffect(() => {
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) setMeasuredWidth(entry.contentRect.width)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [container])

  if (!project) return null
  const scale = createScale(durationMs, BASE_WIDTH_PX, zoom)

  return (
    <section aria-label={t('timeline.title')} className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-1 text-xs">
        <button
          type="button"
          onClick={toggle}
          className="rounded border border-neutral-700 px-2 py-0.5 hover:border-neutral-500"
        >
          {playing ? t('timeline.pause') : t('timeline.play')}
        </button>
        <span className="font-mono text-neutral-500">{ms} ms</span>
        <button
          type="button"
          onClick={() => apply(current => splitAtMs(current, usePlayhead.getState().ms))}
          className="rounded border border-neutral-700 px-2 py-0.5 hover:border-neutral-500"
        >
          {t('timeline.addShot')}
        </button>
        <span className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => setZoom(current => clampZoom(current / ZOOM_STEP))}
            className="rounded border border-neutral-700 px-2 py-0.5 hover:border-neutral-500"
          >
            {t('timeline.zoomOut')}
          </button>
          <button
            type="button"
            onClick={() => setZoom(fitZoom(measuredWidth))}
            className="rounded border border-neutral-700 px-2 py-0.5 hover:border-neutral-500"
          >
            {t('timeline.zoomFit')}
          </button>
          <button
            type="button"
            onClick={() => setZoom(current => clampZoom(current * ZOOM_STEP))}
            className="rounded border border-neutral-700 px-2 py-0.5 hover:border-neutral-500"
          >
            {t('timeline.zoomIn')}
          </button>
        </span>
      </div>

      {/*
        Pion przewija się tu, na najbardziej zewnętrznym kontenerze — kolumna
        nagłówków i obszar klipów w `TrackStack` mają się przewijać RAZEM w
        pionie (to jeden stos, nie dwa niezależne), więc dzielą ten sam
        kontener przewijający. W poziomie przewija się już tylko
        `[data-scroller]` WEWNĄTRZ `TrackStack` — linijka i playhead trafiają
        tam przez sloty `ruler`/`playhead`, żeby fizycznie leżeć w tym samym
        przewijanym poziomo kontenerze co klipy (patrz komentarz w
        `TrackStack.tsx`), zamiast osobno mierzyć przesunięcie nagłówków.
      */}
      <div ref={setContainer} className="flex-1 overflow-y-auto">
        <TrackStack scale={scale} ruler={<Ruler scale={scale} />} playhead={<Playhead scale={scale} />} />
      </div>

      <p className="border-t border-neutral-800 px-3 py-1 text-[10px] text-neutral-600">
        {t('timeline.shortcuts')}
      </p>
    </section>
  )
}
