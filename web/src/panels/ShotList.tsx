import { snapToFrame, type Shot } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { useSelection } from '../store/selectionStore.js'
import { useT } from '../i18n/useT.js'

/** Nowe ujęcie ląduje w połowie odcinka między ostatnim cięciem a końcem wideo. */
const nextStartMs = (shots: Shot[], durationMs: number): number => {
  const last = shots.reduce((max, shot) => Math.max(max, shot.startMs), 0)
  return snapToFrame(last + Math.floor((durationMs - last) / 2))
}

export function ShotList() {
  const t = useT()
  const project = useProject(state => state.project)
  const apply = useProject(state => state.apply)
  const selected = useSelection(state => state.selected)
  const select = useSelection(state => state.select)

  if (!project) return null

  const addShot = () => apply(current => {
    const startMs = nextStartMs(current.shots, current.video.durationMs)
    const shot: Shot = {
      id: `shot-${current.shots.length + 1}-${startMs}`,
      index: current.shots.length,
      startMs,
      cutType: 'cut',
      cutPhrase: 'the camera cuts to',
      composition: '',
      body: [],
      cameraMoves: [],
      dialogue: [],
      screenText: [],
      diegeticSfx: [],
      labelRefs: [],
      anchors: [],
    }
    return { ...current, shots: [...current.shots, shot] }
  })

  const removeShot = (id: string) => apply(current => ({
    ...current,
    shots: current.shots
      .filter(shot => shot.id !== id)
      .sort((a, b) => a.index - b.index)
      .map((shot, index) => ({ ...shot, index, startMs: index === 0 ? 0 : shot.startMs })),
  }))

  return (
    <section aria-label={t('editor.shots')} className="h-full overflow-auto p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-neutral-500">{t('editor.shots')}</span>
        <button
          type="button"
          onClick={addShot}
          className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:border-neutral-500"
        >
          {t('shot.add')}
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {[...project.shots].sort((a, b) => a.index - b.index).map(shot => (
          <li key={shot.id} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => select({ kind: 'shot', id: shot.id })}
              aria-current={selected?.kind === 'shot' && selected.id === shot.id ? 'true' : undefined}
              className={`flex-1 rounded border px-2 py-1 text-left text-sm ${
                selected?.kind === 'shot' && selected.id === shot.id
                  ? 'border-sky-700 bg-neutral-900'
                  : 'border-neutral-800 hover:border-neutral-600'
              }`}
            >
              {t('shot.number', { number: shot.index + 1 })}
              <span className="ml-2 font-mono text-xs text-neutral-500">{shot.startMs} ms</span>
            </button>
            <button
              type="button"
              onClick={() => removeShot(shot.id)}
              disabled={project.shots.length <= 1}
              aria-label={t('shot.remove')}
              className="rounded px-2 py-1 text-xs text-neutral-500 hover:text-red-400 disabled:opacity-30"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
