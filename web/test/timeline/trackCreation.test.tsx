import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildPrompt } from '@mmh3/shared'
import { createScale } from '../../src/timeline/scale.js'
import { CameraTrack } from '../../src/timeline/CameraTrack.js'
import { SfxTrack } from '../../src/timeline/SfxTrack.js'
import { DialogueTracks } from '../../src/timeline/DialogueTracks.js'
import { ScreenTextTrack } from '../../src/timeline/ScreenTextTrack.js'
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

/**
 * `baseProject` (fixtures.ts) zostawia `overallSoundscape`/`nonDiegeticMusic`
 * jako puste stringi, co SAMO w sobie zapala `SOUNDSCAPE_SENTENCES`/
 * `MUSIC_SENTENCES` (guide wymaga 1–4, odpowiednio 1–3 zdań; 0 nie mieści się
 * w żadnym z tych zakresów) — nawet na projekcie, którego ta ścieżka w ogóle
 * nie dotyka. Pełne `toEqual([])` byłoby więc fałszywym dowodem: łapałoby
 * ten szum tła jako rzekomą regresję. Sprawdzamy zamiast tego wprost te dwie
 * diagnostyki, których globalne ograniczenie tego zadania faktycznie
 * zabrania — brak segmentu w `body` (`BODY_REFS_COMPLETE`) i wybuch kompilacji
 * (`COMPILE_FAILED`) — czyli dokładnie to, co ten test ma udowodnić.
 */
const assertNoBodyRegression = (): void => {
  const ids = buildPrompt(useProject.getState().project!).diagnostics.map(d => d.ruleId)
  expect(ids).not.toContain('BODY_REFS_COMPLETE')
  expect(ids).not.toContain('COMPILE_FAILED')
}

beforeEach(() => {
  useSelection.setState({ selected: [] })
  usePlayhead.setState({ ms: 5000, playing: false })
  useProject.getState().load('test', twoShots())
})

describe('tworzenie i usuwanie na CameraTrack', () => {
  it('przycisk dodaje klip na playheadzie, Delete go usuwa jednym wpisem historii razem z dodaniem', async () => {
    const user = userEvent.setup()
    render(<Harness><CameraTrack scale={scale} /></Harness>)

    expect(screen.queryByRole('button', { name: /^Ruch kamery/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /dodaj ruch kamery/i }))

    const clip = grab(/^Ruch kamery/i)
    expect(clip).toBeInTheDocument()
    expect(useProject.getState().past).toHaveLength(1)
    assertNoBodyRegression()

    await user.click(clip)
    expect(useSelection.getState().selected).toHaveLength(1)

    await user.keyboard('{Delete}')
    expect(screen.queryByRole('button', { name: /^Ruch kamery/i })).not.toBeInTheDocument()
    expect(useProject.getState().past).toHaveLength(2)
    expect(useSelection.getState().selected).toEqual([])
  })
})

describe('tworzenie i usuwanie na SfxTrack', () => {
  it('przycisk dodaje klip na playheadzie, Delete go usuwa jednym wpisem historii razem z dodaniem', async () => {
    const user = userEvent.setup()
    render(<Harness><SfxTrack scale={scale} /></Harness>)

    expect(screen.queryByRole('button', { name: /^Dźwięk:/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /dodaj dźwięk/i }))

    const clip = grab(/^Dźwięk:/i)
    expect(clip).toBeInTheDocument()
    expect(useProject.getState().past).toHaveLength(1)
    assertNoBodyRegression()

    await user.click(clip)
    expect(useSelection.getState().selected).toHaveLength(1)

    await user.keyboard('{Delete}')
    expect(screen.queryByRole('button', { name: /^Dźwięk:/i })).not.toBeInTheDocument()
    expect(useProject.getState().past).toHaveLength(2)
    expect(useSelection.getState().selected).toEqual([])
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
    render(<Harness><DialogueTracks scale={scale} /></Harness>)

    expect(screen.queryByRole('button', { name: /^Kwestia/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /dodaj kwestię/i }))

    const clip = grab(/^Kwestia/i)
    expect(clip).toBeInTheDocument()
    expect(useProject.getState().past).toHaveLength(1)
    assertNoBodyRegression()

    await user.click(clip)
    expect(useSelection.getState().selected).toHaveLength(1)

    await user.keyboard('{Delete}')
    expect(screen.queryByRole('button', { name: /^Kwestia/i })).not.toBeInTheDocument()
    expect(useProject.getState().past).toHaveLength(2)
    expect(useSelection.getState().selected).toEqual([])
  })
})

describe('tworzenie i usuwanie na ScreenTextTrack', () => {
  it('przycisk dodaje tekst na ekranie w ujęciu pod playheadem, Delete go usuwa jednym wpisem historii razem z dodaniem', async () => {
    const user = userEvent.setup()
    render(<Harness><ScreenTextTrack scale={scale} /></Harness>)

    expect(screen.queryByRole('button', { name: /^Tekst na ekranie/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /dodaj tekst na ekranie/i }))

    // Bez `grab`: klip tekstu na ekranie nie niesie `onPointerDown` (patrz
    // `ScreenTextTrack.tsx` — nie da się go przeciągnąć), więc nie potrzebuje
    // stubu `set/releasePointerCapture`, tak jak w `screenTextTrack.test.tsx`.
    const clip = screen.getByRole('button', { name: /^Tekst na ekranie/i })
    expect(clip).toBeInTheDocument()
    expect(useProject.getState().past).toHaveLength(1)
    assertNoBodyRegression()
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
  })
})
