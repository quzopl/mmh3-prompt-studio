import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@mmh3/shared'
import { ValidationPanel } from '../../src/panels/ValidationPanel.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useCritic, type CriticNote } from '../../src/store/criticStore.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { useTimelineShortcuts } from '../../src/timeline/useTimelineShortcuts.js'
import { useLang } from '../../src/i18n/useT.js'
import { DICT } from '../../src/i18n/dict.js'

/**
 * Zadanie 12: uwagi krytyka w panelu walidacji, w osobnej grupie od reguł
 * deterministycznych. Uwaga jest opinią modelu, nie dowodliwym faktem jak
 * reguła — stąd sześć zachowań z briefu, każde osobnym testem: własna grupa
 * z nagłówkiem, kliknięcie zaznacza jak diagnostyka, drugi bieg ZASTĘPUJE
 * (nie dokłada), zmiana projektu NIE kasuje uwag (tylko oznacza je jako
 * nieaktualne), uwagi nigdy nie liczą się do blokady eksportu, a grupa jest
 * NIEOBECNA (nie pusta), gdy uwag nie ma.
 */

const baseProject: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'REF',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Sitcom', assets: [],
  labels: [],
  speakers: [],
  shots: [{
    id: 'shot-1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
    composition: '', body: [], cameraMoves: [], dialogue: [],
    screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
  }],
  audio: { overallSoundscape: 'Room tone.', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

/** Bezpieczny odczyt projektu ze store'u — bez asercji nienull (`!`), zgodnie
 * z konwencją repo, tak jak `currentOf` w `useLlmRun.test.tsx`. */
function currentProject(): Project {
  const project = useProject.getState().project
  if (project === null) throw new Error('projekt jeszcze nie wczytany')
  return project
}

const NOTE_MESSAGE = 'Ujęcie trwa podejrzanie długo jak na ilość dialogu'

const note = (over: Partial<CriticNote> = {}): CriticNote => ({
  ref: { kind: 'shot', id: 'shot-1' },
  message: NOTE_MESSAGE,
  severity: 'warning',
  ...over,
})

const diagnostic = {
  ruleId: 'STYLE_REQUIRED',
  severity: 'error' as const,
  message: 'Każdy tryb wymaga podania stylu wizualnego.',
  messageEn: 'Every mode requires a visual style.',
  ref: { kind: 'project' as const, id: 'p' },
  guideRef: 'guide_base §4.1',
}

/**
 * Teksty wprost ze SŁOWNIKA, nie przepisane ręcznie do testu — round 1
 * recenzji zadania 12: literał `/model językowego/i` w teście miał literówkę
 * względem prawdziwego napisu w `dict.ts` („modelu", nie „model"), więc
 * asercja o BRAKU nagłówka nigdy nie mogła się nie powieść — nawet po
 * usunięciu strażnika chowającego pustą grupę. Odczyt wprost z `DICT`
 * eliminuje możliwość takiego rozjazdu raz na zawsze: literówka w `dict.ts`
 * zmieniłaby też oczekiwaną wartość tutaj, więc test nigdy nie przestanie
 * być w stanie zaczerwienić się na naprawdę zepsute zachowanie.
 */
const CRITIC_TITLE = DICT.pl['validation.criticTitle']
const CRITIC_SOURCE = DICT.pl['validation.criticSource']
const CRITIC_STALE = DICT.pl['validation.criticStale']
/** Dokładny tekst podpisu wiersza, gdy uwaga jest nieaktualna — `ValidationPanel`
 * skleja oba fragmenty w jednym `<span>` jako `źródło · nieaktualność`. */
const CRITIC_SOURCE_STALE = `${CRITIC_SOURCE} · ${CRITIC_STALE}`

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useSelection.setState({ selected: [] })
  useCritic.setState({ notes: [], capturedProject: null })
  usePlayhead.getState().reset()
  useProject.getState().load('test-projekt', baseProject)
  useProject.setState({ diagnostics: [] })
})

describe('ValidationPanel — grupa uwag krytyka nieobecna bez uwag', () => {
  it('bez uwag grupa (i jej nagłówek) w ogóle się nie renderuje', () => {
    render(<ValidationPanel />)
    expect(screen.queryByText(CRITIC_TITLE)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: CRITIC_TITLE })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: CRITIC_TITLE })).not.toBeInTheDocument()
  })
})

describe('ValidationPanel — grupa uwag krytyka, osobna od reguł', () => {
  it('nagłówek grupy mówi, że uwagi pochodzą z modelu językowego', () => {
    useCritic.getState().setNotes([note()], currentProject())
    render(<ValidationPanel />)
    expect(screen.getByText(CRITIC_TITLE)).toBeInTheDocument()
  })

  // Round 1 recenzji: nagłówek musi być prawdziwym nagłówkiem w drzewie
  // dostępności (nawigacja po nagłówkach/landmarkach czytnika ekranu), nie
  // tylko wizualnie — inaczej separacja reguł od opinii modelu, będąca całym
  // sensem zadania 12, nie istnieje dla kogoś, kto nie widzi ekranu.
  it('nagłówek jest prawdziwym elementem nagłówkowym, a lista jest z nim powiązana jako grupa', () => {
    useCritic.getState().setNotes([note()], currentProject())
    render(<ValidationPanel />)

    expect(screen.getByRole('heading', { name: CRITIC_TITLE })).toBeInTheDocument()
    const group = screen.getByRole('group', { name: CRITIC_TITLE })
    expect(within(group).getByText(NOTE_MESSAGE)).toBeInTheDocument()
  })

  it('uwaga renderuje się w swojej liście, osobnej od listy reguł — nie wymieszana', () => {
    useProject.setState({ diagnostics: [diagnostic] })
    useCritic.getState().setNotes([note()], currentProject())
    render(<ValidationPanel />)

    const lists = screen.getAllByRole('list')
    expect(lists).toHaveLength(2)

    const [rulesList, notesList] = lists as [HTMLElement, HTMLElement]
    expect(within(rulesList).getByText(/wymaga podania stylu/i)).toBeInTheDocument()
    expect(within(rulesList).queryByText(NOTE_MESSAGE)).not.toBeInTheDocument()

    expect(within(notesList).getByText(NOTE_MESSAGE)).toBeInTheDocument()
    expect(within(notesList).queryByText(/wymaga podania stylu/i)).not.toBeInTheDocument()
  })

  it('podpis wiersza mówi, że źródłem jest model językowy', () => {
    useCritic.getState().setNotes([note()], currentProject())
    render(<ValidationPanel />)
    expect(screen.getByText(CRITIC_SOURCE)).toBeInTheDocument()
  })
})

describe('ValidationPanel — kliknięcie w uwagę zaznacza obiekt z jej ref', () => {
  it('tak samo jak przy diagnostyce — przez `same`', async () => {
    useCritic.getState().setNotes([note({ ref: { kind: 'shot', id: 'shot-1' } })], currentProject())
    render(<ValidationPanel />)

    await userEvent.click(screen.getByRole('button', { name: /podejrzanie długo/i }))
    expect(useSelection.getState().selected).toEqual([{ kind: 'shot', id: 'shot-1' }])
  })
})

describe('ValidationPanel — drugi bieg krytyka zastępuje uwagi, nie dokłada', () => {
  it('store po dwóch wywołaniach setNotes trzyma wyłącznie wynik drugiego', () => {
    const project = currentProject()
    useCritic.getState().setNotes([note({ message: 'Pierwsza uwaga' })], project)
    useCritic.getState().setNotes([note({ message: 'Druga uwaga' })], project)

    expect(useCritic.getState().notes).toEqual([note({ message: 'Druga uwaga' })])
  })

  it('panel po drugim biegu pokazuje wyłącznie nowe uwagi — stara znika, nie zostaje obok', () => {
    const project = currentProject()
    useCritic.getState().setNotes([note({ message: 'Stara uwaga sprzed pierwszego biegu' })], project)
    useCritic.getState().setNotes([note({ message: 'Jedyna uwaga drugiego biegu' })], project)
    render(<ValidationPanel />)

    expect(screen.queryByText('Stara uwaga sprzed pierwszego biegu')).not.toBeInTheDocument()
    expect(screen.getByText('Jedyna uwaga drugiego biegu')).toBeInTheDocument()
  })
})

describe('ValidationPanel — zmiana projektu nie kasuje uwag, tylko oznacza je jako nieaktualne', () => {
  it('uwaga zostaje widoczna po edycji projektu, ale panel dopisuje ostrzeżenie o nieaktualności', () => {
    const projectV1 = currentProject()
    useCritic.getState().setNotes([note()], projectV1)
    const { rerender } = render(<ValidationPanel />)

    expect(screen.getByText(NOTE_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(CRITIC_SOURCE_STALE)).not.toBeInTheDocument()

    // Symulacja edycji: `useProject.apply/load` zawsze oddaje NOWY obiekt
    // projektu, nigdy nie mutuje istniejącego — ten sam mechanizm tutaj.
    const projectV2: Project = { ...projectV1, style: 'Neo-noir' }
    useProject.setState({ project: projectV2 })
    rerender(<ValidationPanel />)

    // Uwaga NIE zniknęła po cichu — wciąż jest w store i w drzewie.
    expect(useCritic.getState().notes).toHaveLength(1)
    expect(screen.getByText(NOTE_MESSAGE)).toBeInTheDocument()
    // Ale panel pokazuje, że jest ze starszej wersji projektu.
    expect(screen.getByText(CRITIC_SOURCE_STALE)).toBeInTheDocument()
  })

  it('bez żadnej zmiany projektu uwaga nie jest oznaczona jako nieaktualna', () => {
    useCritic.getState().setNotes([note()], currentProject())
    render(<ValidationPanel />)
    expect(screen.queryByText(CRITIC_SOURCE_STALE)).not.toBeInTheDocument()
    expect(screen.getByText(CRITIC_SOURCE)).toBeInTheDocument()
  })

  // Round 1 recenzji: sprawdzone ręcznie, nie w garniturze — brakujący trzeci
  // stan. Użytkownik wraca właśnie do TEGO stanu: edytuje projekt (uwaga
  // staje się nieaktualna), potem uruchamia krytyka jeszcze raz. Nowe uwagi
  // są zapisywane z referencją AKTUALNEGO projektu (`LlmPanel`'s effect w
  // `useCritic.getState().setNotes(run.notes, currentProject)`), więc
  // oznaczenie nieaktualności ma zniknąć — inaczej świeże uwagi wyglądałyby
  // na przestarzałe.
  it('kolejny bieg krytyka po edycji usuwa oznaczenie nieaktualności', () => {
    const projectV1 = currentProject()
    useCritic.getState().setNotes([note({ message: 'Uwaga sprzed edycji' })], projectV1)
    const { rerender } = render(<ValidationPanel />)

    const projectV2: Project = { ...projectV1, style: 'Neo-noir' }
    useProject.setState({ project: projectV2 })
    rerender(<ValidationPanel />)
    expect(screen.getByText(CRITIC_SOURCE_STALE)).toBeInTheDocument()

    // Drugi bieg krytyka, TERAZ, po edycji — zapisany z referencją `projectV2`.
    useCritic.getState().setNotes([note({ message: 'Uwaga po drugim biegu' })], projectV2)
    rerender(<ValidationPanel />)

    expect(screen.queryByText(CRITIC_SOURCE_STALE)).not.toBeInTheDocument()
    expect(screen.getByText(CRITIC_SOURCE)).toBeInTheDocument()
    expect(screen.getByText('Uwaga po drugim biegu')).toBeInTheDocument()
    expect(screen.queryByText('Uwaga sprzed edycji')).not.toBeInTheDocument()
  })
})

describe('ValidationPanel — uwagi nie liczą się do blokady eksportu', () => {
  it('projekt bez błędów reguł pokazuje gotowość do eksportu mimo obecnych uwag krytyka', () => {
    useProject.setState({ diagnostics: [] })
    useCritic.getState().setNotes([note({ severity: 'warning' })], currentProject())
    render(<ValidationPanel />)

    expect(screen.getByText(/gotowy do eksportu/i)).toBeInTheDocument()
  })

  it('licznik problemów nad listą reguł liczy WYŁĄCZNIE diagnostykę, nie uwagi', () => {
    useProject.setState({ diagnostics: [diagnostic] })
    useCritic.getState().setNotes([note(), note({ ref: { kind: 'shot', id: 'shot-1' } })], currentProject())
    render(<ValidationPanel />)

    // Jeden błąd reguły, dwie uwagi krytyka — licznik ma pokazać 1, nie 3.
    expect(screen.getByText('Problemy: 1')).toBeInTheDocument()
  })
})

describe('ValidationPanel — klawiatura na wierszu uwagi nie wypływa do globalnego skrótu osi czasu', () => {
  function ShortcutsHarness() {
    useTimelineShortcuts()
    return null
  }

  it('spacja na wierszu uwagi zaznacza obiekt lokalnie i NIE przełącza odtwarzania', async () => {
    useCritic.getState().setNotes([note()], currentProject())
    render(<><ValidationPanel /><ShortcutsHarness /></>)
    expect(usePlayhead.getState().playing).toBe(false)

    const row = screen.getByRole('button', { name: /podejrzanie długo/i })
    row.focus()
    await userEvent.keyboard(' ')

    // Gdyby spacja wypłynęła do `useTimelineShortcuts` na `window`, ten sam
    // klawisz przełączyłby odtwarzanie — dokładnie usterka z czterech
    // wcześniejszych zadań (natywny `<button>` zamiast `role="button"` z
    // jawnym `stopPropagation`).
    expect(usePlayhead.getState().playing).toBe(false)
    expect(useSelection.getState().selected).toEqual([{ kind: 'shot', id: 'shot-1' }])
  })

  it('Enter na wierszu uwagi zaznacza obiekt lokalnie i NIE przełącza odtwarzania', async () => {
    useCritic.getState().setNotes([note()], currentProject())
    render(<><ValidationPanel /><ShortcutsHarness /></>)

    const row = screen.getByRole('button', { name: /podejrzanie długo/i })
    row.focus()
    await userEvent.keyboard('{Enter}')

    expect(usePlayhead.getState().playing).toBe(false)
    expect(useSelection.getState().selected).toEqual([{ kind: 'shot', id: 'shot-1' }])
  })
})
