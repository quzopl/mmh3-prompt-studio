import { describe, it, expect, beforeEach } from 'vitest'
import { useSelection } from '../../src/store/selectionStore.js'

const shot = (id: string) => ({ kind: 'shot' as const, id })

beforeEach(() => useSelection.setState({ selected: [] }))

describe('useSelection', () => {
  it('zaznacza pojedynczy obiekt, zastępując poprzednie', () => {
    useSelection.getState().select(shot('a'))
    useSelection.getState().select(shot('b'))
    expect(useSelection.getState().selected).toEqual([shot('b')])
  })

  it('dokłada i zdejmuje przez toggle', () => {
    useSelection.getState().select(shot('a'))
    useSelection.getState().toggle(shot('b'))
    expect(useSelection.getState().selected).toHaveLength(2)
    useSelection.getState().toggle(shot('a'))
    expect(useSelection.getState().selected).toEqual([shot('b')])
  })

  it('rozpoznaje zaznaczenie po rodzaju i identyfikatorze, nie po referencji', () => {
    useSelection.getState().select(shot('a'))
    expect(useSelection.getState().isSelected({ kind: 'shot', id: 'a' })).toBe(true)
    expect(useSelection.getState().isSelected({ kind: 'camera', id: 'a' })).toBe(false)
  })

  it('czyści całość', () => {
    useSelection.getState().select(shot('a'))
    useSelection.getState().toggle(shot('b'))
    useSelection.getState().clear()
    expect(useSelection.getState().selected).toEqual([])
  })
})
