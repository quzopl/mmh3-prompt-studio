import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectList } from '../../src/screens/ProjectList.js'
import { api } from '../../src/api/client.js'
import { useLang } from '../../src/i18n/useT.js'

beforeEach(() => useLang.setState({ lang: 'pl' }))
afterEach(() => vi.restoreAllMocks())

describe('ProjectList', () => {
  it('pokazuje komunikat, gdy nie ma projektów', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValue([])
    render(<ProjectList onOpen={vi.fn()} />)
    expect(await screen.findByText(/nie masz jeszcze żadnego projektu/i)).toBeInTheDocument()
  })

  it('wypisuje projekty i otwiera wybrany', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValue([
      { slug: 'piekarnia', name: 'Piekarnia', mode: 'T2VA', updatedAt: '2026-08-04T10:00:00Z' },
    ])
    const onOpen = vi.fn()
    render(<ProjectList onOpen={onOpen} />)
    await userEvent.click(await screen.findByRole('button', { name: /Piekarnia/ }))
    expect(onOpen).toHaveBeenCalledWith('piekarnia')
  })

  it('pokazuje komunikat błędu, gdy API zawiedzie', async () => {
    vi.spyOn(api, 'listProjects').mockRejectedValue(new Error('brak połączenia'))
    render(<ProjectList onOpen={vi.fn()} />)
    expect(await screen.findByText(/brak połączenia/)).toBeInTheDocument()
  })

  it('tworzy projekt po podaniu nazwy i trybu', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValue([])
    const create = vi.spyOn(api, 'createProject').mockResolvedValue({
      slug: 'nowy', project: {} as never,
    })
    const onOpen = vi.fn()
    render(<ProjectList onOpen={onOpen} />)

    await userEvent.click(await screen.findByRole('button', { name: /nowy projekt/i }))
    await userEvent.type(screen.getByLabelText(/nazwa projektu/i), 'Nowy')
    await userEvent.click(screen.getByRole('button', { name: /I2VA/ }))
    await userEvent.click(screen.getByRole('button', { name: /^utwórz$/i }))

    await waitFor(() => expect(create).toHaveBeenCalledWith('Nowy', 'I2VA'))
    expect(onOpen).toHaveBeenCalledWith('nowy')
  })
})
