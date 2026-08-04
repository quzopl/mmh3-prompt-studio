import { useEffect, useState } from 'react'
import { api } from '../api/client.js'
import { useProject } from '../store/projectStore.js'
import { useT } from '../i18n/useT.js'
import { PromptPanel } from '../panels/PromptPanel.js'
import { ValidationPanel } from '../panels/ValidationPanel.js'

interface Props {
  slug: string
  onClose: () => void
}

export function Editor({ slug, onClose }: Props) {
  const t = useT()
  const load = useProject(state => state.load)
  const project = useProject(state => state.project)
  const undo = useProject(state => state.undo)
  const redo = useProject(state => state.redo)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getProject(slug)
      .then(response => load(slug, response.project))
      .catch((err: Error) => setError(err.message))
  }, [slug, load])

  if (error) return <p className="p-6 text-red-400">{error}</p>
  if (!project) return <p className="p-6 text-neutral-400">{t('common.loading')}</p>

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-1 text-sm">
        <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-100">
          ← {t('projects.title')}
        </button>
        <span className="font-medium">{project.name}</span>
        <span className="font-mono text-xs text-neutral-500">{project.mode}</span>
        <span className="ml-auto flex gap-1">
          <button type="button" onClick={undo} className="rounded px-2 py-0.5 hover:bg-neutral-800">
            {t('editor.undo')}
          </button>
          <button type="button" onClick={redo} className="rounded px-2 py-0.5 hover:bg-neutral-800">
            {t('editor.redo')}
          </button>
        </span>
      </div>
      <div className="grid flex-1 grid-cols-2 overflow-hidden divide-x divide-neutral-800">
        <PromptPanel />
        <ValidationPanel />
      </div>
    </div>
  )
}
