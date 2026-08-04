import { create } from 'zustand'
import { buildPrompt, type Diagnostic, type Project, type Token } from '@mmh3/shared'

const HISTORY_LIMIT = 200

interface Compiled {
  prompt: string
  tokens: Token[]
  diagnostics: Diagnostic[]
}

export interface ApplyOptions {
  /**
   * Kolejne wywołania z tym samym kluczem nadpisują wierzchołek historii
   * zamiast dokładać nowy wpis. Bez tego jeden gest przeciągnięcia zostawiłby
   * po jednej migawce całego projektu na każdy ruch myszy, a Ctrl+Z cofałby
   * klip o jeden piksel.
   */
  coalesceKey?: string
}

interface ProjectState extends Compiled {
  slug: string | null
  project: Project | null
  past: Project[]
  future: Project[]
  dirty: boolean
  lastCoalesceKey: string | null
  load: (slug: string, project: Project) => void
  apply: (mutate: (project: Project) => Project, options?: ApplyOptions) => void
  undo: () => void
  redo: () => void
  markSaved: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

/**
 * Kompilacja jest czysta i tania, więc liczymy ją lokalnie przy każdej zmianie.
 * `buildPrompt` jest funkcją totalną — model w stanie pośrednim edycji zwraca
 * pusty tekst i diagnostykę COMPILE_FAILED zamiast rzucać wyjątkiem.
 */
const compile = (project: Project): Compiled => {
  const { text, tokens, diagnostics } = buildPrompt(project)
  return { prompt: text, tokens, diagnostics }
}

export const useProject = create<ProjectState>((set, get) => ({
  slug: null,
  project: null,
  prompt: '',
  tokens: [],
  diagnostics: [],
  past: [],
  future: [],
  dirty: false,
  lastCoalesceKey: null,

  load: (slug, project) =>
    set({
      slug, project, past: [], future: [], dirty: false,
      lastCoalesceKey: null, ...compile(project),
    }),

  apply: (mutate, options) => {
    const { project, past, lastCoalesceKey } = get()
    if (!project) return
    const next = mutate(project)
    // Odmowa mutacji (np. `splitAtMs` na już istniejącym cięciu) oddaje z
    // powrotem tę samą referencję projektu — porównanie referencyjne, nie
    // głębokie, bo tylko taka odmowa jest tania i pewna. Nic się nie
    // zmieniło, więc nie ma czego cofać: wpis do historii by nie odpowiadał
    // żadnej realnej zmianie, a trzymanie klawisza wywołującego odmawianą
    // akcję zapychałoby stos cofania identycznymi migawkami.
    if (next === project) return
    const key = options?.coalesceKey ?? null
    const continues = key !== null && key === lastCoalesceKey
    set({
      project: next,
      past: continues ? past : [...past, project].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
      lastCoalesceKey: key,
      ...compile(next),
    })
  },

  undo: () => {
    const { past, project, future } = get()
    const previous = past[past.length - 1]
    if (!previous || !project) return
    set({
      project: previous,
      past: past.slice(0, -1),
      future: [project, ...future],
      dirty: true,
      lastCoalesceKey: null,
      ...compile(previous),
    })
  },

  redo: () => {
    const { future, project, past } = get()
    const next = future[0]
    if (!next || !project) return
    set({
      project: next,
      past: [...past, project],
      future: future.slice(1),
      dirty: true,
      lastCoalesceKey: null,
      ...compile(next),
    })
  },

  markSaved: () => set({ dirty: false }),
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}))
