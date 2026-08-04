import type { Diagnostic, Mode, Project, Token } from '@mmh3/shared'

export interface ProjectSummary {
  slug: string
  name: string
  mode: Mode
  updatedAt: string
}

export interface ProjectResponse {
  project: Project
  prompt: string
  tokens: Token[]
  diagnostics: Diagnostic[]
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  })

  if (!response.ok) {
    let message = `Serwer odpowiedział kodem ${response.status}`
    try {
      const body = await response.json() as { error?: string }
      if (body.error) message = body.error
    } catch {
      // Odpowiedź bez JSON-a — zostaje komunikat z kodem statusu.
    }
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) return undefined as T
  return await response.json() as T
}

export const api = {
  listProjects: () => request<ProjectSummary[]>('/api/projects'),

  createProject: (name: string, mode: Mode) =>
    request<{ slug: string; project: Project }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name, mode }),
    }),

  getProject: (slug: string) => request<ProjectResponse>(`/api/projects/${slug}`),

  saveProject: (slug: string, project: Project) =>
    request<Omit<ProjectResponse, 'project'>>(`/api/projects/${slug}`, {
      method: 'PUT',
      body: JSON.stringify({ project }),
    }),

  deleteProject: (slug: string) =>
    request<void>(`/api/projects/${slug}`, { method: 'DELETE' }),
}
