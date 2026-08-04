import type { ReactNode } from 'react'
import type { ObjectRef } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { useSelection } from '../store/selectionStore.js'
import { useT } from '../i18n/useT.js'

const sameRef = (a: ObjectRef | null, b: ObjectRef): boolean =>
  a !== null && a.kind === b.kind && a.id === b.id

export function PromptPanel() {
  const t = useT()
  const prompt = useProject(state => state.prompt)
  const tokens = useProject(state => state.tokens)
  const selected = useSelection(state => state.selected)
  const select = useSelection(state => state.select)

  const ordered = [...tokens].sort((a, b) => a.start - b.start)
  const pieces: ReactNode[] = []
  let cursor = 0

  ordered.forEach((token, index) => {
    if (token.start < cursor) return
    if (token.start > cursor) {
      pieces.push(<span key={`t${index}`}>{prompt.slice(cursor, token.start)}</span>)
    }
    const label = prompt.slice(token.start, token.end)
    pieces.push(
      <button
        key={`k${index}`}
        type="button"
        onClick={() => select(token.ref)}
        aria-current={sameRef(selected, token.ref) ? 'true' : undefined}
        className={`rounded px-0.5 ${
          sameRef(selected, token.ref) ? 'bg-sky-700 text-white' : 'hover:bg-neutral-700'
        }`}
      >
        {label}
      </button>,
    )
    cursor = token.end
  })

  if (cursor < prompt.length) pieces.push(<span key="rest">{prompt.slice(cursor)}</span>)

  return (
    <section aria-label={t('editor.prompt')} className="h-full overflow-auto p-3">
      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
        {pieces}
      </pre>
    </section>
  )
}
