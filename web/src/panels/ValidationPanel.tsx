import { isExportReady, type Severity } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { useSelection } from '../store/selectionStore.js'
import { useLang, useT } from '../i18n/useT.js'

const SEVERITY_STYLE: Record<Severity, string> = {
  error: 'border-red-800 text-red-300',
  warning: 'border-amber-800 text-amber-300',
  hint: 'border-neutral-700 text-neutral-400',
}

export function ValidationPanel() {
  const t = useT()
  const lang = useLang(state => state.lang)
  const diagnostics = useProject(state => state.diagnostics)
  const select = useSelection(state => state.select)

  return (
    <section aria-label={t('editor.validation')} className="h-full overflow-auto p-3">
      <p className="mb-2 text-xs uppercase tracking-wide text-neutral-500">
        {isExportReady(diagnostics)
          ? t('validation.ready')
          : t('validation.count', { count: diagnostics.length })}
      </p>

      {diagnostics.length === 0 && (
        <p className="text-sm text-neutral-400">{t('validation.none')}</p>
      )}

      <ul className="flex flex-col gap-1">
        {diagnostics.map((diagnostic, index) => (
          <li key={`${diagnostic.ruleId}-${index}`}>
            <button
              type="button"
              onClick={() => select(diagnostic.ref)}
              className={`w-full rounded border-l-2 px-2 py-1 text-left text-sm hover:bg-neutral-900 ${SEVERITY_STYLE[diagnostic.severity]}`}
            >
              <span className="block">{lang === 'pl' ? diagnostic.message : diagnostic.messageEn}</span>
              <span className="mt-0.5 block font-mono text-[10px] text-neutral-500">
                {diagnostic.ruleId} · {t('validation.source')}: {diagnostic.guideRef}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
