import { describe, expect, it } from 'vitest'
import { scopeForLabel, toggleLabelInShot } from '../../src/timeline/retentionScope.js'
import { baseProject, emptyShot } from './fixtures.js'

const withRefs = (a: string[], b: string[], c: string[]) => ({
  ...baseProject([
    { ...emptyShot('a', 0, 0), labelRefs: a },
    { ...emptyShot('b', 1, 3000), labelRefs: b },
    { ...emptyShot('c', 2, 6000), labelRefs: c },
  ]),
  labels: [{ id: 'l1', kind: 'subject' as const, index: 1, assetIds: [], definition: 'kobieta', role: 'bohaterka', standalone: false }],
})

describe('scopeForLabel', () => {
  it('wymienia ujęcia, w których etykieta występuje', () => {
    expect(scopeForLabel(withRefs(['l1'], [], ['l1']), 'l1')).toBe('appears in [Shot 1], [Shot 3]')
  })

  it('nie stawia nawiasu, gdy etykieta jest we wszystkich ujęciach', () => {
    expect(scopeForLabel(withRefs(['l1'], ['l1'], ['l1']), 'l1')).toBe('')
  })

  it('nie stawia nawiasu, gdy etykiety nie ma nigdzie', () => {
    expect(scopeForLabel(withRefs([], [], []), 'l1')).toBe('')
  })

  it('numeruje ujęcia po kolejności na osi, a nie po kolejności w tablicy', () => {
    const project = withRefs([], [], ['l1'])
    const reordered = { ...project, shots: [...project.shots].reverse() }
    expect(scopeForLabel(reordered, 'l1')).toBe('appears in [Shot 3]')
  })
})

describe('toggleLabelInShot', () => {
  it('dokłada etykietę do ujęcia, które jej nie ma', () => {
    const next = toggleLabelInShot(withRefs([], [], []), 'l1', 'b')
    expect(next.shots.find(s => s.id === 'b')?.labelRefs).toEqual(['l1'])
  })

  it('zdejmuje etykietę z ujęcia, które ją ma', () => {
    const next = toggleLabelInShot(withRefs([], ['l1'], []), 'l1', 'b')
    expect(next.shots.find(s => s.id === 'b')?.labelRefs).toEqual([])
  })

  it('przelicza zakres w odpowiadającym wpisie retencji', () => {
    const project = {
      ...withRefs(['l1'], [], []),
      ref: { taskTypes: [], summaryText: '', retention: [{ id: 'r1', labelId: 'l1', scope: '', marker: 'fully_preserved' as const, note: '' }] },
    }
    const next = toggleLabelInShot(project, 'l1', 'c')
    expect(next.ref.retention[0]?.scope).toBe('appears in [Shot 1], [Shot 3]')
  })

  it('nieznane ujęcie zwraca ten sam obiekt', () => {
    const project = withRefs([], [], [])
    expect(toggleLabelInShot(project, 'l1', 'brak')).toBe(project)
  })
})
