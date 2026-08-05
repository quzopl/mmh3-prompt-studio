import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildPrompt, parseProject } from '@mmh3/shared'
import { createScale } from '../../src/timeline/scale.js'
import { TrackStack } from '../../src/timeline/TrackStack.js'
import { useTimelineShortcuts } from '../../src/timeline/useTimelineShortcuts.js'
import { useProject } from '../../src/store/projectStore.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { DICT } from '../../src/i18n/dict.js'
import { baseProject, emptyShot } from './fixtures.js'

const scale = createScale(8000, 800, 1)

/** Dwa ujęcia — jak w innych testach ścieżek, żeby playhead na 5000 ms trafiał w drugie. */
const twoShots = () => baseProject([emptyShot('a', 0, 0), emptyShot('b', 1, 4000)])

/**
 * Skrót Delete żyje w `useTimelineShortcuts` (nasłuch na `window`), nie w
 * samej ścieżce — bez tego uchwytu klawisz nie miałby kto go obsłużyć,
 * dokładnie jak w `shortcuts.test.tsx`.
 */
/**
 * Zadanie 12: przyciski „+" przeniosły się z rogu każdej ścieżki do kolumny
 * nagłówków `TrackStack` (patrz `TrackStack.tsx` i jego komentarz) — kolizja
 * z klipem zaczynającym się w `ms=0`, przed którą ostrzegał komentarz przy
 * starym przycisku w `CameraTrack.tsx`. Testy niżej renderują więc CAŁY
 * `TrackStack`, nie pojedynczą ścieżkę — sama ścieżka od tego zadania nie ma
 * już własnego przycisku dodawania, więc test wymierzony w samą ścieżkę nie
 * miałby czego kliknąć.
 */
function Harness({ children }: { children: React.ReactNode }) {
  useTimelineShortcuts()
  return <>{children}</>
}

/** Stub `set/releasePointerCapture` — jsdom ich nie zna (patrz `pointer.ts`). */
const grab = (name: RegExp) => {
  const element = screen.getByRole('button', { name })
  element.setPointerCapture = () => {}
  element.releasePointerCapture = () => {}
  return element
}

const ruleIds = (): string[] =>
  buildPrompt(useProject.getState().project!).diagnostics.map(d => d.ruleId)

/**
 * Trzy jedyne diagnostyki, które akcja interfejsu ma prawo wnieść do
 * projektu, który jej nie miał — każda dlatego, że walidator ma rację, a nie
 * dlatego, że kod jest wadliwy (patrz opisy przy testach „wyniki uczciwe"
 * w `createOnTrack.test.ts`).
 */
const ACCEPTED_NEW_DIAGNOSTICS = new Set([
  // Kwestia dodana w ostatnich ~479 ms materiału naprawdę się nie mieści.
  'SPEECH_FITS',
  // Pierwszy dźwięk diegetyczny w projekcie deklarującym ciszę („N/A").
  'SOUNDSCAPE_NA_ONLY_IF_SILENT',
  // Mówca traci swoją ostatnią kwestię w całym projekcie.
  'SPEAKER_SILENT_NO_ID',
  // Czwarty przyjęty wyjątek — `FL2VA_PREFER_SINGLE_SHOT` (podział ujęcia w
  // trybie FL2VA) — celowo NIE stoi na tej liście: fikstury tego pliku są
  // T2VA, a te przyciski nie tworzą ujęć, więc ta reguła jest tu
  // nieosiągalna i wpisanie jej tylko rozluźniłoby asercję bez powodu.
  // Pełna lista czterech wyjątków żyje w `progress.md` i w punkcie 18
  // `docs/superpowers/specs/2026-08-04-uwagi-do-planu-2.md`.
])

/**
 * Recenzja końcowa, znalezisko 4: poprzednia wersja tej asercji sprawdzała
 * DWA wpisane na sztywno identyfikatory reguł (`BODY_REFS_COMPLETE`,
 * `COMPILE_FAILED`) — i przez to zapadła się do zera przy każdej innej
 * regule. Trzy objawy znaleziska 3 (`CAM_IN_SHOT_BOUNDS`,
 * `SPEAKER_FIRST_INTRO`, rozjechany zakres retencji) przeszły przez nią bez
 * śladu. Właściwym kształtem jest RÓŻNICA ZBIORÓW: diagnostyki po akcji minus
 * diagnostyki przed nią, z jawnie nazwanymi wyjątkami. Szum tła (`baseProject`
 * ma pusty pejzaż i muzykę, więc `SOUNDSCAPE_SENTENCES`/`MUSIC_SENTENCES`
 * palą się od pierwszej klatki) znika sam — jest po OBU stronach różnicy.
 */
const assertNoNewDiagnostics = (before: Set<string>): void => {
  for (const id of ruleIds().filter(candidate => !before.has(candidate))) {
    expect(ACCEPTED_NEW_DIAGNOSTICS.has(id), `nieoczekiwana nowa diagnostyka: ${id}`).toBe(true)
  }
}

/**
 * Recenzja końcowa, znalezisko 4 (druga połowa): `PUT /api/projects/:slug`
 * waliduje `ProjectSchema`, a autozapis wysyła CAŁY projekt — jeden nieważny
 * obiekt zablokował autozapis do końca sesji i nikt tego nie zauważył, bo
 * żaden test nie porównywał wyniku akcji interfejsu ze schematem.
 */
const assertParses = (): void => {
  expect(() => parseProject(useProject.getState().project!)).not.toThrow()
}

beforeEach(() => {
  useSelection.setState({ selected: [] })
  usePlayhead.setState({ ms: 5000, playing: false })
  useProject.getState().load('test', twoShots())
})

describe('tworzenie i usuwanie na CameraTrack', () => {
  it('przycisk dodaje klip na playheadzie, Delete go usuwa jednym wpisem historii razem z dodaniem', async () => {
    const user = userEvent.setup()
    render(<Harness><TrackStack scale={scale} /></Harness>)
    const before = new Set(ruleIds())

    expect(screen.queryByRole('button', { name: /^Ruch kamery/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /dodaj ruch kamery/i }))

    const clip = grab(/^Ruch kamery/i)
    expect(clip).toBeInTheDocument()
    expect(useProject.getState().past).toHaveLength(1)
    assertNoNewDiagnostics(before)
    assertParses()

    await user.click(clip)
    expect(useSelection.getState().selected).toHaveLength(1)

    await user.keyboard('{Delete}')
    expect(screen.queryByRole('button', { name: /^Ruch kamery/i })).not.toBeInTheDocument()
    expect(useProject.getState().past).toHaveLength(2)
    expect(useSelection.getState().selected).toEqual([])
    assertNoNewDiagnostics(before)
    assertParses()
  })
})

describe('tworzenie i usuwanie na SfxTrack', () => {
  it('przycisk dodaje klip na playheadzie, Delete go usuwa jednym wpisem historii razem z dodaniem', async () => {
    const user = userEvent.setup()
    render(<Harness><TrackStack scale={scale} /></Harness>)
    const before = new Set(ruleIds())

    expect(screen.queryByRole('button', { name: /^Dźwięk:/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /dodaj dźwięk/i }))

    const clip = grab(/^Dźwięk:/i)
    expect(clip).toBeInTheDocument()
    expect(useProject.getState().past).toHaveLength(1)
    assertNoNewDiagnostics(before)
    assertParses()

    await user.click(clip)
    expect(useSelection.getState().selected).toHaveLength(1)

    await user.keyboard('{Delete}')
    expect(screen.queryByRole('button', { name: /^Dźwięk:/i })).not.toBeInTheDocument()
    expect(useProject.getState().past).toHaveLength(2)
    expect(useSelection.getState().selected).toEqual([])
    assertNoNewDiagnostics(before)
    assertParses()
  })
})

/**
 * Runda 1 recenzji: przyciski Dialogue i ScreenText nie miały żadnego testu —
 * Dialogue to własna decyzja projektowa (pas „bez mówcy", nie ma jej w
 * briefie), ScreenText po prostu został pominięty. Oba pokryte tym samym
 * wzorcem co Camera/Sfx wyżej, z dodatkowym dowodem, że utworzony obiekt się
 * kompiluje i nie zapala diagnostyki, której projekt wcześniej nie miał.
 */
describe('tworzenie i usuwanie na DialogueTracks', () => {
  it('przycisk dodaje kwestię bez mówcy na playheadzie, Delete ją usuwa jednym wpisem historii razem z dodaniem', async () => {
    const user = userEvent.setup()
    render(<Harness><TrackStack scale={scale} /></Harness>)
    const before = new Set(ruleIds())

    expect(screen.queryByRole('button', { name: /^Kwestia/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /dodaj kwestię/i }))

    const clip = grab(/^Kwestia/i)
    expect(clip).toBeInTheDocument()
    expect(useProject.getState().past).toHaveLength(1)
    assertNoNewDiagnostics(before)
    assertParses()

    await user.click(clip)
    expect(useSelection.getState().selected).toHaveLength(1)

    await user.keyboard('{Delete}')
    expect(screen.queryByRole('button', { name: /^Kwestia/i })).not.toBeInTheDocument()
    expect(useProject.getState().past).toHaveLength(2)
    expect(useSelection.getState().selected).toEqual([])
    assertNoNewDiagnostics(before)
    assertParses()
  })
})

describe('tworzenie i usuwanie na ScreenTextTrack', () => {
  it('przycisk dodaje tekst na ekranie w ujęciu pod playheadem, Delete go usuwa jednym wpisem historii razem z dodaniem', async () => {
    const user = userEvent.setup()
    render(<Harness><TrackStack scale={scale} /></Harness>)
    const before = new Set(ruleIds())

    expect(screen.queryByRole('button', { name: /^Tekst na ekranie/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /dodaj tekst na ekranie/i }))

    // Bez `grab`: klip tekstu na ekranie nie niesie `onPointerDown` (patrz
    // `ScreenTextTrack.tsx` — nie da się go przeciągnąć), więc nie potrzebuje
    // stubu `set/releasePointerCapture`, tak jak w `screenTextTrack.test.tsx`.
    const clip = screen.getByRole('button', { name: /^Tekst na ekranie/i })
    expect(clip).toBeInTheDocument()
    expect(useProject.getState().past).toHaveLength(1)
    assertNoNewDiagnostics(before)
    assertParses()
    // Runda 2 recenzji: `assertNoBodyRegression` nie ma na czym ugryźć brak
    // dopięcia segmentu w `addScreenText` — żadna reguła walidatora nie
    // sprawdza kompletności odwołań do `screenText` (nie ma odpowiednika
    // `BODY_REFS_COMPLETE` dla tego rodzaju), a brakujący segment niczego
    // nie rzuca, po prostu nie trafia do promptu. Jedyny dowód, że tekst
    // faktycznie dotarł do kompilatora, to sam skompilowany tekst.
    expect(buildPrompt(useProject.getState().project!).text).toContain(DICT.en['track.newScreenText'])

    await user.click(clip)
    expect(useSelection.getState().selected).toHaveLength(1)

    await user.keyboard('{Delete}')
    expect(screen.queryByRole('button', { name: /^Tekst na ekranie/i })).not.toBeInTheDocument()
    expect(useProject.getState().past).toHaveLength(2)
    expect(useSelection.getState().selected).toEqual([])
    assertNoNewDiagnostics(before)
    assertParses()
  })
})
