import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportPanel } from '../../src/panels/ExportPanel.js'
import { useProject } from '../../src/store/projectStore.js'
import { useLang } from '../../src/i18n/useT.js'

const diagnostic = {
  ruleId: 'STYLE_REQUIRED', severity: 'error' as const,
  message: 'Brak stylu.', messageEn: 'No style.',
  ref: { kind: 'project' as const, id: 'p' }, guideRef: 'guide_base §4.1',
}

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  // `dirty: false` musi tu być jawnie — inaczej znacznik zostawiony przez
  // poprzedni test kazałby pozostałym widzieć ostrzeżenie o niezapisanym stanie.
  useProject.setState({ diagnostics: [], prompt: 'x', tokens: [], dirty: false })
})

afterEach(() => vi.restoreAllMocks())

describe('ExportPanel', () => {
  it('udostępnia odnośniki do promptu i projektu', () => {
    render(<ExportPanel slug="test" />)
    expect(screen.getByRole('link', { name: /prompt/i }))
      .toHaveAttribute('href', '/api/projects/test/export/prompt')
    expect(screen.getByRole('link', { name: /projekt/i }))
      .toHaveAttribute('href', '/api/projects/test/export/project')
  })

  it('ostrzega, gdy walidator zgłasza błąd', () => {
    useProject.setState({ diagnostics: [diagnostic] })
    render(<ExportPanel slug="test" />)
    expect(screen.getByText(/eksport zablokowany/i)).toBeInTheDocument()
  })

  it('nie ostrzega, gdy są tylko wskazówki', () => {
    useProject.setState({ diagnostics: [{ ...diagnostic, severity: 'hint' }] })
    render(<ExportPanel slug="test" />)
    expect(screen.queryByText(/eksport zablokowany/i)).not.toBeInTheDocument()
  })

  it('blokuje eksport, dopóki zmiany nie są zapisane', () => {
    useProject.setState({ diagnostics: [], prompt: 'x', tokens: [], dirty: true })
    render(<ExportPanel slug="test" />)
    expect(screen.getByText(/poczekaj na zapis/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /prompt/i })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('link', { name: /projekt/i })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: /workflow comfyui/i })).toBeDisabled()
  })

  it('nie ostrzega o niezapisanym stanie, gdy nic nie czeka na zapis', () => {
    render(<ExportPanel slug="test" />)
    expect(screen.queryByText(/poczekaj na zapis/i)).not.toBeInTheDocument()
  })

  it('komunikat o niepoprawnym pliku jest tłumaczony', async () => {
    useLang.setState({ lang: 'en' })
    render(<ExportPanel slug="test" />)
    const input = screen.getByLabelText(/upload workflow/i)
    const file = new File(['{ to nie jest json'], 'workflow.json', { type: 'application/json' })
    await userEvent.upload(input, file)
    expect(await screen.findByText(/not valid JSON/i)).toBeInTheDocument()
  })

  it('pokazuje tłumaczony komunikat, gdy błąd serwera nie jest JSON-em', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 502, statusText: 'Bad Gateway' }),
    )
    render(<ExportPanel slug="test" />)
    await userEvent.upload(
      screen.getByLabelText(/wgraj workflow/i),
      new File(['{"1":{"inputs":{"text":""}}}'], 'workflow.json', { type: 'application/json' }),
    )
    await userEvent.type(screen.getByLabelText(/identyfikator węzła/i), '1')
    await userEvent.click(screen.getByRole('button', { name: /workflow comfyui/i }))
    expect(await screen.findByText(/serwer odpowiedział kodem 502/i)).toBeInTheDocument()
  })
})
