import { create } from 'zustand'
import type { ObjectRef } from '@mmh3/shared'

/** Tożsamość zaznaczenia — wspólna dla store'u i konsumentów spoza niego. */
export const same = (a: ObjectRef, b: ObjectRef): boolean => a.kind === b.kind && a.id === b.id

interface SelectionState {
  selected: ObjectRef[]
  select: (ref: ObjectRef) => void
  toggle: (ref: ObjectRef) => void
  clear: () => void
  isSelected: (ref: ObjectRef) => boolean
}

export const useSelection = create<SelectionState>((set, get) => ({
  selected: [],
  select: ref => set({ selected: [ref] }),
  toggle: ref => set(state => ({
    selected: state.selected.some(candidate => same(candidate, ref))
      ? state.selected.filter(candidate => !same(candidate, ref))
      : [...state.selected, ref],
  })),
  clear: () => set({ selected: [] }),
  isSelected: ref => get().selected.some(candidate => same(candidate, ref)),
}))
