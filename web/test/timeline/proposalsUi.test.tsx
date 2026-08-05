import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createScale } from '../../src/timeline/scale.js'
import { DialogueTracks } from '../../src/timeline/DialogueTracks.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { projectWithCrossingLine } from './fixtures.js'

const scale = createScale(8000, 800, 1)

beforeEach(() => {
  useSelection.setState({ selected: [] })
  useProject.getState().load('test', projectWithCrossingLine())
})

describe('propozycje na klipie dialogowym', () => {
  it('pokazuje przycisk propozycji, gdy kwestia przechodzi przez cięcie', () => {
    render(<DialogueTracks scale={scale} />)
    expect(screen.getByRole('button', { name: /przechodzi przez cięcie/i })).toBeTruthy()
  })

  it('kliknięcie propozycji zmienia model i zostawia jeden wpis historii', async () => {
    const user = userEvent.setup()
    render(<DialogueTracks scale={scale} />)
    const before = useProject.getState().past.length

    await user.click(screen.getByRole('button', { name: /przechodzi przez cięcie/i }))

    const event = useProject.getState().project?.shots.flatMap(s => s.dialogue).find(e => e.id === 'd1')
    expect(event?.sceneTransBefore).toBe(true)
    expect(event?.sceneTransAfter).toBe(true)
    expect(useProject.getState().past.length).toBe(before + 1)
  })

  it('po zastosowaniu propozycja znika', async () => {
    const user = userEvent.setup()
    render(<DialogueTracks scale={scale} />)

    await user.click(screen.getByRole('button', { name: /przechodzi przez cięcie/i }))

    expect(screen.queryByRole('button', { name: /przechodzi przez cięcie/i })).toBeNull()
  })
})
