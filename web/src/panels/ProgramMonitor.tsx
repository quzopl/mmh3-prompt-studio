import { useProject } from '../store/projectStore.js'
import { usePlayhead } from '../store/playheadStore.js'
import { useT } from '../i18n/useT.js'
import { shotSpans } from '../timeline/spans.js'
import { shotAtMs, shotExcerpt } from './shotExcerpt.js'

/**
 * Karta ujęcia, nad którym stoi playhead. Prompt i mapa tokenów w sklepie
 * powstają synchronicznie w tym samym `set()`, co zmiana projektu (patrz
 * `projectStore.apply`), więc nie ma tu osobnego stanu „nieaktualnej"
 * kompilacji do pilnowania — odczyt zawsze trafia na parę zgodną z bieżącym
 * projektem.
 */
export function ProgramMonitor() {
  const t = useT()
  const project = useProject(state => state.project)
  const prompt = useProject(state => state.prompt)
  const tokens = useProject(state => state.tokens)
  const ms = usePlayhead(state => state.ms)

  if (!project) return null

  const span = shotAtMs(shotSpans(project.shots, project.video.durationMs), ms)

  return (
    <section aria-label={t('monitor.title')} className="flex h-full flex-col gap-2 p-3">
      {!span && <p className="text-sm text-neutral-400">{t('monitor.empty')}</p>}
      {span && (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-xs uppercase tracking-wide text-neutral-500">
              {t('monitor.shot', { number: span.shot.index + 1 })}
            </span>
            {span.shot.composition && (
              <span className="text-xs text-neutral-400">{span.shot.composition}</span>
            )}
          </div>
          <p className="overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-neutral-300">
            {shotExcerpt(prompt, tokens, span.shot.id)}
          </p>
        </>
      )}
    </section>
  )
}
