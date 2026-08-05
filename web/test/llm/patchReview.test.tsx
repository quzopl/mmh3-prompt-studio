import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildPrompt, parseProject, type Diagnostic, type PatchOp, type Project } from '@mmh3/shared'
import { PatchReview } from '../../src/llm/PatchReview.js'
import { useProject } from '../../src/store/projectStore.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { useTimelineShortcuts } from '../../src/timeline/useTimelineShortcuts.js'
import { useLang } from '../../src/i18n/useT.js'
import { baseProject, emptyShot } from '../timeline/fixtures.js'

/**
 * Zadanie 11: przegląd łatki z wybiórczym przyjmowaniem operacji — jedyne
 * miejsce w aplikacji, gdzie treść wymyślona przez model językowy może
 * trafić do projektu. Dwie zasady z brief-u zbiorczego są tu ważniejsze niż
 * gdziekolwiek indziej (patrz komentarz w `PatchReview.tsx`), więc mają
 * własne testy niżej: brak nowej diagnostyki poza przyjętymi wyjątkami i
 * przejście przez `parseProject`.
 */

const ACCEPTED_NEW_DIAGNOSTICS = new Set([
  'SPEECH_FITS', 'SOUNDSCAPE_NA_ONLY_IF_SILENT', 'SPEAKER_SILENT_NO_ID', 'FL2VA_PREFER_SINGLE_SHOT',
])

/**
 * `buildPrompt` — NIE gołe `validate`/`compile` — bo to `buildPrompt`
 * rejestruje reguły przez efekt uboczny (`allRules()` byłoby puste bez tego,
 * i test „żadna nowa diagnostyka" przechodziłby niezależnie od tego, co robi
 * kod pod spodem — dokładnie to potknięcie brief nazywa wprost jako coś, co
 * już raz kosztowało siostrzane zadanie rundę poprawek).
 */
function diagnosticsOf(project: Project): Diagnostic[] {
  return buildPrompt(project).diagnostics
}

function newDiagnostics(before: Diagnostic[], after: Diagnostic[]): Diagnostic[] {
  const beforeKeys = new Set(before.map(d => JSON.stringify(d)))
  return after.filter(d => !beforeKeys.has(JSON.stringify(d)))
}

function assertNoUnexpectedDiagnostics(before: Project, after: Project): void {
  const added = newDiagnostics(diagnosticsOf(before), diagnosticsOf(after))
  const unexpected = added.filter(d => !ACCEPTED_NEW_DIAGNOSTICS.has(d.ruleId))
  expect(unexpected).toEqual([])
}

/** Projekt T2VA minimalny — bez kotwic ani mówców, żeby operacje z tego
 * pliku (pole stylu, pole dźwięku, struktura ujęć) nie potrzebowały żadnego
 * dodatkowego rusztowania. */
function project(shots = [emptyShot('base-shot', 0, 0)]): Project {
  return baseProject(shots)
}

const ops: PatchOp[] = [
  { kind: 'setStyle', id: 'op-style', label: 'Nowy styl wizualny', text: 'Neo-noir' },
  { kind: 'setAudio', id: 'op-soundscape', label: 'Nowe tło dźwiękowe', field: 'overallSoundscape', text: 'Deszcz na szybie.' },
  { kind: 'setAudio', id: 'op-music', label: 'Nowa muzyka niediegetyczna', field: 'nonDiegeticMusic', text: 'Cichy jazz.' },
]

function renderReview(p: Project, patchOps: PatchOp[]) {
  useProject.getState().load('test-projekt', p)
  render(<PatchReview patch={{ ops: patchOps }} />)
}

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  usePlayhead.getState().reset()
})

afterEach(() => {
  useProject.setState({
    slug: null, project: null, past: [], future: [], dirty: false,
    lastCoalesceKey: null, prompt: '', tokens: [], diagnostics: [],
  })
})

describe('PatchReview — pola wyboru operacji', () => {
  it('każda operacja ma własne pole wyboru z nazwą pochodzącą z jej label', () => {
    renderReview(project(), ops)
    for (const op of ops) {
      expect(screen.getByRole('checkbox', { name: op.label })).toBeInTheDocument()
    }
  })

  it('domyślnie żadna operacja nie jest zaznaczona', () => {
    renderReview(project(), ops)
    for (const op of ops) {
      expect(screen.getByRole('checkbox', { name: op.label })).toHaveAttribute('aria-checked', 'false')
    }
  })
})

describe('PatchReview — zatwierdzenie', () => {
  it('zatwierdzenie z pustym zaznaczeniem nic nie zmienia i nie zostawia wpisu w historii cofania', async () => {
    const p = project()
    renderReview(p, ops)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }))

    expect(useProject.getState().project).toBe(p)
    expect(useProject.getState().past).toEqual([])
  })

  it('zatwierdzenie dwóch z trzech operacji stosuje dokładnie te dwie', async () => {
    const p = project()
    renderReview(p, ops)
    const user = userEvent.setup()

    const [styleOp, soundscapeOp, musicOp] = ops
    if (!styleOp || !soundscapeOp || !musicOp) throw new Error('fixture ops niekompletne')

    await user.click(screen.getByRole('checkbox', { name: styleOp.label }))
    await user.click(screen.getByRole('checkbox', { name: musicOp.label }))
    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }))

    const result = useProject.getState().project
    expect(result).not.toBeNull()
    expect(result?.style).toBe('Neo-noir')
    expect(result?.audio.nonDiegeticMusic).toBe('Cichy jazz.')
    // Trzecia, NIE zaznaczona operacja (tło dźwiękowe) nie miała się zastosować.
    expect(result?.audio.overallSoundscape).toBe(p.audio.overallSoundscape)
  })

  it('jedno zatwierdzenie to jeden wpis historii cofania, niezależnie od liczby operacji', async () => {
    const p = project()
    renderReview(p, ops)
    const user = userEvent.setup()

    for (const op of ops) {
      await user.click(screen.getByRole('checkbox', { name: op.label }))
    }
    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }))

    expect(useProject.getState().past).toHaveLength(1)
    expect(useProject.getState().past[0]).toBe(p)
  })

  it('cofnięcie po zatwierdzeniu przywraca stan sprzed', async () => {
    const p = project()
    renderReview(p, ops)
    const user = userEvent.setup()

    const styleOp = ops[0]
    if (!styleOp) throw new Error('fixture ops niekompletne')
    await user.click(screen.getByRole('checkbox', { name: styleOp.label }))
    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }))

    expect(useProject.getState().project).not.toBe(p)
    useProject.getState().undo()
    expect(useProject.getState().project).toBe(p)
  })
})

describe('PatchReview — replaceShots i normalizeProject', () => {
  it('łatka podająca ujęcia w złej kolejności ląduje w modelu uporządkowana', async () => {
    const p = project([emptyShot('base-shot', 0, 0)])
    // Kolejność WEJŚCIOWA jest celowo odwrócona względem `startMs` — dokładnie
    // ten kształt, który `applyOps` (zadanie 4) przepisuje BEZ zmian
    // (`replaceShots` po prostu podmienia tablicę): jedynym miejscem, które
    // ma prawo to naprawić, jest `normalizeProject`.
    const shotLater = { ...emptyShot('later', 0, 5000) }
    const shotEarlier = { ...emptyShot('earlier', 1, 0) }
    const op: PatchOp = {
      kind: 'replaceShots', id: 'op-shots', label: 'Nowa struktura: 2 ujęcia',
      shots: [shotLater, shotEarlier],
    }
    renderReview(p, [op])
    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: op.label }))
    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }))

    const result = useProject.getState().project
    expect(result).not.toBeNull()
    if (result === null) return
    expect(result.shots.map(s => s.id)).toEqual(['earlier', 'later'])
    expect(result.shots[0]?.index).toBe(0)
    expect(result.shots[0]?.startMs).toBe(0)
    expect(result.shots[1]?.index).toBe(1)

    assertNoUnexpectedDiagnostics(p, result)
    expect(() => parseProject(result)).not.toThrow()
  })
})

describe('PatchReview — brak nowej diagnostyki i zgodność ze schematem', () => {
  it('zastosowanie łatki nie wprowadza diagnostyki poza przyjętymi wyjątkami, a wynik przechodzi parseProject', async () => {
    const p = project()
    renderReview(p, ops)
    const user = userEvent.setup()

    for (const op of ops) {
      await user.click(screen.getByRole('checkbox', { name: op.label }))
    }
    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }))

    const result = useProject.getState().project
    expect(result).not.toBeNull()
    if (result === null) return

    assertNoUnexpectedDiagnostics(p, result)
    expect(() => parseProject(result)).not.toThrow()
  })
})

describe('PatchReview — klawiatura nie wypływa do skrótów osi czasu', () => {
  function ShortcutsHarness() {
    useTimelineShortcuts()
    return null
  }

  it('spacja na polu wyboru zaznacza operację i nie przełącza globalnego odtwarzania', async () => {
    const p = project()
    useProject.getState().load('test-projekt', p)
    render(<><PatchReview patch={{ ops }} /><ShortcutsHarness /></>)

    expect(usePlayhead.getState().playing).toBe(false)

    const styleOp = ops[0]
    if (!styleOp) throw new Error('fixture ops niekompletne')
    const checkbox = screen.getByRole('checkbox', { name: styleOp.label })
    checkbox.focus()
    await userEvent.keyboard(' ')

    // Gdyby spacja wypłynęła do globalnego nasłuchu (`useTimelineShortcuts`
    // na `window`), ten sam klawisz przełączyłby odtwarzanie — dokładnie ten
    // błąd cztery zadania poprzedniego planu wypuściły z natywnym `<button>`.
    expect(usePlayhead.getState().playing).toBe(false)
    // Klawisz MUSI zostać obsłużony LOKALNIE — pole faktycznie się zaznaczyło.
    expect(checkbox).toHaveAttribute('aria-checked', 'true')
  })

  it('Enter na przycisku „Zatwierdź" zatwierdza wybór i nie przełącza odtwarzania', async () => {
    const p = project()
    useProject.getState().load('test-projekt', p)
    render(<><PatchReview patch={{ ops }} /><ShortcutsHarness /></>)

    const styleOp = ops[0]
    if (!styleOp) throw new Error('fixture ops niekompletne')
    const checkbox = screen.getByRole('checkbox', { name: styleOp.label })
    checkbox.focus()
    await userEvent.keyboard(' ')

    const confirmButton = screen.getByRole('button', { name: 'Zatwierdź' })
    confirmButton.focus()
    await userEvent.keyboard('{Enter}')

    expect(usePlayhead.getState().playing).toBe(false)
    expect(useProject.getState().project?.style).toBe('Neo-noir')
  })
})

describe('PatchReview — łatka może być nieaktualna (rozstrzygnięcie: opis i zastosowanie zawsze patrzą na żywy projekt)', () => {
  it('opis „przed"/„po" pokazuje bieżący stan projektu, nie zamrożoną migawkę sprzed otwarcia przeglądu', () => {
    const p = project()
    const op: PatchOp = { kind: 'setStyle', id: 'op-style', label: 'Nowy styl', text: 'Cyberpunk' }
    useProject.getState().load('test-projekt', p)
    render(<PatchReview patch={{ ops: [op] }} />)

    expect(screen.getByText(/Przed: \(nieopisane\)/)).toBeInTheDocument()

    // Symulacja edycji projektu w trakcie, gdy łatka wciąż jest na ekranie —
    // dokładnie ten scenariusz, przed którym ostrzega brief zadania 11.
    // `act()`, bo to mutacja stanu spoza zdarzenia React (nie interakcja
    // `userEvent`) — bez niej aktualizacja zustand nie zdąży się wyrenderować
    // przed asercją.
    act(() => {
      useProject.getState().apply(current => ({ ...current, style: 'Zmienione ręcznie' }))
    })

    expect(screen.getByText(/Przed: Zmienione ręcznie/)).toBeInTheDocument()
    expect(screen.queryByText(/Przed: \(nieopisane\)/)).not.toBeInTheDocument()
  })

  it('operacja, której cel zniknął w trakcie przeglądu, jest jawnie oznaczona jako niemożliwa do zastosowania i nie psuje reszty przy zatwierdzeniu', async () => {
    const shot = { ...emptyShot('shot-1', 0, 0), body: [{ kind: 'text' as const, text: 'Istniejący opis.' }] }
    const p = project([shot])
    const vanishingOp: PatchOp = {
      kind: 'setShotText', id: 'op-text', label: 'Nowy tekst ujęcia',
      shotId: shot.id, segmentIndex: 0, text: 'Nowy opis.',
    }
    const styleOp: PatchOp = { kind: 'setStyle', id: 'op-style', label: 'Nowy styl', text: 'Neo-noir' }
    useProject.getState().load('test-projekt', p)
    render(<PatchReview patch={{ ops: [vanishingOp, styleOp] }} />)

    // Przed usunięciem cel istnieje — diff pokazuje prawdziwą treść, nie komunikat o braku celu.
    expect(screen.getByText(/Po: Nowy opis\./)).toBeInTheDocument()

    // Symulacja: użytkownik usuwa jedyne ujęcie, mając łatkę na ekranie.
    act(() => {
      useProject.getState().apply(current => ({ ...current, shots: [] }))
    })

    // `describeOp` pisze ten sam komunikat po obu stronach diffu (`before` i
    // `after`) dla operacji bez celu — stąd `getAllByText`, nie `getByText`.
    expect(screen.getAllByText(/operacja się nie zastosuje/).length).toBeGreaterThan(0)

    const user = userEvent.setup()
    await user.click(screen.getByRole('checkbox', { name: vanishingOp.label }))
    await user.click(screen.getByRole('checkbox', { name: styleOp.label }))
    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }))

    const result = useProject.getState().project
    expect(result).not.toBeNull()
    if (result === null) return
    // Operacja bez celu po cichu nic nie zrobiła — brak crasha, brak śmieciowych danych.
    expect(result.shots).toEqual([])
    // Druga, wciąż ważna operacja zastosowała się normalnie.
    expect(result.style).toBe('Neo-noir')
  })
})

describe('PatchReview — pusta łatka', () => {
  it('łatka bez operacji pokazuje komunikat i nie renderuje przycisku zatwierdzenia', () => {
    renderReview(project(), [])
    expect(screen.getByText('Łatka nie zawiera żadnych operacji.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Zatwierdź' })).not.toBeInTheDocument()
  })
})
