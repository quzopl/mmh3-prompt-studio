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

/** Projekt T2VA minimalny — bez kotwic ani mówców. Style/audio zostają PUSTE
 * (poza scenariuszem, gdzie akurat to jest testowane), więc ten fixture ma
 * TRZY wstępne diagnostyki błędu (`SOUNDSCAPE_SENTENCES`, `MUSIC_SENTENCES`,
 * `STYLE_REQUIRED` — zmierzone wprost). To jest w porządku dla testów
 * mechaniki wyboru/historii/klawiatury, które nie sprawdzają diagnostyk —
 * ale NIE dla testu „żadna nowa diagnostyka" (patrz `cleanProject` niżej,
 * fix round 1/5, punkt 1: recenzent złapał, że poprzednia wersja testu
 * diagnostyk używała TEGO fixture'u z operacjami, które akurat wszystkie
 * trzy wstępne diagnostyki naprawiają — test mógł tylko poprawiać sytuację,
 * nigdy jej pogorszyć, więc przechodził nawet dla implementacji, która nic
 * nie robi). */
function project(shots = [emptyShot('base-shot', 0, 0)]): Project {
  return baseProject(shots)
}

/** Ten sam projekt, ale bez ŻADNEJ wstępnej diagnostyki błędu — jedyna baza,
 * na której „żadna nowa diagnostyka" jest niezerowym testem: skoro nie da
 * się niczego POPRAWIĆ (nie ma nic do poprawienia), jedyny sposób na
 * przejście testu to rzeczywiście NICZEGO nie zepsuć. Wartości dobrane tak
 * samo jak `cleanProject` w `server/test/llm/tasks/audio.test.ts`. */
function cleanProject(shots = [emptyShot('base-shot', 0, 0)]): Project {
  return {
    ...baseProject(shots),
    style: 'Sitcom',
    audio: { overallSoundscape: 'Room tone.', nonDiegeticMusic: 'N/A' },
  }
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
    // Dosłownie żaden komunikat — nie tylko brak realnej zmiany, ale i brak
    // „Zastosowano 0 operacji.": puste zaznaczenie nie jest decyzją o
    // odrzuceniu wszystkiego, tylko brakiem jakiejkolwiek decyzji.
    expect(screen.queryByText(/Zastosowano/)).not.toBeInTheDocument()
  })

  it('zatwierdzenie z pustym zaznaczeniem NIE normalizuje projektu, nawet jeśli sam projekt nie był znormalizowany', async () => {
    // Fix round 1/5, punkt 3: `normalizeProject` biegł bezwarunkowo przy
    // KAŻDYM zatwierdzeniu, więc na projekcie, który nie był na siatce
    // klatek/w porządku ujęć, pusta decyzja i tak przestawiała ujęcia,
    // przeliczała introdukcje mówców i zakresy retencji — konsumując wpis
    // historii, którego brief wprost zabrania.
    const dirty = project([
      emptyShot('shot-b', 0, 5000), // index 0, ale startMs najpóźniejszy — niespójne
      emptyShot('shot-a', 1, 0),
    ])
    renderReview(dirty, ops)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }))

    // Gdyby `normalizeProject` przeleciał, ujęcia zostałyby przestawione i
    // przeindeksowane — nowy obiekt, różny od `dirty`.
    expect(useProject.getState().project).toBe(dirty)
    expect(useProject.getState().past).toEqual([])
  })

  it('zaznaczenie NIEPUSTE, które okazuje się bezskuteczne (cel zniknął), też NIE normalizuje nieznormalizowanego projektu', async () => {
    // To samo ryzyko co wyżej, ale przez DRUGĄ ścieżkę: użytkownik coś
    // zaznaczył i kliknął „Zatwierdź", ale ta jedna operacja nie ma już celu
    // (fix round 1/5, punkt 3 — druga połowa mechanizmu, `working === current`
    // wewnątrz pętli `apply`, nie sam wczesny `return` przy pustym wyborze).
    const dirty = project([
      emptyShot('shot-b', 0, 5000),
      emptyShot('shot-a', 1, 0),
    ])
    const vanishingOp: PatchOp = {
      kind: 'setSpeakerDescriptor', id: 'op-1', label: 'Zniknięty mówca',
      speakerId: 'nie-istnieje', field: 'fullDescriptor', text: 'x',
    }
    renderReview(dirty, [vanishingOp])
    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: vanishingOp.label }))
    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }))

    expect(useProject.getState().project).toBe(dirty)
    expect(useProject.getState().past).toEqual([])
    expect(screen.getByText('Zastosowano 0 operacji.')).toBeInTheDocument()
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
    // Fix round 1/5, punkt 7: liczebnik 3 mieści się w polskiej kategorii
    // „2–4" ("operacje"), różnej od kategorii „1" ("operację") i „reszta"
    // ("operacji") — sprawdzone osobno w innych testach tego pliku.
    expect(screen.getByText('Zastosowano 3 operacje.')).toBeInTheDocument()
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

describe('PatchReview — operacja zatwierdzona znika z listy, reszta zostaje selekcjonowalna (fix round 1/5, punkt 2)', () => {
  it('kolejne zatwierdzenie stosuje tylko nowo zaznaczone; podwójne kliknięcie „Zatwierdź" tuż po sobie niczego nie dubluje', async () => {
    const p = project()
    renderReview(p, ops)
    const user = userEvent.setup()
    const [styleOp, soundscapeOp, musicOp] = ops
    if (!styleOp || !soundscapeOp || !musicOp) throw new Error('fixture ops niekompletne')

    await user.click(screen.getByRole('checkbox', { name: styleOp.label }))
    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }))

    // Zatwierdzona operacja znika z listy...
    expect(screen.queryByRole('checkbox', { name: styleOp.label })).not.toBeInTheDocument()
    // ...ale pozostałe dwie są nadal tam, nieblokowane i niezaznaczone —
    // wcześniejsza wersja blokowała TU cały ekran (`aria-disabled`), więc
    // pomyłkowe odznaczenie stylu i chęć przyjęcia reszty nie miały wyjścia
    // poza ponowne uruchomienie zadania (i utratę akurat przejrzanej łatki).
    const soundscapeCheckbox = screen.getByRole('checkbox', { name: soundscapeOp.label })
    expect(soundscapeCheckbox).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('checkbox', { name: musicOp.label })).toHaveAttribute('aria-checked', 'false')

    // Drugie kliknięcie „Zatwierdź" zaraz po pierwszym, bez nowego
    // zaznaczenia — bezpieczne z tego samego powodu co pusty pierwszy klik:
    // pierwsze zatwierdzenie wyczyściło WŁASNE zaznaczenie.
    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }))
    expect(useProject.getState().past).toHaveLength(1)

    // Druga, realna decyzja na pozostałej operacji nadal działa.
    await user.click(soundscapeCheckbox)
    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }))

    const result = useProject.getState().project
    expect(result?.style).toBe('Neo-noir')
    expect(result?.audio.overallSoundscape).toBe('Deszcz na szybie.')
    expect(result?.audio.nonDiegeticMusic).toBe(p.audio.nonDiegeticMusic) // nigdy nie zaznaczona
    expect(useProject.getState().past).toHaveLength(2)

    // Trzecia operacja (muzyka) wciąż czeka na decyzję — nie zniknęła i nie
    // zastosowała się sama.
    expect(screen.getByRole('checkbox', { name: musicOp.label })).toBeInTheDocument()
  })

  it('gdy wszystkie operacje zostały rozpatrzone, lista znika na rzecz komunikatu — nie zostaje pusta bez wyjaśnienia', async () => {
    const p = project()
    const single: PatchOp = { kind: 'setStyle', id: 'op-1', label: 'Jedyna operacja', text: 'Neo-noir' }
    renderReview(p, [single])
    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: single.label }))
    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }))

    expect(screen.getByText('Wszystkie operacje zostały już rozpatrzone.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Zatwierdź' })).not.toBeInTheDocument()
  })
})

describe('PatchReview — komunikat liczy operacje faktycznie zastosowane, nie zaznaczone (fix round 1/5, punkt 5)', () => {
  it('dwie zaznaczone, jedna nieaktualna → komunikat mówi o jednej zastosowanej operacji', async () => {
    const shot = { ...emptyShot('shot-1', 0, 0), body: [{ kind: 'text' as const, text: 'Stary opis.' }] }
    const p = project([shot])
    const vanishingOp: PatchOp = {
      kind: 'setShotText', id: 'op-text', label: 'Nowy tekst ujęcia',
      shotId: shot.id, segmentIndex: 0, text: 'Nowy opis.',
    }
    const styleOp: PatchOp = { kind: 'setStyle', id: 'op-style', label: 'Nowy styl', text: 'Neo-noir' }
    renderReview(p, [vanishingOp, styleOp])

    // Cel pierwszej operacji znika ZANIM użytkownik kliknie „Zatwierdź".
    act(() => {
      useProject.getState().apply(current => ({ ...current, shots: [] }))
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('checkbox', { name: vanishingOp.label }))
    await user.click(screen.getByRole('checkbox', { name: styleOp.label }))
    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }))

    // Dwie zaznaczone, ale tylko JEDNA faktycznie coś zmieniła — komunikat
    // ma to policzyć poprawnie, nie po prostu odbić `selected.size`.
    expect(await screen.findByText('Zastosowano 1 operację.')).toBeInTheDocument()
  })
})

describe('PatchReview — replaceShots i normalizeProject', () => {
  it('łatka podająca ujęcia w złej kolejności ląduje w modelu uporządkowana', async () => {
    const p = cleanProject([emptyShot('base-shot', 0, 0)])
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

describe('PatchReview — replaceShots opisuje dodane/usunięte/zmienione ujęcia, nie samą arytmetykę (fix round 1/5, punkt 6)', () => {
  it('ujęcie dopisane przez użytkownika PO wygenerowaniu łatki pokazuje się jako "usunięte" — dokładnie scenariusz z recenzji', async () => {
    const shotA = emptyShot('shot-a', 0, 0)
    const p = project([shotA])
    // Łatka niesie tylko poprawioną wersję ujęcia A — model nigdy nie widział
    // ujęcia B, bo powstało PO wygenerowaniu łatki.
    const op: PatchOp = {
      kind: 'replaceShots', id: 'op-shots', label: 'Poprawiona struktura',
      shots: [{ ...shotA, composition: 'poprawiona kompozycja od modelu' }],
    }
    renderReview(p, [op])

    // Użytkownik dopisuje własne, nowe ujęcie, mając łatkę na ekranie.
    act(() => {
      useProject.getState().apply(current => ({ ...current, shots: [...current.shots, emptyShot('shot-b-user', 1, 4000)] }))
    })

    // Opis mówi wprost: jedno ujęcie zostanie USUNIĘTE (to użytkownika), jedno
    // ZMIENIONE — nie „2 → 1, zmienionych: 2" (stary, pozycyjny diff), co
    // czytałoby się jak arytmetyka, nie jak ostrzeżenie przed utratą pracy.
    expect(screen.getByText(/dodane: 0, usunięte: 1, zmienione: 1/)).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('checkbox', { name: op.label }))
    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }))

    const result = useProject.getState().project
    expect(result).not.toBeNull()
    if (result === null) return
    // Opis miał rację: ujęcie dopisane przez użytkownika naprawdę zniknęło.
    expect(result.shots.map(s => s.id)).not.toContain('shot-b-user')
    expect(result.shots).toHaveLength(1)
  })
})

describe('PatchReview — brak nowej diagnostyki i zgodność ze schematem (fix round 1/5, punkt 1: baza BEZ wstępnych błędów)', () => {
  it('zastosowanie łatki na CZYSTYM projekcie nie wprowadza diagnostyki poza przyjętymi wyjątkami, a wynik przechodzi parseProject', async () => {
    const p = cleanProject()
    // Sanity check na samej bazie — jeśli to kiedyś przestanie być prawdą
    // (np. fixture się zmieni), test niżej wróci do bycia bezwładnym i ma to
    // krzyczeć tutaj, nie cicho przepuszczać.
    expect(diagnosticsOf(p).filter(d => d.severity === 'error')).toEqual([])

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

  it('sanity: treść łamiąca regułę, gdyby dotarła na ekran, faktycznie odpala diagnostykę po zatwierdzeniu — ekran jej nie ukrywa', async () => {
    // Dowodzi, że test wyżej ma zęby: gdyby `PatchReview`/`applyOps` po cichu
    // sanityzowały albo gubiły diagnostyki, TEN test by to złapał. Siedem
    // zdań w pejzażu dźwiękowym łamie `SOUNDSCAPE_SENTENCES` (guide wymaga
    // 1–4) — realny fix round 1/5, punkt 1 (krytyczny): odrzuca to teraz
    // schemat zadania audio (`server/src/llm/tasks/audio.ts`), ZANIM taka
    // treść stanie się operacją — ten ekran świadomie NIE waliduje treści
    // operacji sam z siebie (patrz komentarz w `PatchReview.tsx`).
    const p = cleanProject()
    expect(diagnosticsOf(p)).toEqual([])

    const badOp: PatchOp = {
      kind: 'setAudio', id: 'op-bad', label: 'Zła podpowiedź pejzażu', field: 'overallSoundscape',
      text: 'One. Two. Three. Four. Five. Six. Seven.',
    }
    renderReview(p, [badOp])
    const user = userEvent.setup()
    await user.click(screen.getByRole('checkbox', { name: badOp.label }))
    await user.click(screen.getByRole('button', { name: 'Zatwierdź' }))

    const result = useProject.getState().project
    expect(result).not.toBeNull()
    if (result === null) return
    const added = newDiagnostics(diagnosticsOf(p), diagnosticsOf(result))
    expect(added.some(d => d.ruleId === 'SOUNDSCAPE_SENTENCES')).toBe(true)
  })
})

describe('PatchReview — klawiatura nie wypływa do skrótów osi czasu (fix round 1/5, punkt 4: pełna przekątna)', () => {
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

    expect(usePlayhead.getState().playing).toBe(false)
    expect(checkbox).toHaveAttribute('aria-checked', 'true')
  })

  it('Enter na polu wyboru zaznacza operację i nie przełącza globalnego odtwarzania', async () => {
    const p = project()
    useProject.getState().load('test-projekt', p)
    render(<><PatchReview patch={{ ops }} /><ShortcutsHarness /></>)
    expect(usePlayhead.getState().playing).toBe(false)

    const styleOp = ops[0]
    if (!styleOp) throw new Error('fixture ops niekompletne')
    const checkbox = screen.getByRole('checkbox', { name: styleOp.label })
    checkbox.focus()
    await userEvent.keyboard('{Enter}')

    expect(usePlayhead.getState().playing).toBe(false)
    expect(checkbox).toHaveAttribute('aria-checked', 'true')
  })

  it('spacja na przycisku „Zatwierdź" zatwierdza wybór i nie przełącza globalnego odtwarzania', async () => {
    // Fix round 1/5, punkt 4: pierwsza wersja testów pokrywała tylko
    // przekątną (spacja na polu wyboru, Enter na przycisku) — zamiana
    // strażnika przycisku z `key !== 'Enter' && key !== ' '` na
    // `key !== 'Enter'` zostawiała cały pakiet zielonym.
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
    await userEvent.keyboard(' ')

    expect(usePlayhead.getState().playing).toBe(false)
    expect(useProject.getState().project?.style).toBe('Neo-noir')
  })

  it('Enter na przycisku „Zatwierdź" zatwierdza wybór i nie przełącza globalnego odtwarzania', async () => {
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
    act(() => {
      useProject.getState().apply(current => ({ ...current, style: 'Zmienione ręcznie' }))
    })

    expect(screen.getByText(/Przed: Zmienione ręcznie/)).toBeInTheDocument()
    expect(screen.queryByText(/Przed: \(nieopisane\)/)).not.toBeInTheDocument()
  })

  it('operacja, której cel zniknął w trakcie przeglądu, jest jawnie oznaczona jako niemożliwa do zastosowania (JEDEN wiersz ostrzeżenia, nie dwa identyczne) i nie psuje reszty przy zatwierdzeniu', async () => {
    const shot = { ...emptyShot('shot-1', 0, 0), body: [{ kind: 'text' as const, text: 'Istniejący opis.' }] }
    const p = project([shot])
    const vanishingOp: PatchOp = {
      kind: 'setShotText', id: 'op-text', label: 'Nowy tekst ujęcia',
      shotId: shot.id, segmentIndex: 0, text: 'Nowy opis.',
    }
    const styleOp: PatchOp = { kind: 'setStyle', id: 'op-style', label: 'Nowy styl', text: 'Neo-noir' }
    useProject.getState().load('test-projekt', p)
    render(<PatchReview patch={{ ops: [vanishingOp, styleOp] }} />)

    // Przed usunięciem cel istnieje — diff pokazuje prawdziwą treść, nie ostrzeżenie.
    expect(screen.getByText(/Po: Nowy opis\./)).toBeInTheDocument()

    // Symulacja: użytkownik usuwa jedyne ujęcie, mając łatkę na ekranie.
    act(() => {
      useProject.getState().apply(current => ({ ...current, shots: [] }))
    })

    // Fix round 1/5, punkt 7: JEDEN wiersz ostrzeżenia, nie dwa identyczne
    // („Przed: …"/„Po: …" z tym samym zdaniem) — to wcześniej czytało się
    // jak usterka renderowania, nie jak sygnał. Sprawdzamy WPROST, że jest
    // dokładnie jedno wystąpienie, i że nie ma już etykiet „Przed"/„Po" dla
    // tej operacji.
    const warnings = screen.getAllByText(/nie ma ujęcia o tym identyfikatorze/)
    expect(warnings).toHaveLength(1)
    expect(screen.queryByText(/Przed: .*nie ma ujęcia/)).not.toBeInTheDocument()

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

describe('PatchReview — opis operacji idzie przez useT, nie przez zaszyty w shared polski string (fix round 1/5, punkt 5)', () => {
  it('interfejs angielski pokazuje angielski powód niemożności zastosowania, nie polskie zdanie z shared', () => {
    useLang.setState({ lang: 'en' })
    const p = project()
    const op: PatchOp = {
      kind: 'setSpeakerDescriptor', id: 'op-1', label: 'Missing speaker op',
      speakerId: 'brak', field: 'fullDescriptor', text: 'x',
    }
    renderReview(p, [op])

    expect(screen.getByText(/This operation won't apply/)).toBeInTheDocument()
    expect(screen.queryByText(/operacja się nie zastosuje/)).not.toBeInTheDocument()
  })

  it('interfejs angielski pokazuje etykiety "Before"/"After", nie polskie "Przed"/"Po"', () => {
    useLang.setState({ lang: 'en' })
    const p = project()
    const styleOp = ops[0]
    if (!styleOp) throw new Error('fixture ops niekompletne')
    renderReview(p, [styleOp])

    expect(screen.getByText(/Before: \(not described\)/)).toBeInTheDocument()
    expect(screen.getByText(/After: Neo-noir/)).toBeInTheDocument()
    expect(screen.queryByText(/Przed:/)).not.toBeInTheDocument()
  })
})

describe('PatchReview — pusta łatka', () => {
  it('łatka bez operacji pokazuje komunikat i nie renderuje przycisku zatwierdzenia', () => {
    renderReview(project(), [])
    expect(screen.getByText('Łatka nie zawiera żadnych operacji.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Zatwierdź' })).not.toBeInTheDocument()
  })
})
