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

  it('kliknięcie propozycji dzieli kwestię na cięciu i zostawia jeden wpis historii', async () => {
    const user = userEvent.setup()
    render(<DialogueTracks scale={scale} />)
    const before = useProject.getState().past.length

    await user.click(screen.getByRole('button', { name: /przechodzi przez cięcie/i }))

    // Nie dwie flagi na tym samym obiekcie (odrzucona pierwsza wersja) —
    // dwa obiekty, jeden po każdej stronie cięcia, patrz komentarz przy
    // `splitAtSceneTrans` w `proposals.ts`.
    const shots = useProject.getState().project?.shots ?? []
    const original = shots.flatMap(s => s.dialogue).find(e => e.id === 'd1')
    const shotB = shots.find(s => s.id === 'b')
    const continuation = shotB?.dialogue[0]

    expect(original?.sceneTransAfter).toBe(true)
    expect(original?.sceneTransBefore).toBe(false)
    expect(shotB?.dialogue).toHaveLength(1)
    expect(continuation?.sceneTransBefore).toBe(true)
    expect(useProject.getState().past.length).toBe(before + 1)
  })

  it('po zastosowaniu propozycja znika', async () => {
    const user = userEvent.setup()
    render(<DialogueTracks scale={scale} />)

    await user.click(screen.getByRole('button', { name: /przechodzi przez cięcie/i }))

    expect(screen.queryByRole('button', { name: /przechodzi przez cięcie/i })).toBeNull()
  })
})
