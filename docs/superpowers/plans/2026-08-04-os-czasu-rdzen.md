# MMH3 Prompt Studio — Plan 3: rdzeń osi czasu

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zamienić tymczasową listę ujęć w prawdziwą oś czasu: linijkę z podziałką sekund i klatek, klipy ujęć przeciągane ze snapowaniem do klatki, playhead z odtwarzaniem, kotwice klatek referencyjnych i monitor storyboardu — a przy okazji spłacić dług z planów 1 i 2, który jest tani tylko dopóki nic się z modelem nie związało.

**Architecture:** Oś czasu to warstwa czystych funkcji przeliczających czas na piksele i z powrotem, na której siedzą komponenty React renderujące klipy jako elementy DOM. Cała edycja idzie przez `apply` w magazynie projektu, więc każde przeciągnięcie ląduje w historii cofania i przelicza prompt. Przeciąganie zbija się w jeden wpis historii przez klucz koalescencji, bo inaczej jeden gest dawałby dwieście migawek całego projektu.

**Tech Stack:** TypeScript 5, React 18, Vite 8, Vitest 4 (jsdom), Tailwind 3, Playwright, `@mmh3/shared`.

## Global Constraints

- Pakiet `shared/` jest **zamrożony** dla tego planu poza zadaniem 1. Żadne późniejsze zadanie nie zmienia jego kodu.
- Pięć testów złotych w `shared/test/golden/` musi pozostać zielone przez cały plan. Nie wolno ich modyfikować ani osłabiać żadnej ich asercji.
- `shared/src/` nie importuje Reacta ani `node:*` — jedynym wyjątkiem jest `shared/src/cli.ts`.
- Backend nie importuje niczego z `web/`; frontend nie importuje niczego z `server/`.
- Cały tekst widoczny dla użytkownika przechodzi przez warstwę i18n — żadnych literałów w komponentach. Klucz dodany do połowy polskiej musi trafić też do angielskiej.
- Slug pochodzący z adresu URL nigdy nie trafia do `path.join` bez walidacji kształtu `/^[a-z0-9][a-z0-9-]*$/`.
- FPS jest stałe i wynosi **24**; klatka trwa `1000 / 24` ms. Długość wideo: 4000–15000 ms. Pierwsze ujęcie zawsze zaczyna się w 0 ms i nie dostaje timestampu.
- Każda zmiana modelu idzie przez `useProject.apply` — żaden komponent nie woła `useProject.setState` na polu `project`.
- Commity po polsku, prefiks `feat:` / `fix:` / `test:` / `chore:` / `docs:`. Treść dyktuje krok „Commit" danego zadania.
- tsconfig: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. Lokalne importy z rozszerzeniem `.js`, typy przez `import type`.

---

## Struktura plików

```
web/src/
  timeline/
    scale.ts            czyste przeliczenia czas↔piksele, zoom, snapowanie
    Ruler.tsx           linijka: sekundy, klatki, znaczniki kotwic
    ShotTrack.tsx       ścieżka ujęć — klipy, zaznaczanie, przeciąganie granic
    Playhead.tsx        pionowa linia + przeciąganie
    Timeline.tsx        złożenie: linijka + ścieżki + playhead, obsługa zoomu
    useDragBoundary.ts  gest przeciągania granicy ujęcia
    usePlayback.ts      odtwarzanie playheada w czasie rzeczywistym
  panels/
    ProgramMonitor.tsx  karta ujęcia spod playheada
  store/
    playheadStore.ts    pozycja playheada i stan odtwarzania
```

`scale.ts` nie importuje Reacta — to arytmetyka i ma testy jednostkowe bez DOM. Komponenty nie liczą nic sami: pytają skalę.

---

### Task 1: Dług z planów 1 i 2

Sześć poprawek, wszystkie tanie teraz i drogie po związaniu osi czasu z modelem. Cztery pochodzą z recenzji końcowych, dwie z uwag przeniesionych do `docs/superpowers/specs/2026-08-04-uwagi-do-planu-2.md`. Po tym zadaniu `shared/` jest zamrożony do końca planu.

**Files:**
- Modify: `shared/src/model/schema.ts`
- Modify: `web/src/store/projectStore.ts`
- Modify: `web/src/store/selectionStore.ts`
- Modify: `web/src/panels/AssetBin.tsx`
- Modify: `web/src/panels/PromptPanel.tsx`
- Modify: `web/src/panels/ValidationPanel.tsx`
- Modify: `server/src/storage/projectStore.ts`
- Test: `web/test/store/projectStore.test.ts`
- Test: `web/test/store/selectionStore.test.ts`
- Test: `server/test/storage/projectStore.test.ts`

**Interfaces:**
- Consumes: cały stan z planów 1 i 2
- Produces:
  - `apply(mutate, options?: { coalesceKey?: string })` — kolejne wywołania z tym samym kluczem zastępują wierzchołek historii zamiast dokładać nowy wpis
  - `useSelection` trzyma `selected: ObjectRef[]`, z `select(ref)`, `toggle(ref)`, `clear()`, `isSelected(ref)`
  - `AssetSchema.path` ograniczone do `/^assets\/[A-Za-z0-9._-]+$/`
  - `writeProject` serializowane per slug

- [ ] **Step 1: Napisz testy koalescencji historii**

Dopisz do `web/test/store/projectStore.test.ts`:

```ts
describe('apply z kluczem koalescencji', () => {
  it('zbija serię zmian z tym samym kluczem w jeden wpis historii', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'A' }), { coalesceKey: 'drag:shot-1' })
    useProject.getState().apply(p => ({ ...p, style: 'AB' }), { coalesceKey: 'drag:shot-1' })
    useProject.getState().apply(p => ({ ...p, style: 'ABC' }), { coalesceKey: 'drag:shot-1' })
    expect(useProject.getState().past).toHaveLength(1)
    expect(useProject.getState().project!.style).toBe('ABC')
  })

  it('cofnięcie po serii wraca do stanu sprzed całego gestu', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'A' }), { coalesceKey: 'drag:shot-1' })
    useProject.getState().apply(p => ({ ...p, style: 'AB' }), { coalesceKey: 'drag:shot-1' })
    useProject.getState().undo()
    expect(useProject.getState().project!.style).toBe('')
  })

  it('inny klucz zaczyna nowy wpis', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'A' }), { coalesceKey: 'drag:shot-1' })
    useProject.getState().apply(p => ({ ...p, style: 'B' }), { coalesceKey: 'drag:shot-2' })
    expect(useProject.getState().past).toHaveLength(2)
  })

  it('zmiana bez klucza przerywa serię', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'A' }), { coalesceKey: 'drag:shot-1' })
    useProject.getState().apply(p => ({ ...p, style: 'B' }))
    useProject.getState().apply(p => ({ ...p, style: 'C' }), { coalesceKey: 'drag:shot-1' })
    expect(useProject.getState().past).toHaveLength(3)
  })

  it('load czyści pamięć ostatniego klucza', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'A' }), { coalesceKey: 'drag:shot-1' })
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'B' }), { coalesceKey: 'drag:shot-1' })
    expect(useProject.getState().past).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- projectStore`
Expected: FAIL — `apply` nie przyjmuje drugiego argumentu

- [ ] **Step 3: Zaimplementuj koalescencję**

W `web/src/store/projectStore.ts` rozszerz interfejs i implementację:

```ts
export interface ApplyOptions {
  /**
   * Kolejne wywołania z tym samym kluczem nadpisują wierzchołek historii
   * zamiast dokładać nowy wpis. Bez tego jeden gest przeciągnięcia zostawiłby
   * po jednej migawce całego projektu na każdy ruch myszy, a Ctrl+Z cofałby
   * klip o jeden piksel.
   */
  coalesceKey?: string
}
```

W typie stanu zmień sygnaturę i dodaj pole pamięci:

```ts
  lastCoalesceKey: string | null
  apply: (mutate: (project: Project) => Project, options?: ApplyOptions) => void
```

W ciele magazynu:

```ts
  lastCoalesceKey: null,

  load: (slug, project) =>
    set({
      slug, project, past: [], future: [], dirty: false,
      lastCoalesceKey: null, ...compile(project),
    }),

  apply: (mutate, options) => {
    const { project, past, lastCoalesceKey } = get()
    if (!project) return
    const next = mutate(project)
    const key = options?.coalesceKey ?? null
    const continues = key !== null && key === lastCoalesceKey
    set({
      project: next,
      past: continues ? past : [...past, project].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
      lastCoalesceKey: key,
      ...compile(next),
    })
  },
```

`undo` i `redo` ustawiają `lastCoalesceKey: null` obok pozostałych pól — inaczej gest przerwany cofnięciem sklejałby się z tym, co po nim nastąpi.

- [ ] **Step 4: Uruchom testy koalescencji**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- projectStore`
Expected: PASS

- [ ] **Step 5: Napisz testy zaznaczenia wielokrotnego**

`web/test/store/selectionStore.test.ts`:

```ts
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
```

- [ ] **Step 6: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- selectionStore`
Expected: FAIL — brak `toggle` i `isSelected`

- [ ] **Step 7: Zaimplementuj zaznaczenie wielokrotne**

`web/src/store/selectionStore.ts`:

```ts
import { create } from 'zustand'
import type { ObjectRef } from '@mmh3/shared'

const same = (a: ObjectRef, b: ObjectRef): boolean => a.kind === b.kind && a.id === b.id

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
```

- [ ] **Step 8: Zaktualizuj konsumentów zaznaczenia**

Trzy komponenty czytają dziś `selected` jako pojedynczą wartość. Zmień je na `isSelected`, nie zmieniając niczego innego:

- `web/src/panels/PromptPanel.tsx` — usuń lokalny helper `sameRef` i zamień `sameRef(selected, token.ref)` na `isSelected(token.ref)`, pobierając `const isSelected = useSelection(state => state.isSelected)`.
- `web/src/panels/Inspector.tsx` — `selected?.kind === 'shot'` zamień na wyszukanie pierwszego zaznaczonego ujęcia:

```ts
  const selected = useSelection(state => state.selected)
  const shotRef = selected.find(ref => ref.kind === 'shot')
  const shot = shotRef ? project.shots.find(candidate => candidate.id === shotRef.id) : undefined
```

- `web/src/panels/ShotList.tsx` — `selected?.kind === 'shot' && selected.id === shot.id` zamień na `isSelected({ kind: 'shot', id: shot.id })`.

Istniejące testy tych paneli ustawiają `useSelection.setState({ selected: null })` albo `{ selected: {...} }` — zamień te miejsca na `{ selected: [] }` i `{ selected: [{...}] }`. To jedyna dozwolona zmiana w tamtych testach; żadnej asercji nie ruszaj.

- [ ] **Step 9: Uruchom pełny zestaw frontendu**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web`
Expected: PASS — wszystkie panele zielone

- [ ] **Step 10: Napisz test serializacji zapisów**

Dopisz do `server/test/storage/projectStore.test.ts`:

```ts
  it('równoległe zapisy tego samego projektu nie wywracają się nawzajem', async () => {
    const { slug, project } = await createProject(root, 'Rownolegle', 'T2VA')
    const writes = Array.from({ length: 20 }, (_, index) =>
      writeProject(root, slug, { ...project, name: `Rownolegle ${index}` }))
    await expect(Promise.all(writes)).resolves.toBeDefined()
    const reloaded = await readProject(root, slug)
    expect(reloaded.name).toMatch(/^Rownolegle \d+$/)
    const files = await readdir(projectDir(root, slug))
    expect(files.filter(f => f.endsWith('.tmp'))).toEqual([])
  })
```

- [ ] **Step 11: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/server -- projectStore`
Expected: FAIL — `ENOENT` przy `rename`, bo dwudziestu piszących dzieli jeden plik tymczasowy

- [ ] **Step 12: Zaimplementuj kolejkę zapisów per slug**

W `server/src/storage/projectStore.ts` dodaj kolejkę i przepuść przez nią zapis:

```ts
/**
 * Zapisy tego samego projektu ustawiają się w kolejkę. Bez tego dwaj piszący
 * dzielą jeden plik tymczasowy: pierwszy zdąży z rename, a drugi dostanie
 * ENOENT. Kolejka jest per slug, więc różne projekty nadal zapisują się równolegle.
 */
const writeQueues = new Map<string, Promise<void>>()

export async function writeProject(root: string, slug: string, project: Project): Promise<void> {
  assertInsideRoot(root, projectDir(root, slug))
  const previous = writeQueues.get(slug) ?? Promise.resolve()
  const current = previous
    .catch(() => undefined)
    .then(() => writeProjectNow(root, slug, project))
  writeQueues.set(slug, current)
  try {
    await current
  } finally {
    if (writeQueues.get(slug) === current) writeQueues.delete(slug)
  }
}

async function writeProjectNow(root: string, slug: string, project: Project): Promise<void> {
  await mkdir(projectDir(root, slug), { recursive: true })
  const target = projectFile(root, slug)
  const temporary = `${target}.tmp`
  await writeFile(temporary, `${JSON.stringify(project, null, 2)}\n`, 'utf8')
  await rename(temporary, target)
}
```

Dopisz `readdir` do importów w pliku testowym, jeśli go nie ma.

- [ ] **Step 13: Uruchom testy magazynu**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/server -- projectStore`
Expected: PASS

- [ ] **Step 14: Zawęź schemat ścieżki assetu**

W `shared/src/model/schema.ts`, w schemacie assetu, zamień `path: z.string()` na:

```ts
    // Ścieżka assetu jest wyliczana przez serwer i zawsze ma tę postać.
    // Nieograniczony string pozwalał wskazać plik spoza katalogu projektu.
    path: z.string().regex(/^assets\/[A-Za-z0-9._-]+$/),
```

To jedyna dozwolona zmiana w `shared/` w całym tym planie.

Dopisz do `shared/test/model/schema.test.ts`:

```ts
  it('odrzuca ścieżkę assetu wychodzącą poza katalog projektu', () => {
    const bad = {
      ...minimal,
      assets: [{ id: 'a1', kind: 'image', path: '../../../etc/passwd', fileName: 'x.png' }],
    }
    expect(ProjectSchema.safeParse(bad).success).toBe(false)
  })

  it('przyjmuje ścieżkę w postaci, jaką generuje serwer', () => {
    const good = {
      ...minimal,
      assets: [{ id: 'a1', kind: 'image', path: 'assets/asset-1.img', fileName: 'x.png' }],
    }
    expect(ProjectSchema.safeParse(good).success).toBe(true)
  })
```

- [ ] **Step 15: Napraw numerację etykiet i mówców**

`web/src/panels/AssetBin.tsx` wylicza kolejny numer z liczby istniejących wpisów, więc po usunięciu któregoś dojdzie do kolizji. Usuwania jeszcze nie ma, ale będzie. Zamień oba miejsca na maksimum:

```ts
    const nextIndex = Math.max(0, ...current.labels
      .filter(label => label.kind === kind)
      .map(label => label.index)) + 1
```

```ts
    const nextNumber = Math.max(0, ...current.speakers
      .map(speaker => Number(speaker.code.slice(1)))
      .filter(Number.isFinite)) + 1
    const code = `S${nextNumber}`
```

Dopisz do `web/test/panels/assetBin.test.tsx`:

```tsx
  it('numeruje etykietę po najwyższym numerze, nie po liczbie wpisów', async () => {
    useProject.getState().apply(p => ({
      ...p,
      labels: [{
        id: 'l9', kind: 'picture', index: 9, assetIds: [],
        definition: '', role: '', standalone: true,
      }],
    }))
    render(<AssetBin slug="test" />)
    await userEvent.click(screen.getAllByRole('button', { name: /utwórz etykietę/i })[0]!)
    const labels = useProject.getState().project!.labels
    expect(labels.find(l => l.id !== 'l9')!.index).toBe(10)
  })
```

- [ ] **Step 16: Uruchom cały zestaw i sprawdzenie typów**

Run: `cd ~/mmh3-studio && npm test && npm run typecheck`
Expected: PASS — wszystkie testy zielone, w tym pięć złotych

- [ ] **Step 17: Commit**

```bash
cd ~/mmh3-studio
git add shared server web
git commit -m "feat: splac dlug przed budowa osi czasu

Koalescencja historii cofania, zaznaczenie wielokrotne, kolejka zapisow
per slug, zawezony schemat sciezki assetu i numeracja po maksimum
zamiast po liczbie wpisow. Wszystko tanie teraz i drogie po zwiazaniu
osi czasu z modelem."
```

---

### Task 2: Skala czasu

Czysta arytmetyka przeliczająca milisekundy na piksele i z powrotem, plus snapowanie. Bez Reacta, bez DOM — dzięki temu wszystkie przypadki brzegowe osi czasu testują się jako funkcje.

**Files:**
- Create: `web/src/timeline/scale.ts`
- Test: `web/test/timeline/scale.test.ts`

**Interfaces:**
- Consumes: `MS_PER_FRAME`, `snapToFrame` z `@mmh3/shared`
- Produces:
  - `Scale = { durationMs: number; widthPx: number; zoom: number; pxPerMs: number }`
  - `createScale(durationMs: number, widthPx: number, zoom: number): Scale`
  - `msToPx(scale: Scale, ms: number): number`
  - `pxToMs(scale: Scale, px: number): number`
  - `secondTicks(scale: Scale): number[]`
  - `frameTicks(scale: Scale): number[]`
  - `snapMs(ms: number, points: number[], toleranceMs: number): number`
  - `MIN_ZOOM = 1`, `MAX_ZOOM = 64`, `clampZoom(zoom: number): number`

- [ ] **Step 1: Napisz testy**

`web/test/timeline/scale.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  clampZoom, createScale, frameTicks, msToPx, pxToMs, secondTicks, snapMs,
  MAX_ZOOM, MIN_ZOOM,
} from '../../src/timeline/scale.js'

const scale = (zoom = 1) => createScale(8000, 800, zoom)

describe('createScale', () => {
  it('przy zoomie 1 mieści całą długość w dostępnej szerokości', () => {
    expect(msToPx(scale(), 8000)).toBe(800)
    expect(msToPx(scale(), 0)).toBe(0)
  })

  it('zoom mnoży szerokość, nie długość', () => {
    expect(msToPx(scale(2), 8000)).toBe(1600)
    expect(scale(2).durationMs).toBe(8000)
  })

  it('ogranicza zoom do dozwolonego zakresu', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM)
    expect(clampZoom(1000)).toBe(MAX_ZOOM)
    expect(clampZoom(4)).toBe(4)
  })

  it('nie dzieli przez zero przy zerowej szerokości', () => {
    expect(msToPx(createScale(8000, 0, 1), 4000)).toBe(0)
    expect(pxToMs(createScale(8000, 0, 1), 100)).toBe(0)
  })
})

describe('pxToMs', () => {
  it('jest odwrotnością msToPx', () => {
    const s = scale(3)
    for (const ms of [0, 1234, 4000, 7999, 8000]) {
      expect(Math.round(pxToMs(s, msToPx(s, ms)))).toBe(ms)
    }
  })

  it('przycina do zakresu wideo', () => {
    expect(pxToMs(scale(), -50)).toBe(0)
    expect(pxToMs(scale(), 5000)).toBe(8000)
  })
})

describe('secondTicks', () => {
  it('daje znacznik na każdą pełną sekundę wraz z końcem', () => {
    expect(secondTicks(scale())).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000])
  })

  it('nie gubi ostatniej sekundy przy niepełnej długości', () => {
    expect(secondTicks(createScale(8500, 800, 1))).toEqual(
      [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 8500],
    )
  })
})

describe('frameTicks', () => {
  it('milczy, dopóki klatki są nieczytelnie gęste', () => {
    expect(frameTicks(scale(1))).toEqual([])
  })

  it('przy dużym zoomie daje znaczniki co klatkę', () => {
    const ticks = frameTicks(scale(MAX_ZOOM))
    expect(ticks.length).toBeGreaterThan(100)
    expect(ticks[0]).toBe(0)
    expect(ticks[1]).toBe(42)
  })
})

describe('snapMs', () => {
  it('przyciąga do najbliższego punktu w zasięgu', () => {
    expect(snapMs(4980, [0, 5000, 8000], 50)).toBe(5000)
  })

  it('zostawia wartość, gdy nic nie jest w zasięgu', () => {
    expect(snapMs(4000, [0, 5000, 8000], 50)).toBe(4000)
  })

  it('wybiera bliższy punkt, gdy dwa są w zasięgu', () => {
    expect(snapMs(4990, [4900, 5000], 200)).toBe(5000)
  })

  it('radzi sobie z pustą listą punktów', () => {
    expect(snapMs(1234, [], 50)).toBe(1234)
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- scale`
Expected: FAIL — brak modułu

- [ ] **Step 3: Zaimplementuj**

`web/src/timeline/scale.ts`:

```ts
import { MS_PER_FRAME } from '@mmh3/shared'

export const MIN_ZOOM = 1
export const MAX_ZOOM = 64

/**
 * Poniżej tej gęstości znaczniki klatek zlewają się w szarą plamę. Przy zoomie 1
 * i ośmiu sekundach odstęp klatki wynosi 4,17 px, więc próg musi być wyższy —
 * inaczej pierwszy poziom przybliżenia od razu rysowałby dwieście kresek.
 */
const MIN_FRAME_GAP_PX = 6

export interface Scale {
  durationMs: number
  widthPx: number
  zoom: number
  pxPerMs: number
}

export const clampZoom = (zoom: number): number =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

export function createScale(durationMs: number, widthPx: number, zoom: number): Scale {
  const safeZoom = clampZoom(zoom)
  const pxPerMs = durationMs > 0 ? (widthPx * safeZoom) / durationMs : 0
  return { durationMs, widthPx, zoom: safeZoom, pxPerMs }
}

export const msToPx = (scale: Scale, ms: number): number => ms * scale.pxPerMs

export function pxToMs(scale: Scale, px: number): number {
  if (scale.pxPerMs === 0) return 0
  const ms = px / scale.pxPerMs
  return Math.min(scale.durationMs, Math.max(0, ms))
}

export function secondTicks(scale: Scale): number[] {
  const ticks: number[] = []
  for (let ms = 0; ms <= scale.durationMs; ms += 1000) ticks.push(ms)
  const last = ticks[ticks.length - 1]
  if (last !== undefined && last !== scale.durationMs) ticks.push(scale.durationMs)
  return ticks
}

export function frameTicks(scale: Scale): number[] {
  if (msToPx(scale, MS_PER_FRAME) < MIN_FRAME_GAP_PX) return []
  const ticks: number[] = []
  for (let frame = 0; frame * MS_PER_FRAME <= scale.durationMs; frame += 1) {
    ticks.push(Math.round(frame * MS_PER_FRAME))
  }
  return ticks
}

/** Przyciąga do najbliższego punktu, o ile mieści się w tolerancji. */
export function snapMs(ms: number, points: number[], toleranceMs: number): number {
  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const point of points) {
    const distance = Math.abs(point - ms)
    if (distance > toleranceMs || distance >= bestDistance) continue
    best = point
    bestDistance = distance
  }
  return best ?? ms
}
```

- [ ] **Step 4: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- scale && npm run typecheck`
Expected: PASS, 14 testów

- [ ] **Step 5: Commit**

```bash
cd ~/mmh3-studio
git add web/src/timeline/scale.ts web/test/timeline/scale.test.ts
git commit -m "feat: skala czasu osi z snapowaniem i znacznikami"
```

---

### Task 3: Magazyn playheada

**Files:**
- Create: `web/src/store/playheadStore.ts`
- Test: `web/test/store/playheadStore.test.ts`

**Interfaces:**
- Consumes: `snapToFrame` z `@mmh3/shared`
- Produces: `usePlayhead` — `{ ms, playing, setMs(ms, durationMs), stepFrames(count, durationMs), play(), pause(), toggle(), reset() }`

- [ ] **Step 1: Napisz testy**

`web/test/store/playheadStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { usePlayhead } from '../../src/store/playheadStore.js'

beforeEach(() => usePlayhead.setState({ ms: 0, playing: false }))

describe('usePlayhead', () => {
  it('przycina pozycję do długości wideo', () => {
    usePlayhead.getState().setMs(-100, 8000)
    expect(usePlayhead.getState().ms).toBe(0)
    usePlayhead.getState().setMs(99999, 8000)
    expect(usePlayhead.getState().ms).toBe(8000)
  })

  it('przyciąga pozycję do granicy klatki', () => {
    usePlayhead.getState().setMs(1000, 8000)
    expect(usePlayhead.getState().ms).toBe(1000)
    usePlayhead.getState().setMs(30, 8000)
    expect(usePlayhead.getState().ms).toBe(42)
  })

  it('przesuwa o zadaną liczbę klatek', () => {
    usePlayhead.getState().setMs(1000, 8000)
    usePlayhead.getState().stepFrames(1, 8000)
    expect(usePlayhead.getState().ms).toBe(1042)
    usePlayhead.getState().stepFrames(-1, 8000)
    expect(usePlayhead.getState().ms).toBe(1000)
  })

  it('nie wychodzi poza zakres przy przesuwaniu', () => {
    usePlayhead.getState().setMs(0, 8000)
    usePlayhead.getState().stepFrames(-10, 8000)
    expect(usePlayhead.getState().ms).toBe(0)
  })

  it('przełącza odtwarzanie', () => {
    usePlayhead.getState().toggle()
    expect(usePlayhead.getState().playing).toBe(true)
    usePlayhead.getState().toggle()
    expect(usePlayhead.getState().playing).toBe(false)
  })

  it('zatrzymuje odtwarzanie przy resecie', () => {
    usePlayhead.getState().play()
    usePlayhead.getState().setMs(4000, 8000)
    usePlayhead.getState().reset()
    expect(usePlayhead.getState()).toMatchObject({ ms: 0, playing: false })
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- playheadStore`
Expected: FAIL — brak modułu

- [ ] **Step 3: Zaimplementuj**

`web/src/store/playheadStore.ts`:

```ts
import { create } from 'zustand'
import { MS_PER_FRAME, snapToFrame } from '@mmh3/shared'

interface PlayheadState {
  ms: number
  playing: boolean
  setMs: (ms: number, durationMs: number) => void
  stepFrames: (count: number, durationMs: number) => void
  play: () => void
  pause: () => void
  toggle: () => void
  reset: () => void
}

/** Playhead zawsze stoi na granicy klatki — tak samo jak czasy cięć w modelu. */
const clampToFrame = (ms: number, durationMs: number): number =>
  snapToFrame(Math.min(durationMs, Math.max(0, ms)))

export const usePlayhead = create<PlayheadState>((set, get) => ({
  ms: 0,
  playing: false,
  setMs: (ms, durationMs) => set({ ms: clampToFrame(ms, durationMs) }),
  stepFrames: (count, durationMs) =>
    set({ ms: clampToFrame(get().ms + count * MS_PER_FRAME, durationMs) }),
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  toggle: () => set({ playing: !get().playing }),
  reset: () => set({ ms: 0, playing: false }),
}))
```

- [ ] **Step 4: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- playheadStore && npm run typecheck`
Expected: PASS, 6 testów

- [ ] **Step 5: Commit**

```bash
cd ~/mmh3-studio
git add web/src/store/playheadStore.ts web/test/store/playheadStore.test.ts
git commit -m "feat: magazyn playheada z przyciaganiem do klatek"
```

---

### Task 4: Linijka

**Files:**
- Create: `web/src/timeline/Ruler.tsx`
- Modify: `web/src/i18n/dict.ts`
- Test: `web/test/timeline/ruler.test.tsx`

**Interfaces:**
- Consumes: `Scale`, `msToPx`, `secondTicks`, `frameTicks`, `pxToMs`, `usePlayhead`
- Produces: `<Ruler scale={Scale} />` — podziałka sekund i klatek, kliknięcie ustawia playhead

- [ ] **Step 1: Dodaj klucze słownika**

W `web/src/i18n/dict.ts` dopisz do połowy polskiej, obok kluczy `editor.*`:

```ts
  'timeline.ruler': 'Linijka czasu',
  'timeline.title': 'Oś czasu',
  'timeline.zoomIn': 'Przybliż',
  'timeline.zoomOut': 'Oddal',
  'timeline.zoomFit': 'Dopasuj',
  'timeline.play': 'Odtwarzaj',
  'timeline.pause': 'Zatrzymaj',
  'timeline.playhead': 'Znacznik odtwarzania',
```

i do angielskiej:

```ts
  'timeline.ruler': 'Time ruler',
  'timeline.title': 'Timeline',
  'timeline.zoomIn': 'Zoom in',
  'timeline.zoomOut': 'Zoom out',
  'timeline.zoomFit': 'Fit',
  'timeline.play': 'Play',
  'timeline.pause': 'Pause',
  'timeline.playhead': 'Playhead',
```

- [ ] **Step 2: Napisz testy**

`web/test/timeline/ruler.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Ruler } from '../../src/timeline/Ruler.js'
import { createScale } from '../../src/timeline/scale.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { useLang } from '../../src/i18n/useT.js'

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  usePlayhead.setState({ ms: 0, playing: false })
})

describe('Ruler', () => {
  it('podpisuje pełne sekundy', () => {
    render(<Ruler scale={createScale(8000, 800, 1)} />)
    expect(screen.getByText('0s')).toBeInTheDocument()
    expect(screen.getByText('8s')).toBeInTheDocument()
  })

  it('nie rysuje znaczników klatek przy małym zoomie', () => {
    const { container } = render(<Ruler scale={createScale(8000, 800, 1)} />)
    expect(container.querySelectorAll('[data-frame-tick]')).toHaveLength(0)
  })

  it('rysuje znaczniki klatek przy dużym zoomie', () => {
    const { container } = render(<Ruler scale={createScale(8000, 800, 64)} />)
    expect(container.querySelectorAll('[data-frame-tick]').length).toBeGreaterThan(100)
  })

  it('kliknięcie ustawia playhead na wskazanym czasie', () => {
    const scale = createScale(8000, 800, 1)
    render(<Ruler scale={scale} />)
    const ruler = screen.getByRole('slider', { name: /linijka czasu/i })
    ruler.getBoundingClientRect = () => ({ left: 0, width: 800 }) as DOMRect
    fireEvent.pointerDown(ruler, { clientX: 400 })
    expect(usePlayhead.getState().ms).toBe(4000)
  })
})
```

- [ ] **Step 3: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- ruler`
Expected: FAIL — brak modułu

- [ ] **Step 4: Zaimplementuj**

`web/src/timeline/Ruler.tsx`:

```tsx
import { usePlayhead } from '../store/playheadStore.js'
import { useT } from '../i18n/useT.js'
import { frameTicks, msToPx, pxToMs, secondTicks, type Scale } from './scale.js'

export function Ruler({ scale }: { scale: Scale }) {
  const t = useT()
  const setMs = usePlayhead(state => state.setMs)
  const ms = usePlayhead(state => state.ms)

  const seek = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    setMs(pxToMs(scale, event.clientX - bounds.left), scale.durationMs)
  }

  return (
    <div
      role="slider"
      aria-label={t('timeline.ruler')}
      aria-valuemin={0}
      aria-valuemax={scale.durationMs}
      aria-valuenow={ms}
      tabIndex={0}
      onPointerDown={seek}
      className="relative h-6 cursor-pointer select-none border-b border-neutral-800 bg-neutral-900"
      style={{ width: msToPx(scale, scale.durationMs) }}
    >
      {frameTicks(scale).map(tick => (
        <span
          key={`f${tick}`}
          data-frame-tick
          className="absolute bottom-0 h-1 w-px bg-neutral-700"
          style={{ left: msToPx(scale, tick) }}
        />
      ))}
      {secondTicks(scale).map(tick => (
        <span key={`s${tick}`} className="absolute bottom-0 top-0" style={{ left: msToPx(scale, tick) }}>
          <span className="absolute bottom-0 top-0 w-px bg-neutral-600" />
          <span className="absolute left-1 top-0 font-mono text-[10px] text-neutral-500">
            {Math.round(tick / 1000)}s
          </span>
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web && npm run typecheck`
Expected: PASS, 4 nowe testy

- [ ] **Step 6: Commit**

```bash
cd ~/mmh3-studio
git add web/src/timeline/Ruler.tsx web/src/i18n/dict.ts web/test/timeline/ruler.test.tsx
git commit -m "feat: linijka czasu z podzialka sekund i klatek"
```

---

### Task 5: Rozpiętości ujęć i ścieżka SHOTS

**Files:**
- Create: `web/src/timeline/spans.ts`
- Create: `web/src/timeline/ShotTrack.tsx`
- Modify: `web/src/i18n/dict.ts`
- Test: `web/test/timeline/spans.test.ts`
- Test: `web/test/timeline/shotTrack.test.tsx`

**Interfaces:**
- Consumes: `Scale`, `msToPx`, `useProject`, `useSelection`
- Produces:
  - `ShotSpan = { shot: Shot; startMs: number; endMs: number }`
  - `shotSpans(shots: Shot[], durationMs: number): ShotSpan[]` — posortowane po indeksie, koniec każdego ujęcia to początek następnego
  - `<ShotTrack scale={Scale} />`

- [ ] **Step 1: Napisz testy rozpiętości**

`web/test/timeline/spans.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { Shot } from '@mmh3/shared'
import { shotSpans } from '../../src/timeline/spans.js'

const shot = (id: string, index: number, startMs: number): Shot => ({
  id, index, startMs, cutType: 'cut', cutPhrase: 'the camera cuts to',
  composition: '', body: [], cameraMoves: [], dialogue: [],
  screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
})

describe('shotSpans', () => {
  it('koniec ujęcia to początek następnego', () => {
    const spans = shotSpans([shot('a', 0, 0), shot('b', 1, 3000)], 8000)
    expect(spans.map(s => [s.startMs, s.endMs])).toEqual([[0, 3000], [3000, 8000]])
  })

  it('ostatnie ujęcie sięga końca wideo', () => {
    const spans = shotSpans([shot('a', 0, 0)], 8000)
    expect(spans[0]!.endMs).toBe(8000)
  })

  it('porządkuje po indeksie, nie po kolejności w tablicy', () => {
    const spans = shotSpans([shot('b', 1, 3000), shot('a', 0, 0)], 8000)
    expect(spans.map(s => s.shot.id)).toEqual(['a', 'b'])
  })

  it('nie produkuje ujemnej rozpiętości, gdy cięcie wypada poza wideo', () => {
    const spans = shotSpans([shot('a', 0, 0), shot('b', 1, 9000)], 8000)
    expect(spans[1]!.endMs).toBeGreaterThanOrEqual(spans[1]!.startMs)
  })

  it('zwraca pustą listę dla projektu bez ujęć', () => {
    expect(shotSpans([], 8000)).toEqual([])
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- spans`
Expected: FAIL — brak modułu

- [ ] **Step 3: Zaimplementuj rozpiętości**

`web/src/timeline/spans.ts`:

```ts
import type { Shot } from '@mmh3/shared'

export interface ShotSpan {
  shot: Shot
  startMs: number
  endMs: number
}

/**
 * Ujęcia w modelu niosą tylko czas cięcia. Koniec wynika z początku następnego,
 * a ostatnie sięga końca wideo — oś czasu potrzebuje obu wartości.
 */
export function shotSpans(shots: Shot[], durationMs: number): ShotSpan[] {
  const ordered = [...shots].sort((a, b) => a.index - b.index)
  return ordered.map((shot, position) => {
    const next = ordered[position + 1]
    const endMs = next ? next.startMs : durationMs
    return { shot, startMs: shot.startMs, endMs: Math.max(shot.startMs, endMs) }
  })
}
```

- [ ] **Step 4: Dodaj klucze słownika**

W `web/src/i18n/dict.ts` dopisz do połowy polskiej:

```ts
  'timeline.trackShots': 'Ujęcia',
  'timeline.clipLabel': 'Ujęcie {number}, od {start} ms do {end} ms',
```

i do angielskiej:

```ts
  'timeline.trackShots': 'Shots',
  'timeline.clipLabel': 'Shot {number}, from {start} ms to {end} ms',
```

- [ ] **Step 5: Napisz testy ścieżki**

`web/test/timeline/shotTrack.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@mmh3/shared'
import { ShotTrack } from '../../src/timeline/ShotTrack.js'
import { createScale } from '../../src/timeline/scale.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useLang } from '../../src/i18n/useT.js'

const shot = (id: string, index: number, startMs: number) => ({
  id, index, startMs, cutType: 'cut' as const, cutPhrase: 'the camera cuts to' as const,
  composition: '', body: [], cameraMoves: [], dialogue: [],
  screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
})

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic', assets: [], labels: [], speakers: [],
  shots: [shot('a', 0, 0), shot('b', 1, 3000)],
  audio: { overallSoundscape: 'Rain.', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useSelection.setState({ selected: [] })
  useProject.getState().load('test', project)
})

describe('ShotTrack', () => {
  it('rysuje klip na każde ujęcie', () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    expect(screen.getAllByRole('button', { name: /ujęcie \d/i })).toHaveLength(2)
  })

  it('szerokość klipu odpowiada jego rozpiętości', () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    const first = screen.getByRole('button', { name: /ujęcie 1/i })
    expect(first.style.left).toBe('0px')
    expect(first.style.width).toBe('300px')
  })

  it('kliknięcie zaznacza ujęcie', async () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    await userEvent.click(screen.getByRole('button', { name: /ujęcie 2/i }))
    expect(useSelection.getState().selected).toEqual([{ kind: 'shot', id: 'b' }])
  })

  it('kliknięcie z Shiftem dokłada do zaznaczenia', async () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    await userEvent.click(screen.getByRole('button', { name: /ujęcie 1/i }))
    await userEvent.keyboard('{Shift>}')
    await userEvent.click(screen.getByRole('button', { name: /ujęcie 2/i }))
    await userEvent.keyboard('{/Shift}')
    expect(useSelection.getState().selected).toHaveLength(2)
  })

  it('zaznaczony klip jest oznaczony dla czytnika ekranu', async () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    await userEvent.click(screen.getByRole('button', { name: /ujęcie 1/i }))
    expect(screen.getByRole('button', { name: /ujęcie 1/i })).toHaveAttribute('aria-pressed', 'true')
  })
})
```

- [ ] **Step 6: Zaimplementuj ścieżkę**

`web/src/timeline/ShotTrack.tsx`:

```tsx
import { useProject } from '../store/projectStore.js'
import { useSelection } from '../store/selectionStore.js'
import { useT } from '../i18n/useT.js'
import { msToPx, type Scale } from './scale.js'
import { shotSpans } from './spans.js'

export function ShotTrack({ scale }: { scale: Scale }) {
  const t = useT()
  const project = useProject(state => state.project)
  const select = useSelection(state => state.select)
  const toggle = useSelection(state => state.toggle)
  const isSelected = useSelection(state => state.isSelected)

  if (!project) return null

  return (
    <div
      aria-label={t('timeline.trackShots')}
      className="relative h-10 border-b border-neutral-800"
      style={{ width: msToPx(scale, scale.durationMs) }}
    >
      {shotSpans(project.shots, project.video.durationMs).map(span => {
        const ref = { kind: 'shot' as const, id: span.shot.id }
        const selected = isSelected(ref)
        return (
          <button
            key={span.shot.id}
            type="button"
            aria-pressed={selected}
            aria-label={t('timeline.clipLabel', {
              number: span.shot.index + 1, start: span.startMs, end: span.endMs,
            })}
            onClick={event => (event.shiftKey ? toggle(ref) : select(ref))}
            className={`absolute top-1 h-8 overflow-hidden rounded border px-2 text-left text-xs ${
              selected
                ? 'border-sky-600 bg-sky-950 text-sky-100'
                : 'border-neutral-700 bg-neutral-900 hover:border-neutral-500'
            }`}
            style={{
              left: msToPx(scale, span.startMs),
              width: Math.max(2, msToPx(scale, span.endMs - span.startMs)),
            }}
          >
            <span className="font-mono">{span.shot.index + 1}</span>
            {span.shot.composition && (
              <span className="ml-2 text-neutral-400">{span.shot.composition}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 7: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web && npm run typecheck`
Expected: PASS, 10 nowych testów

- [ ] **Step 8: Commit**

```bash
cd ~/mmh3-studio
git add web/src/timeline web/src/i18n/dict.ts web/test/timeline
git commit -m "feat: sciezka ujec z klipami i zaznaczaniem"
```

---

### Task 6: Przeciąganie granicy ujęcia

**Files:**
- Create: `web/src/timeline/useDragBoundary.ts`
- Modify: `web/src/timeline/ShotTrack.tsx`
- Test: `web/test/timeline/dragBoundary.test.tsx`

**Interfaces:**
- Consumes: `Scale`, `pxToMs`, `snapMs`, `shotSpans`, `useProject`, `snapToFrame`
- Produces:
  - `MIN_SHOT_MS` — najkrótsze dopuszczalne ujęcie, dwie klatki
  - `boundaryTargetMs(args): number` — czysta funkcja licząca docelowy czas cięcia z ograniczeniami i snapowaniem
  - `useDragBoundary(scale: Scale): (shotId: string, event: React.PointerEvent) => void`

Granica przeciągana jest zawsze **początkiem** danego ujęcia, więc pierwsze ujęcie nie ma uchwytu — jego czas jest z definicji zerem.

- [ ] **Step 1: Napisz testy funkcji czystej**

`web/test/timeline/dragBoundary.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Project } from '@mmh3/shared'
import { boundaryTargetMs, MIN_SHOT_MS } from '../../src/timeline/useDragBoundary.js'
import { ShotTrack } from '../../src/timeline/ShotTrack.js'
import { createScale } from '../../src/timeline/scale.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useLang } from '../../src/i18n/useT.js'

describe('boundaryTargetMs', () => {
  const base = { previousMs: 0, nextMs: 8000, snapPoints: [] as number[], toleranceMs: 40 }

  it('przyciąga do granicy klatki', () => {
    expect(boundaryTargetMs({ ...base, desiredMs: 3010 })).toBe(3000)
  })

  it('nie pozwala zejść bliżej niż minimalna długość ujęcia do poprzedniego', () => {
    expect(boundaryTargetMs({ ...base, desiredMs: 10 })).toBe(MIN_SHOT_MS)
  })

  it('nie pozwala podejść bliżej niż minimalna długość ujęcia do następnego', () => {
    expect(boundaryTargetMs({ ...base, desiredMs: 7990 })).toBe(8000 - MIN_SHOT_MS)
  })

  it('przyciąga do podanego punktu, gdy jest bliżej niż tolerancja', () => {
    expect(boundaryTargetMs({ ...base, desiredMs: 4010, snapPoints: [4000] })).toBe(4000)
  })

  it('punkt spoza tolerancji nie przyciąga', () => {
    expect(boundaryTargetMs({ ...base, desiredMs: 4500, snapPoints: [4000] })).toBe(4500)
  })

  it('ograniczenia mają pierwszeństwo przed punktem przyciągania', () => {
    expect(boundaryTargetMs({ ...base, desiredMs: 10, snapPoints: [0] })).toBe(MIN_SHOT_MS)
  })
})

const shot = (id: string, index: number, startMs: number) => ({
  id, index, startMs, cutType: 'cut' as const, cutPhrase: 'the camera cuts to' as const,
  composition: '', body: [], cameraMoves: [], dialogue: [],
  screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
})

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic', assets: [], labels: [], speakers: [],
  shots: [shot('a', 0, 0), shot('b', 1, 3000)],
  audio: { overallSoundscape: 'Rain.', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useSelection.setState({ selected: [] })
  useProject.getState().load('test', project)
})

describe('przeciąganie granicy w ścieżce ujęć', () => {
  const dragTo = (clientX: number) => {
    const handle = screen.getByRole('separator', { name: /ujęcie 2/i })
    handle.setPointerCapture = () => {}
    handle.releasePointerCapture = () => {}
    const track = handle.parentElement!
    track.getBoundingClientRect = () => ({ left: 0, width: 800 }) as DOMRect
    fireEvent.pointerDown(handle, { clientX: 300, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX, pointerId: 1 })
  }

  it('pierwsze ujęcie nie ma uchwytu, bo jego czas jest zawsze zerem', () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    expect(screen.queryByRole('separator', { name: /ujęcie 1/i })).not.toBeInTheDocument()
  })

  it('przeciągnięcie zmienia czas cięcia', () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    dragTo(500)
    expect(useProject.getState().project!.shots[1]!.startMs).toBe(5000)
  })

  it('cały gest zostawia jeden wpis w historii cofania', () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    const handle = screen.getByRole('separator', { name: /ujęcie 2/i })
    handle.setPointerCapture = () => {}
    handle.releasePointerCapture = () => {}
    handle.parentElement!.getBoundingClientRect = () => ({ left: 0, width: 800 }) as DOMRect
    fireEvent.pointerDown(handle, { clientX: 300, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 400, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 450, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 500, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 500, pointerId: 1 })
    expect(useProject.getState().past).toHaveLength(1)
  })

  it('dwa kolejne gesty to dwa wpisy w historii', () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    dragTo(500)
    dragTo(600)
    expect(useProject.getState().past).toHaveLength(2)
  })

  it('nie da się przeciągnąć poza sąsiadów', () => {
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    dragTo(-200)
    expect(useProject.getState().project!.shots[1]!.startMs).toBe(MIN_SHOT_MS)
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- dragBoundary`
Expected: FAIL — brak modułu

- [ ] **Step 3: Zaimplementuj gest**

`web/src/timeline/useDragBoundary.ts`:

```ts
import { useRef } from 'react'
import { MS_PER_FRAME, snapToFrame } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { pxToMs, snapMs, type Scale } from './scale.js'
import { shotSpans } from './spans.js'

/** Dwie klatki. Krócej i po przyciągnięciu do klatki cięcia przestałyby rosnąć. */
export const MIN_SHOT_MS = Math.round(2 * MS_PER_FRAME)

export interface BoundaryArgs {
  desiredMs: number
  previousMs: number
  nextMs: number
  snapPoints: number[]
  toleranceMs: number
}

/**
 * Docelowy czas cięcia: najpierw przyciąganie do punktów, potem do klatki,
 * na końcu ograniczenia sąsiadów. Kolejność ma znaczenie — ograniczenie
 * postawione na końcu nie da się obejść żadnym przyciąganiem.
 */
export function boundaryTargetMs(args: BoundaryArgs): number {
  const snapped = snapToFrame(snapMs(args.desiredMs, args.snapPoints, args.toleranceMs))
  const lowest = args.previousMs + MIN_SHOT_MS
  const highest = args.nextMs - MIN_SHOT_MS
  return Math.min(Math.max(snapped, lowest), highest)
}

export function useDragBoundary(scale: Scale) {
  const gesture = useRef(0)

  return (shotId: string, event: React.PointerEvent<HTMLElement>) => {
    const project = useProject.getState().project
    if (!project) return
    const track = event.currentTarget.parentElement
    if (!track) return

    event.preventDefault()
    event.stopPropagation()
    gesture.current += 1
    const coalesceKey = `shot-boundary:${shotId}:${gesture.current}`
    const bounds = track.getBoundingClientRect()
    const target = event.currentTarget

    const move = (moveEvent: PointerEvent) => {
      const current = useProject.getState().project
      if (!current) return
      const spans = shotSpans(current.shots, current.video.durationMs)
      const position = spans.findIndex(span => span.shot.id === shotId)
      if (position <= 0) return

      const desiredMs = pxToMs(scale, moveEvent.clientX - bounds.left)
      const snapPoints = [
        0,
        current.video.durationMs,
        ...spans.filter(span => span.shot.id !== shotId).map(span => span.startMs),
      ]
      const startMs = boundaryTargetMs({
        desiredMs,
        previousMs: spans[position - 1]!.startMs,
        nextMs: spans[position + 1]?.startMs ?? current.video.durationMs,
        snapPoints,
        toleranceMs: MIN_SHOT_MS,
      })

      useProject.getState().apply(
        candidate => ({
          ...candidate,
          shots: candidate.shots.map(shot => shot.id === shotId ? { ...shot, startMs } : shot),
        }),
        { coalesceKey },
      )
    }

    const finish = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', finish)
      target.removeEventListener('pointercancel', finish)
      try {
        target.releasePointerCapture(event.pointerId)
      } catch {
        // Przeglądarka mogła już zwolnić przechwycenie — to nie jest błąd.
      }
    }

    target.setPointerCapture(event.pointerId)
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', finish)
    target.addEventListener('pointercancel', finish)
  }
}
```

- [ ] **Step 4: Dodaj uchwyty do ścieżki**

W `web/src/timeline/ShotTrack.tsx` dopisz import i wywołanie hooka:

```tsx
import { useDragBoundary } from './useDragBoundary.js'
```

```tsx
  const startDrag = useDragBoundary(scale)
```

a wewnątrz mapowania, zaraz po przycisku klipu, dodaj uchwyt dla każdego ujęcia poza pierwszym:

```tsx
        {span.shot.index > 0 && (
          <div
            role="separator"
            aria-label={t('timeline.clipLabel', {
              number: span.shot.index + 1, start: span.startMs, end: span.endMs,
            })}
            onPointerDown={event => startDrag(span.shot.id, event)}
            className="absolute top-0 z-10 h-10 w-2 -translate-x-1 cursor-col-resize bg-transparent hover:bg-sky-600/40"
            style={{ left: msToPx(scale, span.startMs) }}
          />
        )}
```

Zwróć uwagę, że uchwyt musi być rodzeństwem przycisku wewnątrz kontenera ścieżki, a nie jego dzieckiem — `useDragBoundary` czyta prostokąt z `parentElement`.

Wyodrębnij zawartość mapowania do fragmentu, żeby oba elementy mogły stać obok siebie:

```tsx
        return (
          <Fragment key={span.shot.id}>
            {/* przycisk klipu */}
            {/* uchwyt granicy */}
          </Fragment>
        )
```

Dopisz `Fragment` do importu z Reacta i usuń `key` z przycisku.

- [ ] **Step 5: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web && npm run typecheck`
Expected: PASS, 11 nowych testów

- [ ] **Step 6: Commit**

```bash
cd ~/mmh3-studio
git add web/src/timeline web/test/timeline
git commit -m "feat: przeciaganie granicy ujecia ze snapowaniem do klatek"
```

---

### Task 7: Playhead i odtwarzanie

**Files:**
- Create: `web/src/timeline/Playhead.tsx`
- Create: `web/src/timeline/usePlayback.ts`
- Test: `web/test/timeline/playback.test.tsx`

**Interfaces:**
- Consumes: `usePlayhead`, `Scale`, `msToPx`, `pxToMs`
- Produces:
  - `advancePlayback(currentMs, elapsedMs, durationMs): { ms: number; playing: boolean }` — czysta funkcja kroku
  - `usePlayback(durationMs: number): void` — pętla klatkowa, aktywna tylko gdy odtwarzanie trwa
  - `<Playhead scale={Scale} />`

- [ ] **Step 1: Napisz testy**

`web/test/timeline/playback.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { advancePlayback } from '../../src/timeline/usePlayback.js'
import { Playhead } from '../../src/timeline/Playhead.js'
import { createScale } from '../../src/timeline/scale.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { useLang } from '../../src/i18n/useT.js'

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  usePlayhead.setState({ ms: 0, playing: false })
})

describe('advancePlayback', () => {
  it('przesuwa czas o miniony odcinek', () => {
    expect(advancePlayback(1000, 100, 8000)).toEqual({ ms: 1100, playing: true })
  })

  it('zatrzymuje się na końcu wideo', () => {
    expect(advancePlayback(7950, 100, 8000)).toEqual({ ms: 8000, playing: false })
  })

  it('nie cofa się przy ujemnym odcinku', () => {
    expect(advancePlayback(1000, -50, 8000)).toEqual({ ms: 1000, playing: true })
  })

  it('pojedynczy przeskok dłuższy niż całe wideo kończy odtwarzanie', () => {
    expect(advancePlayback(0, 99999, 8000)).toEqual({ ms: 8000, playing: false })
  })
})

describe('Playhead', () => {
  it('stoi w miejscu odpowiadającym czasowi', () => {
    usePlayhead.setState({ ms: 4000, playing: false })
    render(<Playhead scale={createScale(8000, 800, 1)} />)
    expect(screen.getByRole('presentation', { name: /znacznik odtwarzania/i }).style.left)
      .toBe('400px')
  })

  it('przeciągnięcie przesuwa czas', () => {
    render(<Playhead scale={createScale(8000, 800, 1)} />)
    const handle = screen.getByRole('presentation', { name: /znacznik odtwarzania/i })
    handle.setPointerCapture = () => {}
    handle.releasePointerCapture = () => {}
    handle.parentElement!.getBoundingClientRect = () => ({ left: 0, width: 800 }) as DOMRect
    fireEvent.pointerDown(handle, { clientX: 0, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 200, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 200, pointerId: 1 })
    expect(usePlayhead.getState().ms).toBe(2000)
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- playback`
Expected: FAIL — brak modułów

- [ ] **Step 3: Zaimplementuj krok i pętlę**

`web/src/timeline/usePlayback.ts`:

```ts
import { useEffect, useRef } from 'react'
import { usePlayhead } from '../store/playheadStore.js'

/**
 * Jeden krok odtwarzania. Wydzielony z pętli, żeby dało się go przetestować
 * bez zegarów i bez klatek animacji.
 */
export function advancePlayback(
  currentMs: number,
  elapsedMs: number,
  durationMs: number,
): { ms: number; playing: boolean } {
  const next = currentMs + Math.max(0, elapsedMs)
  if (next >= durationMs) return { ms: durationMs, playing: false }
  return { ms: next, playing: true }
}

export function usePlayback(durationMs: number): void {
  const playing = usePlayhead(state => state.playing)
  const lastFrame = useRef<number | null>(null)

  useEffect(() => {
    if (!playing) {
      lastFrame.current = null
      return
    }

    let handle = 0
    const tick = (now: number) => {
      const previous = lastFrame.current
      lastFrame.current = now
      if (previous !== null) {
        const state = usePlayhead.getState()
        const step = advancePlayback(state.ms, now - previous, durationMs)
        state.setMs(step.ms, durationMs)
        if (!step.playing) {
          state.pause()
          return
        }
      }
      handle = requestAnimationFrame(tick)
    }

    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [playing, durationMs])
}
```

- [ ] **Step 4: Zaimplementuj znacznik**

`web/src/timeline/Playhead.tsx`:

```tsx
import { usePlayhead } from '../store/playheadStore.js'
import { useT } from '../i18n/useT.js'
import { msToPx, pxToMs, type Scale } from './scale.js'

export function Playhead({ scale }: { scale: Scale }) {
  const t = useT()
  const ms = usePlayhead(state => state.ms)
  const setMs = usePlayhead(state => state.setMs)

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const track = event.currentTarget.parentElement
    if (!track) return
    const bounds = track.getBoundingClientRect()
    const target = event.currentTarget

    const move = (moveEvent: PointerEvent) =>
      setMs(pxToMs(scale, moveEvent.clientX - bounds.left), scale.durationMs)

    const finish = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', finish)
      target.removeEventListener('pointercancel', finish)
      try {
        target.releasePointerCapture(event.pointerId)
      } catch {
        // Przechwycenie mogło już zostać zwolnione przez przeglądarkę.
      }
    }

    target.setPointerCapture(event.pointerId)
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', finish)
    target.addEventListener('pointercancel', finish)
  }

  return (
    <div
      role="presentation"
      aria-label={t('timeline.playhead')}
      onPointerDown={startDrag}
      className="absolute bottom-0 top-0 z-20 w-px cursor-col-resize bg-amber-400"
      style={{ left: msToPx(scale, ms) }}
    >
      <span className="absolute -left-1 top-0 h-2 w-2 rounded-sm bg-amber-400" />
    </div>
  )
}
```

- [ ] **Step 5: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web && npm run typecheck`
Expected: PASS, 6 nowych testów

- [ ] **Step 6: Commit**

```bash
cd ~/mmh3-studio
git add web/src/timeline web/test/timeline
git commit -m "feat: playhead z przeciaganiem i petla odtwarzania"
```

---

### Task 8: Kotwice klatek na klipie

Odblokowuje tryby I2VA, FL2VA i L2VA — dziś nie da się w nich osiągnąć stanu gotowości, bo nic w interfejsie nie ustawia `shot.anchors`.

**Files:**
- Create: `web/src/timeline/AnchorBadges.tsx`
- Modify: `web/src/timeline/ShotTrack.tsx`
- Modify: `web/src/i18n/dict.ts`
- Test: `web/test/timeline/anchors.test.tsx`

**Interfaces:**
- Consumes: `useProject`, typ `Anchor` z `@mmh3/shared`
- Produces:
  - `anchorsForMode(mode: Mode): Anchor[]` — które kotwice mają sens w danym trybie
  - `<AnchorBadges shotId={string} anchors={Anchor[]} />`

- [ ] **Step 1: Dodaj klucze słownika**

W `web/src/i18n/dict.ts`, połowa polska:

```ts
  'anchor.picture-first': 'Pierwsza klatka',
  'anchor.picture-last': 'Ostatnia klatka',
  'anchor.keyframe': 'Klatka kluczowa',
  'anchor.toggle': 'Przełącz kotwicę: {name}',
```

angielska:

```ts
  'anchor.picture-first': 'First frame',
  'anchor.picture-last': 'Last frame',
  'anchor.keyframe': 'Keyframe',
  'anchor.toggle': 'Toggle anchor: {name}',
```

- [ ] **Step 2: Napisz testy**

`web/test/timeline/anchors.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@mmh3/shared'
import { anchorsForMode } from '../../src/timeline/AnchorBadges.js'
import { ShotTrack } from '../../src/timeline/ShotTrack.js'
import { createScale } from '../../src/timeline/scale.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useLang } from '../../src/i18n/useT.js'

const shot = (id: string, index: number, startMs: number) => ({
  id, index, startMs, cutType: 'cut' as const, cutPhrase: 'the camera cuts to' as const,
  composition: '', body: [], cameraMoves: [], dialogue: [],
  screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
})

const project = (mode: Project['mode']): Project => ({
  schemaVersion: 1, id: 'p', name: 'Test', mode,
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic',
  assets: [],
  labels: mode === 'T2VA' ? [] : [
    { id: 'pic1', kind: 'picture', index: 1, assetIds: [], definition: '', role: '', standalone: true },
    { id: 'pic2', kind: 'picture', index: 2, assetIds: [], definition: '', role: '', standalone: true },
  ],
  speakers: [],
  shots: [shot('a', 0, 0)],
  audio: { overallSoundscape: 'Rain.', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
})

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useSelection.setState({ selected: [] })
})

describe('anchorsForMode', () => {
  it('tryb tekstowy nie ma kotwic', () => {
    expect(anchorsForMode('T2VA')).toEqual([])
  })

  it('I2VA kotwiczy tylko pierwszą klatkę', () => {
    expect(anchorsForMode('I2VA')).toEqual(['picture-first'])
  })

  it('FL2VA kotwiczy obie klatki', () => {
    expect(anchorsForMode('FL2VA')).toEqual(['picture-first', 'picture-last'])
  })

  it('L2VA kotwiczy tylko ostatnią klatkę', () => {
    expect(anchorsForMode('L2VA')).toEqual(['picture-last'])
  })

  it('tryb pełnoreferencyjny dopuszcza klatkę kluczową', () => {
    expect(anchorsForMode('REF')).toEqual(['keyframe'])
  })
})

describe('kotwice na klipie', () => {
  it('tryb tekstowy nie pokazuje żadnych przełączników', () => {
    useProject.getState().load('test', project('T2VA'))
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    expect(screen.queryByRole('button', { name: /przełącz kotwicę/i })).not.toBeInTheDocument()
  })

  it('ustawienie obu kotwic w FL2VA gasi błąd walidatora', async () => {
    useProject.getState().load('test', project('FL2VA'))
    expect(useProject.getState().diagnostics.map(d => d.ruleId)).toContain('ANCHOR_REQUIRED')

    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    await userEvent.click(screen.getByRole('button', { name: /przełącz kotwicę: pierwsza klatka/i }))
    await userEvent.click(screen.getByRole('button', { name: /przełącz kotwicę: ostatnia klatka/i }))

    expect(useProject.getState().project!.shots[0]!.anchors)
      .toEqual(['picture-first', 'picture-last'])
    expect(useProject.getState().diagnostics.map(d => d.ruleId)).not.toContain('ANCHOR_REQUIRED')
  })

  it('ponowne kliknięcie zdejmuje kotwicę', async () => {
    useProject.getState().load('test', project('I2VA'))
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    const badge = screen.getByRole('button', { name: /przełącz kotwicę: pierwsza klatka/i })
    await userEvent.click(badge)
    await userEvent.click(badge)
    expect(useProject.getState().project!.shots[0]!.anchors).toEqual([])
  })

  it('stan kotwicy jest widoczny dla czytnika ekranu', async () => {
    useProject.getState().load('test', project('I2VA'))
    render(<ShotTrack scale={createScale(8000, 800, 1)} />)
    const badge = screen.getByRole('button', { name: /przełącz kotwicę: pierwsza klatka/i })
    expect(badge).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(badge)
    expect(badge).toHaveAttribute('aria-pressed', 'true')
  })
})
```

- [ ] **Step 3: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- anchors`
Expected: FAIL — brak modułu

- [ ] **Step 4: Zaimplementuj odznaki**

`web/src/timeline/AnchorBadges.tsx`:

```tsx
import type { Anchor, Mode } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { useT } from '../i18n/useT.js'

const BY_MODE: Record<Mode, Anchor[]> = {
  T2VA: [],
  I2VA: ['picture-first'],
  FL2VA: ['picture-first', 'picture-last'],
  L2VA: ['picture-last'],
  REF: ['keyframe'],
}

/** Które kotwice mają sens w danym trybie — reszta byłaby szumem na klipie. */
export const anchorsForMode = (mode: Mode): Anchor[] => BY_MODE[mode]

const LABEL_KEY: Record<Anchor, 'anchor.picture-first' | 'anchor.picture-last' | 'anchor.keyframe'> = {
  'picture-first': 'anchor.picture-first',
  'picture-last': 'anchor.picture-last',
  keyframe: 'anchor.keyframe',
}

export function AnchorBadges({ shotId, anchors }: { shotId: string; anchors: Anchor[] }) {
  const t = useT()
  const mode = useProject(state => state.project?.mode)
  const apply = useProject(state => state.apply)

  if (!mode) return null
  const available = anchorsForMode(mode)
  if (available.length === 0) return null

  const toggle = (anchor: Anchor) => apply(current => ({
    ...current,
    shots: current.shots.map(shot => {
      if (shot.id !== shotId) return shot
      const has = shot.anchors.includes(anchor)
      return {
        ...shot,
        anchors: has
          ? shot.anchors.filter(candidate => candidate !== anchor)
          : [...shot.anchors, anchor],
      }
    }),
  }))

  return (
    <span className="absolute bottom-0 right-1 z-10 flex gap-1">
      {available.map(anchor => {
        const active = anchors.includes(anchor)
        const name = t(LABEL_KEY[anchor])
        return (
          <button
            key={anchor}
            type="button"
            aria-pressed={active}
            aria-label={t('anchor.toggle', { name })}
            title={name}
            onClick={event => {
              event.stopPropagation()
              toggle(anchor)
            }}
            className={`rounded px-1 text-[9px] leading-4 ${
              active ? 'bg-amber-500 text-neutral-950' : 'bg-neutral-800 text-neutral-400'
            }`}
          >
            {anchor === 'picture-last' ? '⇥' : anchor === 'picture-first' ? '⇤' : '◆'}
          </button>
        )
      })}
    </span>
  )
}
```

- [ ] **Step 5: Wstaw odznaki do klipu**

W `web/src/timeline/ShotTrack.tsx` dopisz import i umieść komponent wewnątrz przycisku klipu, na jego końcu:

```tsx
import { AnchorBadges } from './AnchorBadges.js'
```

```tsx
            <AnchorBadges shotId={span.shot.id} anchors={span.shot.anchors} />
```

Przycisk klipu ma już `position: absolute`; odznaki pozycjonują się względem niego, więc dodaj mu klasę `relative` obok pozostałych.

Zagnieżdżenie przycisku w przycisku jest niepoprawne w HTML. Zmień element klipu z `<button>` na `<div role="button" tabIndex={0}>` z obsługą `onKeyDown` dla Entera i spacji:

```tsx
          <div
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={t('timeline.clipLabel', { … })}
            onClick={event => (event.shiftKey ? toggle(ref) : select(ref))}
            onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              select(ref)
            }}
            className="… relative …"
            style={{ … }}
          >
```

Istniejące testy ścieżki szukają klipów przez `getByRole('button', …)`, więc nadal je znajdą — `role="button"` daje tę samą rolę dostępności.

- [ ] **Step 6: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web && npm run typecheck`
Expected: PASS, 9 nowych testów; testy ścieżki i przeciągania z zadań 5 i 6 nadal zielone

- [ ] **Step 7: Commit**

```bash
cd ~/mmh3-studio
git add web/src/timeline web/src/i18n/dict.ts web/test/timeline
git commit -m "feat: kotwice klatek na klipie odblokowuja tryby obrazowe"
```

---

### Task 9: Monitor storyboardu

Karta ujęcia, nad którym stoi playhead. Zamiast budować własny renderer prozy, monitor wycina fragment gotowego promptu przy pomocy mapy tokenów — dzięki temu pokazuje dokładnie to, co pójdzie do modelu.

**Files:**
- Create: `web/src/panels/shotExcerpt.ts`
- Create: `web/src/panels/ProgramMonitor.tsx`
- Modify: `web/src/i18n/dict.ts`
- Test: `web/test/panels/shotExcerpt.test.ts`
- Test: `web/test/panels/programMonitor.test.tsx`

**Interfaces:**
- Consumes: `useProject` (`prompt`, `tokens`), `usePlayhead`, `shotSpans`
- Produces:
  - `shotAtMs(spans: ShotSpan[], ms: number): ShotSpan | undefined`
  - `shotExcerpt(prompt: string, tokens: Token[], shotId: string): string`
  - `<ProgramMonitor />`

- [ ] **Step 1: Dodaj klucze słownika**

Połowa polska:

```ts
  'monitor.title': 'Monitor',
  'monitor.empty': 'Playhead nie stoi nad żadnym ujęciem.',
  'monitor.shot': 'Ujęcie {number}',
```

angielska:

```ts
  'monitor.title': 'Monitor',
  'monitor.empty': 'The playhead is not over any shot.',
  'monitor.shot': 'Shot {number}',
```

- [ ] **Step 2: Napisz testy funkcji czystych**

`web/test/panels/shotExcerpt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { Token } from '@mmh3/shared'
import { shotAtMs, shotExcerpt } from '../../src/panels/shotExcerpt.js'

const span = (id: string, startMs: number, endMs: number) => ({
  shot: { id, index: 0, startMs } as never, startMs, endMs,
})

describe('shotAtMs', () => {
  const spans = [span('a', 0, 3000), span('b', 3000, 8000)]

  it('trafia w ujęcie zawierające czas', () => {
    expect(shotAtMs(spans, 1500)?.shot.id).toBe('a')
    expect(shotAtMs(spans, 5000)?.shot.id).toBe('b')
  })

  it('początek ujęcia należy do niego, nie do poprzedniego', () => {
    expect(shotAtMs(spans, 3000)?.shot.id).toBe('b')
  })

  it('koniec wideo należy do ostatniego ujęcia', () => {
    expect(shotAtMs(spans, 8000)?.shot.id).toBe('b')
  })

  it('zwraca nic dla pustej listy', () => {
    expect(shotAtMs([], 1000)).toBeUndefined()
  })
})

describe('shotExcerpt', () => {
  const prompt = 'nagłówek: [Shot 1] pierwsze ujęcie. [Shot 2] drugie ujęcie.'
  const tokens: Token[] = [
    { start: 10, end: 18, ref: { kind: 'shot', id: 'a' } },
    { start: 37, end: 45, ref: { kind: 'shot', id: 'b' } },
  ]

  it('wycina fragment od nagłówka ujęcia do następnego', () => {
    expect(shotExcerpt(prompt, tokens, 'a')).toBe('[Shot 1] pierwsze ujęcie.')
  })

  it('ostatnie ujęcie sięga końca tekstu', () => {
    expect(shotExcerpt(prompt, tokens, 'b')).toBe('[Shot 2] drugie ujęcie.')
  })

  it('zwraca pusty ciąg, gdy tokenu nie ma', () => {
    expect(shotExcerpt(prompt, tokens, 'nie-ma')).toBe('')
  })

  it('radzi sobie z pustym promptem', () => {
    expect(shotExcerpt('', [], 'a')).toBe('')
  })
})
```

- [ ] **Step 3: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- shotExcerpt`
Expected: FAIL — brak modułu

- [ ] **Step 4: Zaimplementuj funkcje**

`web/src/panels/shotExcerpt.ts`:

```ts
import type { Token } from '@mmh3/shared'
import type { ShotSpan } from '../timeline/spans.js'

/** Playhead na granicy należy do ujęcia, które się w tym miejscu zaczyna. */
export function shotAtMs(spans: ShotSpan[], ms: number): ShotSpan | undefined {
  const hit = spans.find(span => ms >= span.startMs && ms < span.endMs)
  if (hit) return hit
  return spans[spans.length - 1]
}

/**
 * Fragment gotowego promptu należący do ujęcia — od jego nagłówka do nagłówka
 * następnego. Monitor pokazuje wtedy dokładnie tekst, który pójdzie do modelu,
 * zamiast własnej rekonstrukcji, która mogłaby się z nim rozjechać.
 */
export function shotExcerpt(prompt: string, tokens: Token[], shotId: string): string {
  const shotTokens = tokens
    .filter(token => token.ref.kind === 'shot')
    .sort((a, b) => a.start - b.start)
  const position = shotTokens.findIndex(token => token.ref.id === shotId)
  if (position === -1) return ''
  const start = shotTokens[position]!.start
  const end = shotTokens[position + 1]?.start ?? prompt.length
  return prompt.slice(start, end).trim()
}
```

- [ ] **Step 5: Napisz testy monitora**

`web/test/panels/programMonitor.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgramMonitor } from '../../src/panels/ProgramMonitor.js'
import { useProject } from '../../src/store/projectStore.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { useLang } from '../../src/i18n/useT.js'

const shot = (id: string, index: number, startMs: number) => ({
  id, index, startMs, cutType: 'cut' as const, cutPhrase: 'the camera cuts to' as const,
  composition: index === 0 ? 'medium-wide' : 'close-up',
  body: [{ kind: 'text' as const, text: index === 0 ? 'a bakery at dawn.' : 'steam over bread.' }],
  cameraMoves: [], dialogue: [], screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
})

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  usePlayhead.setState({ ms: 0, playing: false })
  useProject.getState().load('test', {
    schemaVersion: 1, id: 'p', name: 'Test', mode: 'T2VA',
    video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
    style: 'Live-action, cinematic', assets: [], labels: [], speakers: [],
    shots: [shot('a', 0, 0), shot('b', 1, 4000)],
    audio: { overallSoundscape: 'Rain.', nonDiegeticMusic: 'N/A' },
    ref: { taskTypes: [], summaryText: '', retention: [] },
  })
})

describe('ProgramMonitor', () => {
  it('pokazuje ujęcie spod playheada', () => {
    render(<ProgramMonitor />)
    expect(screen.getByText(/ujęcie 1/i)).toBeInTheDocument()
    expect(screen.getByText(/a bakery at dawn/)).toBeInTheDocument()
  })

  it('przełącza ujęcie razem z playheadem', () => {
    usePlayhead.setState({ ms: 5000, playing: false })
    render(<ProgramMonitor />)
    expect(screen.getByText(/ujęcie 2/i)).toBeInTheDocument()
    expect(screen.getByText(/steam over bread/)).toBeInTheDocument()
  })

  it('pokazuje kompozycję ujęcia', () => {
    render(<ProgramMonitor />)
    expect(screen.getByText('medium-wide')).toBeInTheDocument()
  })

  it('mówi wprost, gdy nie ma nad czym stać', () => {
    useProject.getState().apply(p => ({ ...p, shots: [] }))
    render(<ProgramMonitor />)
    expect(screen.getByText(/nie stoi nad żadnym ujęciem/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Zaimplementuj monitor**

`web/src/panels/ProgramMonitor.tsx`:

```tsx
import { useProject } from '../store/projectStore.js'
import { usePlayhead } from '../store/playheadStore.js'
import { useT } from '../i18n/useT.js'
import { shotSpans } from '../timeline/spans.js'
import { shotAtMs, shotExcerpt } from './shotExcerpt.js'

export function ProgramMonitor() {
  const t = useT()
  const project = useProject(state => state.project)
  const prompt = useProject(state => state.prompt)
  const tokens = useProject(state => state.tokens)
  const ms = usePlayhead(state => state.ms)

  if (!project) return null

  const span = shotAtMs(shotSpans(project.shots, project.video.durationMs), ms)

  return (
    <section aria-label={t('monitor.title')} className="flex h-full flex-col gap-2 p-3">
      {!span && <p className="text-sm text-neutral-400">{t('monitor.empty')}</p>}
      {span && (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-xs uppercase tracking-wide text-neutral-500">
              {t('monitor.shot', { number: span.shot.index + 1 })}
            </span>
            {span.shot.composition && (
              <span className="text-xs text-neutral-400">{span.shot.composition}</span>
            )}
          </div>
          <p className="overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-neutral-300">
            {shotExcerpt(prompt, tokens, span.shot.id)}
          </p>
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 7: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web && npm run typecheck`
Expected: PASS, 12 nowych testów

- [ ] **Step 8: Commit**

```bash
cd ~/mmh3-studio
git add web/src/panels web/src/i18n/dict.ts web/test/panels
git commit -m "feat: monitor pokazuje fragment promptu spod playheada"
```

---

### Task 10: Skróty klawiszowe

**Files:**
- Create: `web/src/timeline/shotOperations.ts`
- Create: `web/src/timeline/useTimelineShortcuts.ts`
- Test: `web/test/timeline/shotOperations.test.ts`
- Test: `web/test/timeline/shortcuts.test.tsx`

**Interfaces:**
- Consumes: `useProject`, `usePlayhead`, `useSelection`, `snapToFrame`, `MIN_SHOT_MS`
- Produces:
  - `splitAtMs(project: Project, ms: number): Project` — wstawia ujęcie zaczynające się w podanym czasie
  - `removeShots(project: Project, ids: string[]): Project` — nigdy nie usuwa ostatniego ujęcia
  - `useTimelineShortcuts(): void`

Skróty: `Spacja` odtwarzanie, `←`/`→` klatka, `Shift+←`/`Shift+→` sekunda, `Home`/`End` początek i koniec, `S` podział na playheadzie, `Delete` usuwa zaznaczone, `Ctrl+Z` i `Ctrl+Shift+Z` cofanie.

- [ ] **Step 1: Napisz testy operacji**

`web/test/timeline/shotOperations.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { Project } from '@mmh3/shared'
import { removeShots, splitAtMs } from '../../src/timeline/shotOperations.js'

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

describe('splitAtMs', () => {
  it('wstawia ujęcie i przenumerowuje pozostałe', () => {
    const out = splitAtMs(project, 2000)
    expect(out.shots.map(s => [s.index, s.startMs])).toEqual([[0, 0], [1, 2000], [2, 4000]])
  })

  it('nadaje nowemu ujęciu unikalny identyfikator', () => {
    const out = splitAtMs(project, 2000)
    expect(new Set(out.shots.map(s => s.id)).size).toBe(3)
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
})

describe('removeShots', () => {
  it('usuwa wskazane ujęcia i przenumerowuje resztę', () => {
    const out = removeShots(project, ['a'])
    expect(out.shots.map(s => [s.id, s.index, s.startMs])).toEqual([['b', 0, 0]])
  })

  it('nigdy nie usuwa ostatniego ujęcia', () => {
    expect(removeShots(project, ['a', 'b']).shots).toHaveLength(1)
  })

  it('pusta lista nic nie zmienia', () => {
    expect(removeShots(project, []).shots).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- shotOperations`
Expected: FAIL — brak modułu

- [ ] **Step 3: Zaimplementuj operacje**

`web/src/timeline/shotOperations.ts`:

```ts
import { snapToFrame, type Project, type Shot } from '@mmh3/shared'
import { MIN_SHOT_MS } from './useDragBoundary.js'

const renumber = (shots: Shot[]): Shot[] =>
  [...shots]
    .sort((a, b) => a.startMs - b.startMs)
    .map((shot, index) => ({ ...shot, index, startMs: index === 0 ? 0 : shot.startMs }))

/**
 * Wstawia cięcie na playheadzie. Odmawia, gdy nowe ujęcie byłoby krótsze niż
 * minimum albo gdy w tym miejscu cięcie już jest — model nie dopuszcza dwóch
 * ujęć o tym samym czasie.
 */
export function splitAtMs(project: Project, ms: number): Project {
  const at = snapToFrame(ms)
  if (at <= 0 || at >= project.video.durationMs) return project

  const starts = project.shots.map(shot => shot.startMs)
  const tooClose = starts.some(start => Math.abs(start - at) < MIN_SHOT_MS)
  if (tooClose) return project
  if (project.video.durationMs - at < MIN_SHOT_MS) return project

  const shot: Shot = {
    id: `shot-${at}-${project.shots.length + 1}`,
    index: 0,
    startMs: at,
    cutType: 'cut',
    cutPhrase: 'the camera cuts to',
    composition: '',
    body: [],
    cameraMoves: [],
    dialogue: [],
    screenText: [],
    diegeticSfx: [],
    labelRefs: [],
    anchors: [],
  }

  return { ...project, shots: renumber([...project.shots, shot]) }
}

/** Projekt bez ujęć nie skompilowałby się, więc ostatnie zostaje. */
export function removeShots(project: Project, ids: string[]): Project {
  if (ids.length === 0) return project
  const survivors = project.shots.filter(shot => !ids.includes(shot.id))
  if (survivors.length === 0) return project
  return { ...project, shots: renumber(survivors) }
}
```

- [ ] **Step 4: Napisz testy skrótów**

`web/test/timeline/shortcuts.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@mmh3/shared'
import { useTimelineShortcuts } from '../../src/timeline/useTimelineShortcuts.js'
import { useProject } from '../../src/store/projectStore.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { useSelection } from '../../src/store/selectionStore.js'

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

function Harness() {
  useTimelineShortcuts()
  return <input aria-label="pole tekstowe" />
}

beforeEach(() => {
  usePlayhead.setState({ ms: 0, playing: false })
  useSelection.setState({ selected: [] })
  useProject.getState().load('test', project)
})

describe('useTimelineShortcuts', () => {
  it('spacja przełącza odtwarzanie', async () => {
    render(<Harness />)
    await userEvent.keyboard(' ')
    expect(usePlayhead.getState().playing).toBe(true)
  })

  it('strzałki przesuwają o klatkę, z Shiftem o sekundę', async () => {
    render(<Harness />)
    await userEvent.keyboard('{ArrowRight}')
    expect(usePlayhead.getState().ms).toBe(42)
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
    expect(usePlayhead.getState().ms).toBe(1042)
  })

  it('Home i End skaczą na końce', async () => {
    render(<Harness />)
    await userEvent.keyboard('{End}')
    expect(usePlayhead.getState().ms).toBe(8000)
    await userEvent.keyboard('{Home}')
    expect(usePlayhead.getState().ms).toBe(0)
  })

  it('S dzieli ujęcie na playheadzie', async () => {
    usePlayhead.setState({ ms: 2000, playing: false })
    render(<Harness />)
    await userEvent.keyboard('s')
    expect(useProject.getState().project!.shots).toHaveLength(3)
  })

  it('Delete usuwa zaznaczone ujęcie', async () => {
    useSelection.getState().select({ kind: 'shot', id: 'a' })
    render(<Harness />)
    await userEvent.keyboard('{Delete}')
    expect(useProject.getState().project!.shots.map(s => s.id)).toEqual(['b'])
  })

  it('Ctrl+Z cofa, Ctrl+Shift+Z ponawia', async () => {
    usePlayhead.setState({ ms: 2000, playing: false })
    render(<Harness />)
    await userEvent.keyboard('s')
    await userEvent.keyboard('{Control>}z{/Control}')
    expect(useProject.getState().project!.shots).toHaveLength(2)
    await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    expect(useProject.getState().project!.shots).toHaveLength(3)
  })

  it('nie reaguje, gdy użytkownik pisze w polu tekstowym', async () => {
    render(<Harness />)
    const field = document.querySelector('input')!
    field.focus()
    await userEvent.keyboard('s')
    expect(useProject.getState().project!.shots).toHaveLength(2)
    expect(field).toHaveValue('s')
  })
})
```

- [ ] **Step 5: Zaimplementuj skróty**

`web/src/timeline/useTimelineShortcuts.ts`:

```ts
import { useEffect } from 'react'
import { useProject } from '../store/projectStore.js'
import { usePlayhead } from '../store/playheadStore.js'
import { useSelection } from '../store/selectionStore.js'
import { removeShots, splitAtMs } from './shotOperations.js'

const FRAMES_PER_SECOND_STEP = 24

/** Skrót nie może wystrzelić, gdy użytkownik pisze — inaczej „s" dzieliłoby ujęcie. */
const isTyping = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function useTimelineShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return

      const store = useProject.getState()
      const project = store.project
      if (!project) return
      const durationMs = project.video.durationMs
      const playhead = usePlayhead.getState()

      const handled = (): void => {
        event.preventDefault()
        event.stopPropagation()
      }

      if (event.key === ' ') {
        handled()
        playhead.toggle()
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        handled()
        const direction = event.key === 'ArrowRight' ? 1 : -1
        playhead.stepFrames(direction * (event.shiftKey ? FRAMES_PER_SECOND_STEP : 1), durationMs)
        return
      }
      if (event.key === 'Home') {
        handled()
        playhead.setMs(0, durationMs)
        return
      }
      if (event.key === 'End') {
        handled()
        playhead.setMs(durationMs, durationMs)
        return
      }
      if (event.key === 's' || event.key === 'S') {
        handled()
        store.apply(current => splitAtMs(current, usePlayhead.getState().ms))
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const ids = useSelection.getState().selected
          .filter(ref => ref.kind === 'shot')
          .map(ref => ref.id)
        if (ids.length === 0) return
        handled()
        store.apply(current => removeShots(current, ids))
        useSelection.getState().clear()
        return
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z')) {
        handled()
        if (event.shiftKey) store.redo()
        else store.undo()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
```

- [ ] **Step 6: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web && npm run typecheck`
Expected: PASS, 15 nowych testów

- [ ] **Step 7: Commit**

```bash
cd ~/mmh3-studio
git add web/src/timeline web/test/timeline
git commit -m "feat: skroty klawiszowe osi czasu z podzialem i usuwaniem ujec"
```

---

### Task 11: Złożenie osi czasu i wymiana w edytorze

**Files:**
- Create: `web/src/timeline/Timeline.tsx`
- Modify: `web/src/screens/Editor.tsx`
- Modify: `web/src/i18n/dict.ts`
- Delete: `web/src/panels/ShotList.tsx`
- Delete: `web/test/panels/shotList.test.tsx`
- Test: `web/test/timeline/timeline.test.tsx`

**Interfaces:**
- Consumes: `Ruler`, `ShotTrack`, `Playhead`, `usePlayback`, `useTimelineShortcuts`, `ProgramMonitor`, `createScale`, `clampZoom`
- Produces: `<Timeline />` — pasek narzędzi, linijka, ścieżka ujęć i playhead w przewijanym kontenerze

Szerokość osi przy zoomie 1 jest stała i wynosi 900 px; zoom ją mnoży, a kontener przewija. Dzięki temu nic nie mierzy DOM-u, co w jsdom byłoby zgadywaniem.

`ShotList` znika — to była jawnie tymczasowa namiastka, a jej funkcje przejmują klipy na osi, przycisk dodawania w pasku narzędzi i skróty klawiszowe. Usuń komponent razem z jego testem.

- [ ] **Step 1: Dodaj klucze słownika**

Połowa polska:

```ts
  'timeline.addShot': 'Dodaj ujęcie',
  'timeline.shortcuts': 'Spacja odtwarza, S dzieli ujęcie, Delete usuwa zaznaczone',
```

angielska:

```ts
  'timeline.addShot': 'Add shot',
  'timeline.shortcuts': 'Space plays, S splits a shot, Delete removes the selection',
```

- [ ] **Step 2: Napisz testy**

`web/test/timeline/timeline.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@mmh3/shared'
import { Timeline } from '../../src/timeline/Timeline.js'
import { PromptPanel } from '../../src/panels/PromptPanel.js'
import { useProject } from '../../src/store/projectStore.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useLang } from '../../src/i18n/useT.js'

const shot = (id: string, index: number, startMs: number) => ({
  id, index, startMs, cutType: 'cut' as const, cutPhrase: 'the camera cuts to' as const,
  composition: '', body: [], cameraMoves: [], dialogue: [],
  screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
})

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic', assets: [], labels: [], speakers: [],
  shots: [shot('a', 0, 0)],
  audio: { overallSoundscape: 'Rain.', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useSelection.setState({ selected: [] })
  usePlayhead.setState({ ms: 0, playing: false })
  useProject.getState().load('test', project)
})

describe('Timeline', () => {
  it('składa linijkę, ścieżkę ujęć i playhead', () => {
    render(<Timeline />)
    expect(screen.getByRole('slider', { name: /linijka czasu/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ujęcie 1/i })).toBeInTheDocument()
    expect(screen.getByRole('presentation', { name: /znacznik odtwarzania/i })).toBeInTheDocument()
  })

  it('przybliżenie poszerza oś, oddalenie zwęża', async () => {
    render(<Timeline />)
    const ruler = screen.getByRole('slider', { name: /linijka czasu/i })
    expect(ruler.style.width).toBe('900px')
    await userEvent.click(screen.getByRole('button', { name: /przybliż/i }))
    expect(ruler.style.width).toBe('1800px')
    await userEvent.click(screen.getByRole('button', { name: /oddal/i }))
    expect(ruler.style.width).toBe('900px')
  })

  it('dopasowanie wraca do zoomu początkowego', async () => {
    render(<Timeline />)
    await userEvent.click(screen.getByRole('button', { name: /przybliż/i }))
    await userEvent.click(screen.getByRole('button', { name: /dopasuj/i }))
    expect(screen.getByRole('slider', { name: /linijka czasu/i }).style.width).toBe('900px')
  })

  it('przycisk dodawania wstawia ujęcie na playheadzie', async () => {
    usePlayhead.setState({ ms: 4000, playing: false })
    render(<Timeline />)
    await userEvent.click(screen.getByRole('button', { name: /dodaj ujęcie/i }))
    expect(useProject.getState().project!.shots).toHaveLength(2)
  })

  it('zaznaczenie klipu podświetla token tego ujęcia w promptcie', async () => {
    render(
      <>
        <Timeline />
        <PromptPanel />
      </>,
    )
    await userEvent.click(screen.getByRole('button', { name: /ujęcie 1/i }))
    const token = screen.getByRole('button', { name: '[Shot 1]' })
    expect(token).toHaveAttribute('aria-current', 'true')
  })

  it('przycisk odtwarzania zmienia etykietę na zatrzymanie', async () => {
    render(<Timeline />)
    await userEvent.click(screen.getByRole('button', { name: /^odtwarzaj$/i }))
    expect(screen.getByRole('button', { name: /^zatrzymaj$/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- timeline.test`
Expected: FAIL — brak modułu

- [ ] **Step 4: Zaimplementuj złożenie**

`web/src/timeline/Timeline.tsx`:

```tsx
import { useState } from 'react'
import { useProject } from '../store/projectStore.js'
import { usePlayhead } from '../store/playheadStore.js'
import { useT } from '../i18n/useT.js'
import { clampZoom, createScale } from './scale.js'
import { Ruler } from './Ruler.js'
import { ShotTrack } from './ShotTrack.js'
import { Playhead } from './Playhead.js'
import { usePlayback } from './usePlayback.js'
import { splitAtMs } from './shotOperations.js'

/** Szerokość osi przy zoomie 1. Stała, więc nic nie musi mierzyć DOM-u. */
const BASE_WIDTH_PX = 900
const ZOOM_STEP = 2

export function Timeline() {
  const t = useT()
  const project = useProject(state => state.project)
  const apply = useProject(state => state.apply)
  const ms = usePlayhead(state => state.ms)
  const playing = usePlayhead(state => state.playing)
  const toggle = usePlayhead(state => state.toggle)
  const [zoom, setZoom] = useState(1)

  const durationMs = project?.video.durationMs ?? 0
  usePlayback(durationMs)

  if (!project) return null
  const scale = createScale(durationMs, BASE_WIDTH_PX, zoom)

  return (
    <section aria-label={t('timeline.title')} className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-1 text-xs">
        <button
          type="button"
          onClick={toggle}
          className="rounded border border-neutral-700 px-2 py-0.5 hover:border-neutral-500"
        >
          {playing ? t('timeline.pause') : t('timeline.play')}
        </button>
        <span className="font-mono text-neutral-500">{ms} ms</span>
        <button
          type="button"
          onClick={() => apply(current => splitAtMs(current, usePlayhead.getState().ms))}
          className="rounded border border-neutral-700 px-2 py-0.5 hover:border-neutral-500"
        >
          {t('timeline.addShot')}
        </button>
        <span className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => setZoom(current => clampZoom(current / ZOOM_STEP))}
            className="rounded border border-neutral-700 px-2 py-0.5 hover:border-neutral-500"
          >
            {t('timeline.zoomOut')}
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="rounded border border-neutral-700 px-2 py-0.5 hover:border-neutral-500"
          >
            {t('timeline.zoomFit')}
          </button>
          <button
            type="button"
            onClick={() => setZoom(current => clampZoom(current * ZOOM_STEP))}
            className="rounded border border-neutral-700 px-2 py-0.5 hover:border-neutral-500"
          >
            {t('timeline.zoomIn')}
          </button>
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="relative" style={{ width: scale.widthPx * scale.zoom }}>
          <Ruler scale={scale} />
          <ShotTrack scale={scale} />
          <Playhead scale={scale} />
        </div>
      </div>

      <p className="border-t border-neutral-800 px-3 py-1 text-[10px] text-neutral-600">
        {t('timeline.shortcuts')}
      </p>
    </section>
  )
}
```

- [ ] **Step 5: Wymień listę ujęć na oś czasu w edytorze**

W `web/src/screens/Editor.tsx`:

- usuń import i użycie `ShotList`, dopisz `Timeline`, `ProgramMonitor` i `useTimelineShortcuts`;
- wywołaj `useTimelineShortcuts()` obok pozostałych hooków;
- zamień siatkę tak, żeby oś czasu zajęła pas na dole, a monitor stanął obok promptu:

```tsx
      <div className="grid flex-1 grid-cols-[200px_1fr_1fr_280px] overflow-hidden divide-x divide-neutral-800">
        <AssetBin slug={slug} />
        <div className="flex flex-col divide-y divide-neutral-800 overflow-hidden">
          <ProgramMonitor />
          <PromptPanel />
        </div>
        <ValidationPanel />
        <div className="flex flex-col divide-y divide-neutral-800 overflow-auto">
          <Inspector />
          <ExportPanel slug={slug} />
        </div>
      </div>
      <div className="h-48 border-t border-neutral-800">
        <Timeline />
      </div>
```

- [ ] **Step 6: Usuń tymczasową listę ujęć**

```bash
cd ~/mmh3-studio
git rm web/src/panels/ShotList.tsx web/test/panels/shotList.test.tsx
```

- [ ] **Step 7: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test && npm run typecheck`
Expected: PASS — wszystkie testy zielone, w tym pięć złotych; testy `shotList` zniknęły razem z komponentem

- [ ] **Step 8: Commit**

```bash
cd ~/mmh3-studio
git add web docs
git commit -m "feat: os czasu zastepuje tymczasowa liste ujec w edytorze"
```

---

### Task 12: Test end-to-end przez oś czasu

**Files:**
- Modify: `web/e2e/happyPath.spec.ts`

**Interfaces:**
- Consumes: cała aplikacja
- Produces: rozszerzona ścieżka end-to-end obejmująca podział ujęcia i cofnięcie

- [ ] **Step 1: Rozszerz scenariusz**

W `web/e2e/happyPath.spec.ts`, przed blokiem zmiany języka, wstaw pracę na osi czasu:

```ts
  // Oś czasu: jedno ujęcie na start, podział daje drugie, cofnięcie wraca do jednego.
  const clips = page.getByRole('button', { name: /^ujęcie \d/i })
  await expect(clips).toHaveCount(1)

  await page.getByRole('slider', { name: /linijka czasu/i }).click({ position: { x: 450, y: 5 } })
  await page.getByRole('button', { name: /dodaj ujęcie/i }).click()
  await expect(clips).toHaveCount(2)
  await expect(page.getByText(/\[Shot 2\] At 00:0/)).toBeVisible()

  await page.keyboard.press('Control+z')
  await expect(clips).toHaveCount(1)
```

Asercja na `[Shot 2] At 00:0` jest tu istotna: dowodzi, że podział na osi trafił do modelu i przeszedł przez kompilator, a nie tylko narysował drugi prostokąt.

- [ ] **Step 2: Uruchom test trzy razy z rzędu**

Run:

```bash
cd ~/mmh3-studio
npm run e2e && npm run e2e && npm run e2e
```

Expected: `1 passed` za każdym razem. Trzy przebiegi, bo poprzedni plan zamknął defekt polegający na tym, że test przechodził wyłącznie za pierwszym razem — `globalSetup` czyści katalog danych, ale warto to potwierdzić po zmianie scenariusza.

- [ ] **Step 3: Uruchom cały zestaw**

Run: `cd ~/mmh3-studio && npm test && npm run typecheck && npm audit`
Expected: wszystko zielone, brak podatności

- [ ] **Step 4: Commit**

```bash
cd ~/mmh3-studio
git add web/e2e/happyPath.spec.ts
git commit -m "test: sciezka end-to-end obejmuje podzial ujecia na osi czasu"
```

---

## Definicja ukończenia

- `npm test` — wszystkie testy zielone we wszystkich trzech pakietach, w tym pięć złotych odtwarzających dokumentację dostawcy znak w znak
- `npm run typecheck` — czysty; `npm audit` — bez podatności
- `npm run e2e` — przechodzi trzykrotnie z rzędu
- Oś czasu: linijka z sekundami i klatkami, klipy ujęć z zaznaczaniem pojedynczym i wielokrotnym, przeciąganie granic ze snapowaniem do klatki i do sąsiednich cięć, playhead z przeciąganiem i odtwarzaniem, kotwice klatek, monitor pokazujący fragment promptu, skróty klawiszowe
- Tryby I2VA, FL2VA i L2VA da się doprowadzić do stanu gotowości do eksportu — kotwice są ustawialne
- Jeden gest przeciągnięcia zostawia dokładnie jeden wpis w historii cofania
- `shared/` zmienił się wyłącznie w zadaniu 1 i wyłącznie w zakresie schematu ścieżki assetu

## Świadomie poza zakresem tego planu

- **Pozostałe ścieżki osi czasu** — kamera, dialogi per mówca, tekst ekranowy, SFX, soundscape, muzyka i ścieżka referencji zasilająca `retention_analysis`. To Plan 4; ten plan buduje szkielet, na którym one usiądą.
- **Podgląd obrazu w monitorze.** Monitor pokazuje tekst ujęcia, nie kadr z assetu referencyjnego. Wymaga trasy serwującej miniatury, która istnieje na dysku, ale nie ma jeszcze punktu w API.
- **Przeciąganie klipu jako całości** — dziś przesuwa się granice, nie całe ujęcia. Przesunięcie ujęcia to przesunięcie dwóch granic naraz i ma sens dopiero, gdy na osi są też inne ścieżki, które musiałyby jechać razem z nim.
