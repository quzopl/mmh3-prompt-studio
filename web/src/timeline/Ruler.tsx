import { usePlayhead } from '../store/playheadStore.js'
import { useT } from '../i18n/useT.js'
import { frameTicks, msToPx, pxToMs, secondTicks, type Scale } from './scale.js'

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
      className="relative h-6 cursor-pointer select-none border-b border-neutral-800 bg-neutral-900"
      style={{ width: msToPx(scale, scale.durationMs) }}
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
