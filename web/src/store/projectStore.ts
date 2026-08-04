import { create } from 'zustand'
import { buildPrompt, type Diagnostic, type Project, type Token } from '@mmh3/shared'

const HISTORY_LIMIT = 200

interface Compiled {
  prompt: string
  tokens: Token[]
  diagnostics: Diagnostic[]
}

interface ProjectState extends Compiled {
  slug: string | null
  project: Project | null
  past: Project[]
  future: Project[]
  dirty: boolean
  load: (slug: string, project: Project) => void
  apply: (mutate: (project: Project) => Project) => void
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

  load: (slug, project) =>
    set({ slug, project, past: [], future: [], dirty: false, ...compile(project) }),

  apply: mutate => {
    const { project, past } = get()
    if (!project) return
    const next = mutate(project)
    set({
      project: next,
      past: [...past, project].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
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
      ...compile(next),
    })
  },

  markSaved: () => set({ dirty: false }),
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}))
