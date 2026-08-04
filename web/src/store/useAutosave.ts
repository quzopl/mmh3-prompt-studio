import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client.js'
import { useProject } from './projectStore.js'

const DEFAULT_DELAY_MS = 800

/**
 * Wysyła projekt na serwer po chwili bezczynności. Bez opóźnienia każde
 * naciśnięcie klawisza w polu tekstowym byłoby osobnym żądaniem.
 */
export function useAutosave(slug: string, delayMs = DEFAULT_DELAY_MS) {
  const project = useProject(state => state.project)
  const dirty = useProject(state => state.dirty)
  const markSaved = useProject(state => state.markSaved)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!dirty || !project) return
    if (timer.current) clearTimeout(timer.current)

    timer.current = setTimeout(() => {
      setSaving(true)
      api.saveProject(slug, project)
        .then(() => {
          setError(null)
          // Znacznik zdejmujemy tylko, jeśli w trakcie zapisu nic się nie zmieniło.
          // Inaczej edycja wykonana w locie zostałaby uznana za zapisaną i po
          // przeładowaniu zniknęłaby bez ostrzeżenia.
          if (useProject.getState().project === project) markSaved()
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => setSaving(false))
    }, delayMs)

    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [slug, project, dirty, delayMs, markSaved])

  return { saving, error }
}
