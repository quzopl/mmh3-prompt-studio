import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  useProject.setState({ diagnostics: [], prompt: 'x', tokens: [] })
})

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
})
