import type { ReactNode } from 'react'
import type { Project, Shot } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { useSelection } from '../store/selectionStore.js'
import { useT, type Translate } from '../i18n/useT.js'

export function Inspector() {
  const t = useT()
  const project = useProject(state => state.project)
  const apply = useProject(state => state.apply)
  const selected = useSelection(state => state.selected)

  if (!project) return null

  const shotRef = selected.find(ref => ref.kind === 'shot')
  const shot = shotRef ? project.shots.find(candidate => candidate.id === shotRef.id) : undefined

  return (
    <section aria-label={t('editor.inspector')} className="h-full overflow-auto p-3">
      {shot
        ? <ShotFields t={t} shot={shot} apply={apply} />
        : <ProjectFields t={t} project={project} apply={apply} />}
    </section>
  )
}

type Apply = (mutate: (project: Project) => Project) => void

/**
 * Puste pole daje zero i walidator to zgłosi — taka jest pętla zwrotna.
 * NaN natomiast przechodzi przez typy i po cichu wyłącza część reguł
 * czasowych, bo każde porównanie z NaN jest fałszem, więc go nie wpuszczamy.
 *
 * Przez samo pole `type="number"` NaN nie przyjdzie — HTML sanityzuje wpis
 * nieliczbowy do pustego ciągu, zanim onChange go zobaczy. To zabezpieczenie
 * na inne drogi do modelu: import projektu, łatkę od modelu językowego,
 * zmianę programową. Dlatego testujemy je wprost, a nie przez DOM.
 */
export const toMs = (raw: string, previous: number): number => {
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : previous
}

function ProjectFields({ t, project, apply }: { t: Translate; project: Project; apply: Apply }) {
  return (
    <div className="flex flex-col gap-3">
      <Field label={t('project.style')}>
        <input
          value={project.style}
          onChange={event => apply(current => ({ ...current, style: event.target.value }))}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
        />
      </Field>
      <Field label={t('project.duration')}>
        <input
          type="number"
          value={project.video.durationMs}
          onChange={event => apply(current => ({
            ...current,
            video: { ...current.video, durationMs: toMs(event.target.value, current.video.durationMs) },
          }))}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
        />
      </Field>
      <Field label={t('project.soundscape')}>
        <textarea
          value={project.audio.overallSoundscape}
          onChange={event => apply(current => ({
            ...current,
            audio: { ...current.audio, overallSoundscape: event.target.value },
          }))}
          rows={3}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
        />
      </Field>
      <Field label={t('project.music')}>
        <textarea
          value={project.audio.nonDiegeticMusic}
          onChange={event => apply(current => ({
            ...current,
            audio: { ...current.audio, nonDiegeticMusic: event.target.value },
          }))}
          rows={2}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
        />
      </Field>
    </div>
  )
}

function ShotFields({ t, shot, apply }: { t: Translate; shot: Shot; apply: Apply }) {
  const patch = (change: Partial<Shot>) => apply(current => ({
    ...current,
    shots: current.shots.map(candidate =>
      candidate.id === shot.id ? { ...candidate, ...change } : candidate),
  }))

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs uppercase tracking-wide text-neutral-500">
        {t('shot.number', { number: shot.index + 1 })}
      </p>
      <Field label={t('shot.composition')}>
        <input
          value={shot.composition}
          onChange={event => patch({ composition: event.target.value })}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
        />
      </Field>
      {shot.index > 0 && (
        <Field label={t('shot.startMs')}>
          <input
            type="number"
            value={shot.startMs}
            onChange={event => patch({ startMs: toMs(event.target.value, shot.startMs) })}
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          />
        </Field>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs uppercase tracking-wide text-neutral-500">{label}</span>
      {children}
    </label>
  )
}
