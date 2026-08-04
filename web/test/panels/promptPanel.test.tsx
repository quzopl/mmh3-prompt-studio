import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PromptPanel } from '../../src/panels/PromptPanel.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useLang } from '../../src/i18n/useT.js'

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useSelection.setState({ selected: [] })
  useProject.setState({
    slug: 'test', project: null, past: [], future: [], dirty: false,
    prompt: 'integrated_multimodal_description: [Shot 1] Live-action, cinematic, a shot.',
    tokens: [{ start: 35, end: 43, ref: { kind: 'shot', id: 'shot-1' } }],
    diagnostics: [],
  })
})

describe('PromptPanel', () => {
  it('pokazuje skompilowany prompt', () => {
    render(<PromptPanel />)
    expect(screen.getByText(/integrated_multimodal_description/)).toBeInTheDocument()
  })

  it('zaznacza obiekt po kliknięciu w token', async () => {
    render(<PromptPanel />)
    await userEvent.click(screen.getByRole('button', { name: '[Shot 1]' }))
    expect(useSelection.getState().selected).toEqual([{ kind: 'shot', id: 'shot-1' }])
  })

  it('wyróżnia token odpowiadający zaznaczeniu', () => {
    useSelection.setState({ selected: [{ kind: 'shot', id: 'shot-1' }] })
    render(<PromptPanel />)
    expect(screen.getByRole('button', { name: '[Shot 1]' })).toHaveAttribute('aria-current', 'true')
  })

  it('radzi sobie z pustym promptem', () => {
    useProject.setState({ prompt: '', tokens: [] })
    render(<PromptPanel />)
    expect(screen.getByRole('region', { name: /prompt/i })).toBeInTheDocument()
  })
})
