import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n/useT.js'
import { ActionButton } from './ActionButton.js'
import { settingsApi, type Catalog, type InstallProgress } from './settingsApi.js'

/**
 * Pobranie silnika i modelu dla użytkownika, który nie ma nic. Rusza WYŁĄCZNIE
 * po kliknięciu i dopiero po pokazaniu rozmiaru — kilka gigabajtów nie ma prawa
 * ruszyć bez wiedzy właściciela łącza.
 */
export function ModelInstall({ freeVramMb }: { freeVramMb: number | null }) {
  const t = useT()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    let cancelled = false
    void settingsApi.catalog()
      .then(value => { if (!cancelled) setCatalog(value) })
      .catch(() => { if (!cancelled) setCatalog(null) })
    return () => { cancelled = true }
  }, [])

  const start = (modelId: string): void => {
    const controller = new AbortController()
    abort.current = controller
    setError(null)
    setDone(false)
    setProgress(null)
    setRunning(true)
    void (async () => {
      const response = await fetch('/api/llm/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelId }),
        signal: controller.signal,
      })
      const reader = response.body?.getReader()
      if (reader === undefined) return
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done: finished, value } = await reader.read()
        if (finished) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        // Ostatni element to ogon bez zamykającej pustej linii — zostaje w
        // buforze do następnej porcji. Bloki SSE potrafią przyjść pocięte.
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          const event = /event: (\w+)/.exec(block)?.[1]
          const data = /data: (.*)/.exec(block)?.[1]
          if (event === undefined || data === undefined) continue
          if (event === 'progress') setProgress(JSON.parse(data) as InstallProgress)
          if (event === 'done') setDone(true)
          if (event === 'error') setError((JSON.parse(data) as { error: string }).error)
        }
      }
    })()
      .catch(() => { /* przerwanie użytkownika albo zerwana sieć */ })
      .finally(() => setRunning(false))
  }

  if (catalog === null) return null
  if (catalog.engine === null) {
    return <p className="text-[11px] text-amber-400">{t('llm.installNoEngine')}</p>
  }

  return (
    <div className="mb-2 flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-neutral-500">{t('llm.installTitle')}</span>
      <p className="text-[11px] text-neutral-500">{t('llm.installHint')}</p>
      {catalog.models.map(model => (
        <div key={model.id} className="flex items-center justify-between gap-2 text-[11px]">
          <span className="truncate">{model.label}</span>
          <span className="shrink-0 text-neutral-500">{(model.bytes / 1e9).toFixed(1)} GB</span>
          {freeVramMb !== null && model.vramMb > freeVramMb && (
            <span className="shrink-0 text-amber-400">{t('llm.installTooBig')}</span>
          )}
          <ActionButton
            label={t('llm.installStart')}
            onClick={() => start(model.id)}
            disabled={running}
          />
        </div>
      ))}
      {progress !== null && !done && (
        <div className="flex items-center gap-2 text-[11px] text-neutral-400">
          <span>{progress.stage === 'engine' ? t('llm.installEngine') : t('llm.installModel')}</span>
          <span>{Math.round((progress.received / Math.max(progress.total, 1)) * 100)}%</span>
          <ActionButton label={t('llm.installCancel')} onClick={() => abort.current?.abort()} />
        </div>
      )}
      {done && <p className="text-[11px] text-emerald-400">{t('llm.installDone')}</p>}
      {error !== null && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  )
}
