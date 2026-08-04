import { useState } from 'react'
import { useProject } from '../store/projectStore.js'
import { usePlayhead } from '../store/playheadStore.js'
import { useT } from '../i18n/useT.js'
import { clampZoom, createScale } from './scale.js'
import { Ruler } from './Ruler.js'
import { ShotTrack } from './ShotTrack.js'
import { Playhead } from './Playhead.js'
import { usePlayback } from './usePlayback.js'
import { splitAtMs } from './shotOperations.js'

/** Szerokość osi przy zoomie 1. Stała, więc nic nie musi mierzyć DOM-u. */
const BASE_WIDTH_PX = 900
const ZOOM_STEP = 2

export function Timeline() {
  const t = useT()
  const project = useProject(state => state.project)
  const apply = useProject(state => state.apply)
  const ms = usePlayhead(state => state.ms)
  const playing = usePlayhead(state => state.playing)
  const toggle = usePlayhead(state => state.toggle)
  const [zoom, setZoom] = useState(1)

  const durationMs = project?.video.durationMs ?? 0
  usePlayback(durationMs)

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
            onClick={() => setZoom(1)}
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

      <div className="flex-1 overflow-auto">
        <div className="relative" style={{ width: scale.widthPx * scale.zoom }}>
          <Ruler scale={scale} />
          <ShotTrack scale={scale} />
          <Playhead scale={scale} />
        </div>
      </div>

      <p className="border-t border-neutral-800 px-3 py-1 text-[10px] text-neutral-600">
        {t('timeline.shortcuts')}
      </p>
    </section>
  )
}
