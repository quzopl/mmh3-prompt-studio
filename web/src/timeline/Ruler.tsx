import { usePlayhead } from '../store/playheadStore.js'
import { useT } from '../i18n/useT.js'
import { frameTicks, msToPx, pxToMs, secondTicks, type Scale } from './scale.js'

/**
 * Wysokość linijki jako liczba, nie tylko klasa Tailwind `h-6` — `TrackStack`
 * (zadanie 12, runda poprawek 1) rezerwuje w kolumnie nagłówków wiersz-
 * odstępnik DOKŁADNIE tej wysokości, bo sama linijka renderuje się w slocie
 * `ruler` WEWNĄTRZ przewijanego obszaru treści, przed pierwszym wierszem
 * ścieżki — bez odstępnika w nagłówkach wszystkie wiersze treści siedziałyby
 * niżej niż ich nagłówki o dokładnie tę wysokość. Stała eksportowana, żeby
 * `TrackStack` liczył z TEJ SAMEJ wartości, którą linijka faktycznie
 * renderuje (inline `style`, nie osobna klasa gdzie indziej), a nie z liczby,
 * która akurat dziś się zgadza.
 */
export const RULER_HEIGHT_PX = 24

export function Ruler({ scale }: { scale: Scale }) {
  const t = useT()
  const setMs = usePlayhead(state => state.setMs)
  const ms = usePlayhead(state => state.ms)

  const seek = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    setMs(pxToMs(scale, event.clientX - bounds.left), scale.durationMs)
  }

  return (
    <div
      role="slider"
      aria-label={t('timeline.ruler')}
      aria-valuemin={0}
      aria-valuemax={scale.durationMs}
      aria-valuenow={ms}
      tabIndex={0}
      onPointerDown={seek}
      className="relative cursor-pointer select-none border-b border-neutral-800 bg-neutral-900"
      style={{ width: msToPx(scale, scale.durationMs), height: RULER_HEIGHT_PX }}
    >
      {frameTicks(scale).map(tick => {
        // Ostatnia klatka może wypaść dokładnie na `durationMs` (koniec osi) —
        // wtedy `left: msToPx(...)` stawia LEWĄ krawędź kreski (`w-px`) na
        // samej krawędzi osi, więc kreska sama w sobie wystaje 1px poza
        // materiał. `right: 0` stawia jej PRAWĄ krawędź na krawędzi osi —
        // kreska mieści się w całości wewnątrz. Klatki, które nie trafiają
        // dokładnie w koniec (typowe, gdy `durationMs` nie jest wielokrotnością
        // klatki), nie dostają tego traktowania: ich `left` już jest
        // poprawne, a wymuszenie `right: 0` przesunęłoby je na krawędź, której
        // naprawdę nie reprezentują.
        const isTerminal = tick === scale.durationMs
        return (
          <span
            key={`f${tick}`}
            data-frame-tick
            className="absolute bottom-0 h-1 w-px bg-neutral-700"
            style={isTerminal ? { right: 0 } : { left: msToPx(scale, tick) }}
          />
        )
      })}
      {secondTicks(scale).map(tick => {
        // `secondTicks` (scale.ts) zawsze kończy się dokładnie na
        // `durationMs` — ostatnia etykieta ma więc TYLKO materiał po lewej,
        // nic po prawej (w przeciwieństwie do wszystkich pozostałych, które
        // mają sąsiada z prawej i dlatego bezpiecznie rozwijają się w tamtą
        // stronę o `left-1`). Zakotwiczenie jej do PRAWEJ krawędzi osi
        // (`right: 0` na opakowaniu i kresce, `right-1` na etykiecie zamiast
        // `left-1`) trzyma cały tekst wewnątrz materiału, zamiast wystawać
        // poza koniec — zmierzone w Chromium jako 16px poziomego przewijania
        // nawet po „Dopasuj”, mimo że sama oś miała już poprawną szerokość.
        const isTerminal = tick === scale.durationMs
        return (
          <span
            key={`s${tick}`}
            className="absolute bottom-0 top-0"
            style={isTerminal ? { right: 0 } : { left: msToPx(scale, tick) }}
          >
            <span
              className="absolute bottom-0 top-0 w-px bg-neutral-600"
              style={isTerminal ? { right: 0 } : undefined}
            />
            <span
              data-terminal-label={isTerminal || undefined}
              className={`absolute top-0 font-mono text-[10px] text-neutral-500 ${isTerminal ? 'right-0' : 'left-1'}`}
            >
              {Math.round(tick / 1000)}s
            </span>
          </span>
        )
      })}
    </div>
  )
}
