import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api, ApiError } from '../../src/api/client.js'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api', () => {
  it('pobiera listę projektów', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ slug: 'a', name: 'A', mode: 'T2VA', updatedAt: 'x' }]))
    expect(await api.listProjects()).toHaveLength(1)
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/projects')
  })

  it('tworzy projekt metodą POST', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ slug: 'a', project: {} }, 201))
    await api.createProject('A', 'T2VA')
    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('/api/projects')
    expect(init!.method).toBe('POST')
    expect(JSON.parse(String(init!.body))).toEqual({ name: 'A', mode: 'T2VA' })
  })

  it('zamienia odpowiedź błędu na ApiError z komunikatem serwera', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'Projekt już istnieje' }, 409))
    await expect(api.createProject('A', 'T2VA')).rejects.toThrow(/już istnieje/)
    await expect(api.createProject('A', 'T2VA')).rejects.toBeInstanceOf(ApiError)
  })

  it('zachowuje kod statusu w błędzie', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'Nie ma' }, 404))
    await expect(api.getProject('x')).rejects.toMatchObject({ status: 404 })
  })

  it('radzi sobie z odpowiedzią błędu, która nie jest JSON-em', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('awaria', { status: 500 }))
    await expect(api.listProjects()).rejects.toThrow(/500/)
  })
})
