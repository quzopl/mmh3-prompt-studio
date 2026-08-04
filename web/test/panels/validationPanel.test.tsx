import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ValidationPanel } from '../../src/panels/ValidationPanel.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useLang } from '../../src/i18n/useT.js'

const diagnostic = (over: Partial<Parameters<typeof Object>[0]> = {}) => ({
  ruleId: 'STYLE_REQUIRED',
  severity: 'error' as const,
  message: 'Każdy tryb wymaga podania stylu wizualnego.',
  messageEn: 'Every mode requires a visual style.',
  ref: { kind: 'project' as const, id: 'p' },
  guideRef: 'guide_base §4.1',
  ...over,
})

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useSelection.setState({ selected: [] })
  useProject.setState({ diagnostics: [], prompt: '', tokens: [] })
})

describe('ValidationPanel', () => {
  it('ogłasza gotowość, gdy nie ma uwag', () => {
    render(<ValidationPanel />)
    expect(screen.getByText(/gotowy do eksportu/i)).toBeInTheDocument()
  })

  it('wypisuje diagnostykę w języku interfejsu', () => {
    useProject.setState({ diagnostics: [diagnostic()] })
    render(<ValidationPanel />)
    expect(screen.getByText(/wymaga podania stylu/i)).toBeInTheDocument()
    useLang.setState({ lang: 'en' })
    render(<ValidationPanel />)
    expect(screen.getAllByText(/requires a visual style/i).length).toBeGreaterThan(0)
  })

  it('pokazuje cytat ze źródła', () => {
    useProject.setState({ diagnostics: [diagnostic()] })
    render(<ValidationPanel />)
    expect(screen.getByText(/guide_base §4.1/)).toBeInTheDocument()
  })

  it('zaznacza obiekt po kliknięciu w diagnostykę', async () => {
    useProject.setState({ diagnostics: [diagnostic({ ref: { kind: 'shot', id: 'shot-2' } })] })
    render(<ValidationPanel />)
    await userEvent.click(screen.getByRole('button', { name: /wymaga podania stylu/i }))
    expect(useSelection.getState().selected).toEqual([{ kind: 'shot', id: 'shot-2' }])
  })

  it('nie ogłasza gotowości, gdy jest choć jeden błąd', () => {
    useProject.setState({ diagnostics: [diagnostic()] })
    render(<ValidationPanel />)
    expect(screen.queryByText(/gotowy do eksportu/i)).not.toBeInTheDocument()
  })
})
