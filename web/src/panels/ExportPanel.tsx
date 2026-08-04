import { useState } from 'react'
import { isExportReady } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { useT } from '../i18n/useT.js'

export function ExportPanel({ slug }: { slug: string }) {
  const t = useT()
  const diagnostics = useProject(state => state.diagnostics)
  const [nodeId, setNodeId] = useState('')
  const [field, setField] = useState('text')
  const [workflow, setWorkflow] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)

  const ready = isExportReady(diagnostics)

  const exportComfy = async () => {
    if (!workflow || !nodeId || !field) return
    try {
      const response = await fetch(`/api/projects/${slug}/export/comfy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workflow, nodeId, field }),
      })
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? t('export.serverError', { status: response.status }))
        return
      }
      setError(null)
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = `${slug}-workflow.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section aria-label={t('export.title')} className="flex flex-col gap-2 p-3 text-sm">
      <span className="text-xs uppercase tracking-wide text-neutral-500">{t('export.title')}</span>
      {!ready && <p className="text-xs text-red-400">{t('export.blocked')}</p>}

      <a href={`/api/projects/${slug}/export/prompt`} className="underline hover:text-sky-400">
        {t('export.prompt')}
      </a>
      <a href={`/api/projects/${slug}/export/project`} className="underline hover:text-sky-400">
        {t('export.project')}
      </a>

      <label className="mt-2 block text-xs">
        <span className="mb-1 block text-neutral-500">{t('export.comfyUpload')}</span>
        <input
          type="file"
          accept="application/json"
          onChange={async event => {
            const file = event.target.files?.[0]
            if (!file) return
            try {
              setWorkflow(JSON.parse(await file.text()))
              setError(null)
            } catch {
              setError(t('export.invalidJson'))
            }
          }}
        />
      </label>

      <label className="block text-xs">
        <span className="mb-1 block text-neutral-500">{t('export.comfyNode')}</span>
        <input
          value={nodeId}
          onChange={event => setNodeId(event.target.value)}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
        />
      </label>

      <label className="block text-xs">
        <span className="mb-1 block text-neutral-500">{t('export.comfyField')}</span>
        <input
          value={field}
          onChange={event => setField(event.target.value)}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
        />
      </label>

      <button
        type="button"
        onClick={exportComfy}
        disabled={!workflow || !nodeId || !field}
        className="rounded border border-neutral-700 px-2 py-1 text-xs disabled:opacity-40"
      >
        {t('export.comfy')}
      </button>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </section>
  )
}
