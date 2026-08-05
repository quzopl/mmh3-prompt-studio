import { create } from 'zustand'
import type { ObjectRef, Project } from '@mmh3/shared'

/**
 * Kształt zgodny z `CriticNote` w `server/src/llm/tasks/critic.ts` — web NIE
 * zależy od pakietu `@mmh3/server` (ten sam wzorzec co `RedactTarget` w
 * `LlmPanel.tsx`, przepisany z `server/src/llm/tasks/redact.ts`), więc kształt
 * jest zduplikowany tutaj, nie zaimportowany wprost.
 */
export interface CriticNote {
  ref: ObjectRef
  message: string
  severity: 'hint' | 'warning'
}

interface CriticState {
  notes: CriticNote[]
  /**
   * Referencja PROJEKTU w chwili zapisania uwag — sam wskaźnik, nie kopia
   * treści. `useProject` (`apply`/`undo`/`redo`/`load`, `store/projectStore.ts`)
   * zawsze oddaje NOWY obiekt projektu przy każdej zmianie i nigdy nie
   * mutuje istniejącego, więc porównanie `===` z bieżącym `project` jest
   * jednym porównaniem wskaźników — tanim na każdym renderze panelu — i
   * NIGDY fałszywie ujemnym: każda zmiana projektu, choćby w jednym polu,
   * daje nową referencję. Odwrotność (porównywanie całego drzewa projektu
   * pole po polu przy każdym renderze) byłaby droga i rosłaby wraz z
   * rozmiarem projektu bez żadnej korzyści ponad to, co referencja mówi za
   * darmo.
   */
  capturedProject: Project | null
  /**
   * Zastępuje poprzednie uwagi, nigdy nie dokłada — drugi bieg krytyka w tej
   * samej sesji ma dać dokładnie tyle uwag, ile zwrócił, nie sumę z
   * poprzednim biegiem. Bez tego lista rosłaby bez ograniczenia przy każdym
   * kolejnym uruchomieniu (brief zadania 12).
   */
  setNotes: (notes: CriticNote[], project: Project) => void
  clear: () => void
}

export const useCritic = create<CriticState>(set => ({
  notes: [],
  capturedProject: null,
  setNotes: (notes, project) => set({ notes, capturedProject: project }),
  clear: () => set({ notes: [], capturedProject: null }),
}))

/**
 * Uwaga jest NIEAKTUALNA, gdy projekt zmienił referencję od chwili jej
 * zapisania — patrz komentarz przy `capturedProject`. Zmiana projektu
 * celowo NIE kasuje uwag (nie wołamy tu `clear()`): uwaga do promptu sprzed
 * kilku edycji może już nie mieć sensu, ale ciche znikanie całej listy byłoby
 * gorsze niż widoczna nieaktualność (brief). Panel woła tę funkcję, żeby
 * pokazać ostrzeżenie zamiast usuwać cokolwiek.
 */
export function isCriticStale(capturedProject: Project | null, currentProject: Project | null): boolean {
  return capturedProject !== null && capturedProject !== currentProject
}
