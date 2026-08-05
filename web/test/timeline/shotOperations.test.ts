import { describe, it, expect } from 'vitest'
import { buildPrompt, parseProject, type Project } from '@mmh3/shared'
import { removeShots, setShotStartMs, splitAtMs } from '../../src/timeline/shotOperations.js'

const shot = (id: string, index: number, startMs: number) => ({
  id, index, startMs, cutType: 'cut' as const, cutPhrase: 'the camera cuts to' as const,
  composition: '', body: [], cameraMoves: [], dialogue: [],
  screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
})

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: '', assets: [], labels: [], speakers: [],
  shots: [shot('a', 0, 0), shot('b', 1, 4000)],
  audio: { overallSoundscape: '', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

/**
 * Recenzja końcowa, znalezisko 4: wynik akcji tworzącej i usuwającej musi
 * przechodzić przez `ProjectSchema` — tym samym, którym waliduje
 * `PUT /api/projects/:slug`. Podział i usunięcie ujęcia są takimi akcjami.
 */
const expectParses = (candidate: Project): void => {
  expect(() => parseProject(candidate)).not.toThrow()
}

describe('splitAtMs', () => {
  it('wstawia ujęcie i przenumerowuje pozostałe', () => {
    const out = splitAtMs(project, 2000)
    expect(out.shots.map(s => [s.index, s.startMs])).toEqual([[0, 0], [1, 2000], [2, 4000]])
    expectParses(out)
  })

  it('nadaje unikalny identyfikator także wtedy, gdy liczba ujęć wraca do wcześniejszej wartości', () => {
    // Sufiks liczony po `shots.length + 1` powtarza się, kiedy licznik ujęć
    // wróci do przebytej już wartości, a playhead stoi w tym samym miejscu co
    // poprzednio. Dwa ujęcia o tym samym identyfikatorze to nie kosmetyka:
    // `useDragBoundary` dopasowuje ujęcie po `shot.id`, więc jedno
    // przeciągnięcie granicy przestawia oba czasy cięcia naraz i kasuje ten,
    // który był ustawiony wcześniej.
    const three: Project = {
      ...project,
      shots: [shot('a', 0, 0), shot('b', 1, 2000), shot('c', 2, 6000)],
    }

    const afterSplit = splitAtMs(three, 4000)
    const created = afterSplit.shots.find(s => s.startMs === 4000)
    if (!created) throw new Error('podział nie utworzył ujęcia')

    // Przeciągnięcie świeżej granicy z 4000 na 5000 — playhead zostaje tam,
    // gdzie był, więc kolejne cięcie w tym samym miejscu jest dozwolone.
    const moved: Project = {
      ...afterSplit,
      shots: afterSplit.shots.map(s => (s.id === created.id ? { ...s, startMs: 5000 } : s)),
    }
    // Usunięcie ostatniego ujęcia sprowadza licznik z powrotem do trzech.
    const afterRemove = removeShots(moved, ['c'])
    expect(afterRemove.shots).toHaveLength(3)

    const afterSecondSplit = splitAtMs(afterRemove, 4000)
    expect(afterSecondSplit.shots).toHaveLength(4)
    expect(new Set(afterSecondSplit.shots.map(s => s.id)).size).toBe(4)
  })

  it('nie dzieli na istniejącym cięciu', () => {
    expect(splitAtMs(project, 4000).shots).toHaveLength(2)
  })

  it('nie dzieli w zerze ani na końcu wideo', () => {
    expect(splitAtMs(project, 0).shots).toHaveLength(2)
    expect(splitAtMs(project, 8000).shots).toHaveLength(2)
  })

  it('nie tworzy ujęcia krótszego niż dozwolone', () => {
    expect(splitAtMs(project, 20).shots).toHaveLength(2)
    expect(splitAtMs(project, 3990).shots).toHaveLength(2)
  })

  it('nie tworzy ostatniego ujęcia krótszego niż dozwolone przy końcu materiału', () => {
    // Jedno ujęcie na cały materiał — 7960 nie jest blisko żadnego
    // istniejącego cięcia (jedyne to 0), więc jedyną przeszkodą jest
    // odległość do końca wideo: 8000 - 7958 (po przyciągnięciu do klatki)
    // = 42 ms, mniej niż MIN_SHOT_MS. Bez tej gałęzi w splitAtMs ten test
    // czerwienieje — sprawdzone ręcznie przez usunięcie warunku.
    const singleShot: Project = { ...project, shots: [shot('only', 0, 0)] }
    expect(splitAtMs(singleShot, 7960).shots).toHaveLength(1)
  })
})

describe('removeShots', () => {
  it('usuwa wskazane ujęcia i przenumerowuje resztę', () => {
    const out = removeShots(project, ['a'])
    expect(out.shots.map(s => [s.id, s.index, s.startMs])).toEqual([['b', 0, 0]])
    expectParses(out)
  })

  it('nigdy nie usuwa ostatniego ujęcia — zostaje pierwsze w kolejności', () => {
    const out = removeShots(project, ['a', 'b'])
    expect(out.shots.map(s => s.id)).toEqual(['a'])
  })

  it('pusta lista nic nie zmienia', () => {
    expect(removeShots(project, []).shots).toHaveLength(2)
  })
})

/**
 * Recenzja końcowa, znalezisko 3: trzy objawy jednej usterki — stan pochodny
 * (zakres etykiety w `retention_analysis`, przynależność ruchu kamery do
 * ujęcia, forma pierwszego wprowadzenia mówcy) nie miał właściciela. Tylko
 * `toggleLabelInShot` przeliczał zakres, tylko `removeSelected` podnosił
 * wprowadzenie, a zadanie 5 ograniczyło PRZECIĄGANIE ruchu kamery do ujęcia,
 * nie pilnując drugiej połowy: ujęcia poruszającego się pod nieruchomym
 * ruchem. Wszystkie trzy zamyka `normalizeProject` (`normalize.ts`), przez
 * które przechodzi teraz każdy pisarz listy ujęć — testy niżej sprawdzają
 * każdy objaw przez gest, który go produkuje.
 */
describe('normalizacja projektu po zmianie listy ujęć', () => {
  const ruleIds = (candidate: Project): string[] =>
    buildPrompt(candidate).diagnostics.map(d => d.ruleId)

  const label = {
    id: 'l1', kind: 'subject' as const, index: 1,
    assetIds: [] as string[], definition: 'kobieta', role: 'bohaterka', standalone: true,
  }

  /** Etykieta siedzi w TRZECIM ujęciu, a wpis retencji mówi o tym wprost. */
  const withLabelInThirdShot = (): Project => ({
    ...project,
    mode: 'REF',
    labels: [label],
    shots: [shot('a', 0, 0), shot('b', 1, 3000), { ...shot('c', 2, 6000), labelRefs: ['l1'] }],
    ref: {
      taskTypes: [],
      summaryText: '',
      retention: [{
        id: 'r1', labelId: 'l1', scope: 'appears in [Shot 3]',
        marker: 'reference' as const, note: 'kobieta w oknie',
      }],
    },
  })

  const withCameraMove = (): Project => ({
    ...project,
    shots: [
      {
        ...shot('a', 0, 0),
        cameraMoves: [{ id: 'm1', type: 'static' as const, startMs: 1000, endMs: 3000 }],
        body: [{ kind: 'camera' as const, moveId: 'm1' }],
      },
      shot('b', 1, 4000),
    ],
  })

  const speakerRecord = {
    id: 's1', code: 'S1', characterType: 'woman', age: 'in her thirties', gender: 'female',
    pitch: 'medium', timbre: 'warm', rate: 'measured', accent: 'neutral',
    onScreen: true, fullDescriptor: 'a woman', shortDescriptor: 'the woman',
  }

  const dialogueLine = (id: string, startMs: number, endMs: number) => ({
    id, speakerIds: ['s1'], verb: 'says', punctuation: ':' as const, language: 'English',
    text: 'coś', voiceover: false, sceneTransBefore: false, sceneTransAfter: false,
    cutoff: false, startMs, endMs,
  })

  /** Pełne wprowadzenie w ujęciu 'a', skrócone w 'b' — kształt po `splitAtSceneTrans`. */
  const withSplitIntroduction = (): Project => ({
    ...project,
    speakers: [speakerRecord],
    shots: [
      {
        ...shot('a', 0, 0),
        dialogue: [dialogueLine('d1', 1000, 2000)],
        body: [
          { kind: 'speaker' as const, speakerIds: ['s1'], form: 'full' as const },
          { kind: 'text' as const, text: ' ' },
          { kind: 'dialogue' as const, eventId: 'd1' },
        ],
      },
      {
        ...shot('b', 1, 4000),
        dialogue: [dialogueLine('d2', 4000, 5000)],
        body: [
          { kind: 'speaker' as const, speakerIds: ['s1'], form: 'short' as const },
          { kind: 'text' as const, text: ' ' },
          { kind: 'dialogue' as const, eventId: 'd2' },
        ],
      },
    ],
  })

  describe('zakres etykiety w retention_analysis', () => {
    it('usunięcie ujęcia przed etykietą przesuwa numer w zakresie', () => {
      const next = removeShots(withLabelInThirdShot(), ['a'])
      expect(next.ref.retention[0]?.scope).toBe('appears in [Shot 2]')
    })

    it('podział ujęcia przed etykietą przesuwa numer w zakresie', () => {
      const next = splitAtMs(withLabelInThirdShot(), 1500)
      expect(next.ref.retention[0]?.scope).toBe('appears in [Shot 4]')
    })

    /**
     * `setShotStartMs` NIE potrafi zmienić kolejności ujęć —
     * `boundaryTargetMs` przycina wpisany czas do przedziału między sąsiadami
     * (`Math.max(lowest, Math.min(snapped, highest))`), więc numer ujęcia, a z
     * nim zakres etykiety, jest pod tym pisarzem niezmienny. Pierwsza wersja
     * tego testu zakładała inaczej i była czerwona z fałszywego powodu — ta
     * wersja pilnuje właściwości, która naprawdę obowiązuje.
     */
    it('wpisany czas cięcia nie rusza zakresu, bo nie potrafi zmienić kolejności ujęć', () => {
      const before = withLabelInThirdShot()
      const next = setShotStartMs(before, 'c', 1500)
      expect(next.shots.map(s => s.id)).toEqual(['a', 'b', 'c'])
      expect(next.ref.retention[0]?.scope).toBe('appears in [Shot 3]')
    })

    it('zakres zgadza się z numerem ujęcia w skompilowanym prompcie', () => {
      const next = removeShots(withLabelInThirdShot(), ['a'])
      const text = buildPrompt(next).text
      expect(next.ref.retention[0]?.scope).toBe('appears in [Shot 2]')
      expect(text).toContain('appears in [Shot 2]')
      expect(text).not.toContain('appears in [Shot 3]')
    })
  })

  describe('ruch kamery zostaje w swoim ujęciu, gdy to ujęcie się rusza', () => {
    it('podział ujęcia pod nieruchomym ruchem nie zapala CAM_IN_SHOT_BOUNDS', () => {
      const before = withCameraMove()
      expect(ruleIds(before)).not.toContain('CAM_IN_SHOT_BOUNDS')
      const next = splitAtMs(before, 2000)
      expect(ruleIds(next)).not.toContain('CAM_IN_SHOT_BOUNDS')
      const move = next.shots.flatMap(s => s.cameraMoves)[0]
      expect(move?.endMs).toBeLessThanOrEqual(2000)
    })

    it('wpisany czas cięcia skracający ujęcie też nie zapala CAM_IN_SHOT_BOUNDS', () => {
      const next = setShotStartMs(withCameraMove(), 'b', 2000)
      expect(ruleIds(next)).not.toContain('CAM_IN_SHOT_BOUNDS')
    })

    it('ruch mieszczący się w ujęciu nie jest ruszany wcale', () => {
      // Ujęcie 'a' rośnie do 6000 ms, ruch (1000–3000) i tak się mieści — więc
      // nic go nie rusza. Zaciskanie ma być ograniczeniem, nie przepisywaniem.
      const next = setShotStartMs(withCameraMove(), 'b', 6000)
      const move = next.shots.flatMap(s => s.cameraMoves)[0]
      expect([move?.startMs, move?.endMs]).toEqual([1000, 3000])
    })

    /**
     * Rozstrzygający przypadek między dwoma możliwymi zaciskaniami: PRZESUŃ
     * ruch w granice (zachowując długość, jak uchwyt `move` w `clipTargetMs`)
     * albo PRZYTNIJ go do granic. Ruch leżący CAŁY przed nowym początkiem
     * swojego ujęcia odróżnia je jednoznacznie — przycięcie zostawiłoby klip
     * o zerowej długości, czyli nie do zobaczenia i nie do złapania myszą,
     * dokładnie ten stan, przed którym broni `normalizeShots` przy ujęciach.
     */
    it('ruch wypchnięty CAŁY przed nowy początek ujęcia przesuwa się, a nie zapada do zera', () => {
      const project2: Project = {
        ...project,
        shots: [
          shot('a', 0, 0),
          {
            ...shot('b', 1, 2000),
            cameraMoves: [{ id: 'm1', type: 'static' as const, startMs: 2000, endMs: 3000 }],
            body: [{ kind: 'camera' as const, moveId: 'm1' }],
          },
        ],
      }
      const next = setShotStartMs(project2, 'b', 5000)
      const move = next.shots.flatMap(s => s.cameraMoves)[0]
      expect(move?.endMs).toBeGreaterThan(move?.startMs ?? 0)
      expect([move?.startMs, move?.endMs]).toEqual([5000, 6000])
      expect(ruleIds(next)).not.toContain('CAM_IN_SHOT_BOUNDS')
    })
  })

  describe('pierwsze wprowadzenie mówcy przeżywa usunięcie ujęcia', () => {
    it('usunięcie ujęcia z jedynym pełnym wprowadzeniem nie zapala SPEAKER_FIRST_INTRO', () => {
      const before = withSplitIntroduction()
      expect(ruleIds(before)).not.toContain('SPEAKER_FIRST_INTRO')
      const next = removeShots(before, ['a'])
      expect(ruleIds(next)).not.toContain('SPEAKER_FIRST_INTRO')
      expect(next.shots[0]?.body[0]).toEqual({ kind: 'speaker', speakerIds: ['s1'], form: 'full' })
    })
  })

  /**
   * Krótkie spięcie tożsamościowe `normalizeProject`. Trzy pierwsze przypadki
   * zatrzymują się na strażach WEJŚCIOWYCH samych operacji; czwarty jest
   * jedynym, który naprawdę wchodzi do normalizacji (lista ujęć jest świeżo
   * odfiltrowaną, a więc NOWĄ tablicą o niezmienionej zawartości) i dowodzi,
   * że porównanie jest elementowe, nie po tablicy. Bez niego `apply`
   * dokładałby do historii cofania wpis nieodpowiadający żadnej zmianie.
   */
  it('operacja bez żadnej zmiany oddaje ten sam obiekt — historia cofania nie dostaje pustego wpisu', () => {
    const already = withLabelInThirdShot()
    expect(removeShots(already, [])).toBe(already)
    expect(splitAtMs(already, 0)).toBe(already)
    expect(setShotStartMs(already, 'b', 3000)).toBe(already)
    expect(removeShots(already, ['nie-ma-takiego-ujecia'])).toBe(already)
  })
})
