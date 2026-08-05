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
      {frameTicks(scale).map(tick => (
        <span
          key={`f${tick}`}
          data-frame-tick
          className="absolute bottom-0 h-1 w-px bg-neutral-700"
          style={{ left: msToPx(scale, tick) }}
        />
      ))}
      {secondTicks(scale).map(tick => (
        <span key={`s${tick}`} className="absolute bottom-0 top-0" style={{ left: msToPx(scale, tick) }}>
          <span className="absolute bottom-0 top-0 w-px bg-neutral-600" />
          <span className="absolute left-1 top-0 font-mono text-[10px] text-neutral-500">
            {Math.round(tick / 1000)}s
          </span>
        </span>
      ))}
    </div>
  )
}
