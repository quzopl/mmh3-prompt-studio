import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createScale } from '../../src/timeline/scale.js'
import { ReferencesTrack } from '../../src/timeline/ReferencesTrack.jsx'
import { useProject } from '../../src/store/projectStore.js'
import { baseProject, emptyShot } from './fixtures.js'

const scale = createScale(8000, 800, 1)

const refProject = (mode: 'REF' | 'T2VA') => ({
  ...baseProject([
    { ...emptyShot('a', 0, 0), labelRefs: ['l1'] },
    { ...emptyShot('b', 1, 4000), labelRefs: [] },
  ]),
  mode,
  labels: [{ id: 'l1', kind: 'subject' as const, index: 1, assetIds: [], definition: 'kobieta', role: 'bohaterka', standalone: false }],
})

beforeEach(() => { useProject.getState().load('test', refProject('REF')) })

describe('ReferencesTrack', () => {
  it('daje każdej etykiecie wiersz z kratką na ujęcie', () => {
    render(<ReferencesTrack scale={scale} />)
    expect(screen.getAllByRole('button', { name: /etykieta <Subject 1> w ujęciu/i })).toHaveLength(2)
  })

  it('kratka pokazuje, czy etykieta występuje w tym ujęciu', () => {
    render(<ReferencesTrack scale={scale} />)
    expect(screen.getByRole('button', { name: /w ujęciu 1/i }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /w ujęciu 2/i }).getAttribute('aria-pressed')).toBe('false')
  })

  it('kliknięcie kratki dokłada etykietę i przelicza zakres', async () => {
    const user = userEvent.setup()
    useProject.getState().load('test', {
      ...refProject('REF'),
      ref: { taskTypes: [], summaryText: '', retention: [{ id: 'r1', labelId: 'l1', scope: '', marker: 'fully_preserved' as const, note: '' }] },
    })
    render(<ReferencesTrack scale={scale} />)
    await user.click(screen.getByRole('button', { name: /w ujęciu 2/i }))
    expect(useProject.getState().project?.ref.retention[0]?.scope).toBe('')
    expect(useProject.getState().project?.shots.find(s => s.id === 'b')?.labelRefs).toEqual(['l1'])
  })

  it('nie pokazuje się poza trybem REF', () => {
    useProject.getState().load('test', refProject('T2VA'))
    const { container } = render(<ReferencesTrack scale={scale} />)
    expect(container.firstChild).toBeNull()
  })
})
