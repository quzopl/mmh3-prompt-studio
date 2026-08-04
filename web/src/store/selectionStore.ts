import { create } from 'zustand'
import type { ObjectRef } from '@mmh3/shared'

interface SelectionState {
  selected: ObjectRef | null
  select: (ref: ObjectRef) => void
  clear: () => void
}

export const useSelection = create<SelectionState>(set => ({
  selected: null,
  select: ref => set({ selected: ref }),
  clear: () => set({ selected: null }),
}))
