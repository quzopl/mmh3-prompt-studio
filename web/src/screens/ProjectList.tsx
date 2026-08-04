import { useEffect, useState } from 'react'
import type { Mode } from '@mmh3/shared'
import { api, type ProjectSummary } from '../api/client.js'
import { useT } from '../i18n/useT.js'
import { ModePicker } from './ModePicker.js'

interface Props {
  onOpen: (slug: string) => void
}

export function ProjectList({ onOpen }: Props) {
  const t = useT()
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [mode, setMode] = useState<Mode | null>(null)

  useEffect(() => {
    api.listProjects()
      .then(setProjects)
      .catch((err: Error) => setError(err.message))
  }, [])

  const create = async () => {
    if (!name.trim() || !mode) return
    try {
      const { slug } = await api.createProject(name.trim(), mode)
      onOpen(slug)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (error) return <p className="p-6 text-red-400">{error}</p>
  if (!projects) return <p className="p-6 text-neutral-400">{t('common.loading')}</p>

  return (
    <section className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('projects.title')}</h2>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded border border-neutral-700 px-3 py-1 text-sm hover:border-neutral-500"
        >
          {t('projects.new')}
        </button>
      </div>

      {projects.length === 0 && !creating && (
        <p className="text-neutral-400">{t('projects.empty')}</p>
      )}

      <ul className="mb-6 flex flex-col gap-2">
        {projects.map(project => (
          <li key={project.slug}>
            <button
              type="button"
              onClick={() => onOpen(project.slug)}
              className="flex w-full items-center justify-between rounded border border-neutral-800 px-3 py-2 text-left hover:border-neutral-600"
            >
              <span>{project.name}</span>
              <span className="font-mono text-xs text-neutral-500">{project.mode}</span>
            </button>
          </li>
        ))}
      </ul>

      {creating && (
        <div className="rounded border border-neutral-800 p-4">
          <label className="mb-3 block text-sm">
            <span className="mb-1 block text-neutral-400">{t('projects.name')}</span>
            <input
              value={name}
              onChange={event => setName(event.target.value)}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
            />
          </label>
          <ModePicker onPick={setMode} />
          <button
            type="button"
            onClick={create}
            disabled={!name.trim() || !mode}
            className="mt-3 rounded border border-neutral-700 px-3 py-1 text-sm disabled:opacity-40"
          >
            {t('projects.create')}
          </button>
        </div>
      )}
    </section>
  )
}
