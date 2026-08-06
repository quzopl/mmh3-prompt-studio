import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PromptPanel } from '../../src/panels/PromptPanel.js'
import { useProject } from '../../src/store/projectStore.js'
import { baseProject, emptyShot } from '../timeline/fixtures.js'

/**
 * Kopiowanie promptu. Panel odbiera zaznaczanie myszą — każdy token jest
 * `<button>`, żeby klik wybierał obiekt — więc przycisk kopiowania jest jedyną
 * drogą do gotowego tekstu poza pobraniem pliku. Uruchomienie na serwerze
 * pokazało, że użytkownik tej drogi nie znajdował.
 */

const load = (): void => {
  useProject.getState().load('p', { ...baseProject([emptyShot('s1', 0, 0)]), style: 'Live-action' })
}

afterEach(() => {
  vi.unstubAllGlobals()
  useProject.setState({
    slug: null, project: null, past: [], future: [], dirty: false,
    lastCoalesceKey: null, prompt: '', tokens: [], diagnostics: [],
  })
})

describe('PromptPanel — kopiowanie', () => {
  it('kopiuje CAŁY prompt, nie sam widoczny fragment', async () => {
    const user = userEvent.setup()
    const written: string[] = []
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: async (text: string) => { written.push(text) } },
    })
    load()
    render(<PromptPanel />)

    await user.click(screen.getByRole('button', { name: /kopiuj prompt/i }))

    expect(written).toHaveLength(1)
    expect(written[0]).toBe(useProject.getState().prompt)
    expect(written[0]).toContain('integrated_multimodal_description')
    expect(await screen.findByText(/skopiowano/i)).toBeInTheDocument()
  })

  it('bez clipboard API sięga po drogę zapasową — przycisk nie jest martwy po HTTP', async () => {
    const user = userEvent.setup()
    // Tak wygląda przeglądarka na stronie serwowanej po zwykłym HTTP.
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
    const exec = vi.fn(() => true)
    vi.stubGlobal('document', Object.assign(document, { execCommand: exec }))
    load()
    render(<PromptPanel />)

    await user.click(screen.getByRole('button', { name: /kopiuj prompt/i }))

    expect(exec).toHaveBeenCalledWith('copy')
    expect(await screen.findByText(/skopiowano/i)).toBeInTheDocument()
  })

  it('gdy obie drogi zawiodą, mówi wprost, co zrobić ręcznie', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
    vi.stubGlobal('document', Object.assign(document, { execCommand: vi.fn(() => false) }))
    load()
    render(<PromptPanel />)

    await user.click(screen.getByRole('button', { name: /kopiuj prompt/i }))

    expect(await screen.findByText(/Ctrl\+C/i)).toBeInTheDocument()
  })
})
