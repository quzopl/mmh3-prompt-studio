import { useState } from 'react'
import { ProjectList } from './screens/ProjectList.js'
import { Editor } from './screens/Editor.js'
import { useLang, useT } from './i18n/useT.js'

export function App() {
  const t = useT()
  const { lang, setLang } = useLang()
  const [slug, setSlug] = useState<string | null>(null)

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
        <span className="font-semibold tracking-tight">{t('app.title')}</span>
        <span className="ml-auto flex gap-1 text-xs">
          {(['pl', 'en'] as const).map(option => (
            <button
              key={option}
              type="button"
              onClick={() => setLang(option)}
              aria-pressed={lang === option}
              className={`rounded px-2 py-1 ${lang === option ? 'bg-neutral-700' : 'hover:bg-neutral-800'}`}
            >
              {option.toUpperCase()}
            </button>
          ))}
        </span>
      </header>
      <main className="flex-1 overflow-auto">
        {slug === null
          ? <ProjectList onOpen={setSlug} />
          : <Editor slug={slug} onClose={() => setSlug(null)} />}
      </main>
    </div>
  )
}
