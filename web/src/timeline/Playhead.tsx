import { usePlayhead } from '../store/playheadStore.js'
import { useT } from '../i18n/useT.js'
import { msToPx, pxToMs, type Scale } from './scale.js'

export function Playhead({ scale }: { scale: Scale }) {
  const t = useT()
  const ms = usePlayhead(state => state.ms)
  const setMs = usePlayhead(state => state.setMs)

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const track = event.currentTarget.parentElement
    if (!track) return
    const bounds = track.getBoundingClientRect()
    const target = event.currentTarget

    const move = (moveEvent: PointerEvent) =>
      setMs(pxToMs(scale, moveEvent.clientX - bounds.left), scale.durationMs)

    const finish = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', finish)
      target.removeEventListener('pointercancel', finish)
      try {
        target.releasePointerCapture(event.pointerId)
      } catch {
        // Przechwycenie mogło już zostać zwolnione przez przeglądarkę.
      }
    }

    target.setPointerCapture(event.pointerId)
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', finish)
    target.addEventListener('pointercancel', finish)
  }

  return (
    <div
      role="presentation"
      aria-label={t('timeline.playhead')}
      onPointerDown={startDrag}
      className="absolute bottom-0 top-0 z-20 w-px cursor-col-resize bg-amber-400"
      style={{ left: msToPx(scale, ms) }}
    >
      <span className="absolute -left-1 top-0 h-2 w-2 rounded-sm bg-amber-400" />
    </div>
  )
}
