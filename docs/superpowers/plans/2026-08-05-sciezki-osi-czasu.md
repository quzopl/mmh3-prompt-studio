# Ścieżki osi czasu — plan wdrożenia

> **Dla pracujących agentowo:** WYMAGANA PODUMIEJĘTNOŚĆ: użyj superpowers:subagent-driven-development (zalecane) albo superpowers:executing-plans, żeby wykonać ten plan zadanie po zadaniu. Kroki mają składnię pól wyboru (`- [ ]`).

**Cel:** dołożyć do osi czasu pozostałe ścieżki z §7 specyfikacji — kamerę, dialogi w pasach per mówca, tekst na ekranie, SFX, pejzaż dźwiękowy, muzykę i referencje trybu REF — oraz spłacić dług, który recenzja końcowa Planu 3 zapisała jako warunek dalszej rozbudowy.

**Architektura:** wszystkie nowe ścieżki to warianty jednego pojęcia: klip o czasie początku i końca, rysowany w tej samej skali i przeciągany tym samym gestem. Powstaje więc najpierw wspólny `useDragClip` i wspólne pudełko klipu, a każda ścieżka dokłada tylko to, co ma własnego: skąd bierze klipy, co znaczy ich przesunięcie i czym je ograniczyć. Przed tym trzy zadania spłacają dług, bo bez jednego właściciela porządku ujęć każda nowa ścieżka powiela ten sam rozjazd.

**Stos:** React 19, TypeScript 5 (strict, `noUncheckedIndexedAccess`), Vite 8, Zustand, Tailwind, Vitest 4, Playwright. Monorepo npm workspaces: `shared/` (rdzeń), `server/` (Fastify), `web/` (interfejs).

## Ograniczenia globalne

Wiążą każde zadanie w tym planie, nawet jeśli jego opis o nich nie wspomina.

- Każdy ciąg widoczny dla użytkownika pochodzi z `web/src/i18n/dict.ts` przez `useT()` i ma postać polską **i** angielską. Ciąg wpisany w kod to usterka.
- Komentarze w kodzie i komunikaty commitów po polsku; identyfikatory i typy po angielsku.
- `strict` TypeScript, zero `any`, **zero asercji `!`** — `web/src` ma ich dziś dokładnie zero i ma tak zostać.
- Stała 24 klatek na sekundę pochodzi z `shared/` (`FPS`, `MS_PER_FRAME`, `snapToFrame`), nigdy nie jest wyprowadzana lokalnie.
- Porównania referencji zaznaczenia idą przez `same(a, b)` z `web/src/store/selectionStore.ts`, nigdy przez powtórzone `kind === kind && id === id`.
- Gesty wskaźnika idą wzorem `useDragBoundary`: przeliczanie stanu na żywo wewnątrz `move`, licznik gestów w zakresie **modułu** (nie `useRef` — zeruje się po przemontowaniu i skleja dwa cofnięcia w jedno), `preventDefault` przed decyzją o powtórzeniu.
- Kontrolka, która obsługuje klawisz, zatrzymuje jego propagację — inaczej trafi jeszcze do globalnego `useTimelineShortcuts` i wykona drugą akcję.
- YAGNI: eksport, prop ani opcja bez konsumenta w tym samym zadaniu to usterka.
- Test, który przeszedłby na zaślepce, to usterka. Każdy test musi najpierw zostać zobaczony jako czerwony z właściwego powodu.
- W testach jsdom: `PointerEvent` nie istnieje, więc gesty idą przez `firePointer` z `web/test/timeline/pointer.ts`; `setPointerCapture` i `releasePointerCapture` podmienia się na puste funkcje; `ResizeObserver` i `requestAnimationFrame` wymagają podstawienia (wzory w `web/test/timeline/timeline.test.tsx` i `playback.test.tsx`).

## Struktura plików

Nowe pliki w `web/src/timeline/`:

| Plik | Odpowiedzialność |
|---|---|
| `normalize.ts` | jedyny właściciel porządku ujęć — sortowanie, numeracja, przyciąganie do klatki |
| `clips.ts` | `TimeClip`, `clipBox`, wspólna geometria klipu |
| `useDragClip.ts` | jeden gest dla przesunięcia klipu i obu jego krawędzi |
| `CameraTrack.tsx` | ruchy kamery wewnątrz ujęć |
| `DialogueTracks.tsx` | pas na mówcę |
| `speech.ts` | naturalna długość kwestii z liczby słów i tempa |
| `proposals.ts` | propozycje `<scenetrans>` i `<cutoff>` wynikające z geometrii |
| `ScreenTextTrack.tsx` | tekst na ekranie |
| `SfxTrack.tsx` | dźwięki diegetyczne |
| `AudioBedTracks.tsx` | pejzaż dźwiękowy i muzyka — po jednym klipie na całość |
| `ReferencesTrack.tsx` | występowanie etykiet w ujęciach (tryb REF) |
| `TrackStack.tsx` | kolumna nagłówków, zwijanie, wspólne przewijanie poziome |

Zmieniane: `scale.ts`, `ShotTrack.tsx`, `shotOperations.ts`, `useDragBoundary.ts`, `Timeline.tsx`, `web/src/panels/Inspector.tsx`, `web/src/i18n/dict.ts`, `shared/src/model/schema.ts`, `server/src/storage/projectStore.ts`.

---

### Task 1: Jeden właściciel porządku ujęć

Recenzja końcowa Planu 3 (punkt 14 w `docs/superpowers/specs/2026-08-04-uwagi-do-planu-2.md`) wykazała trzy sposoby liczenia „kolejności ujęć": `renumber` sortuje po `startMs`, a `shotSpans` i domknięcie `removeShots` po `index`. Zgadzają się tylko dopóki niezmiennik trzyma, a `useDragBoundary` pisze `startMs` i nigdy nie woła `renumber`. Każda ścieżka dokładana w tym planie czyta ujęcia, więc rozjazd trzeba zamknąć zanim powstanie czwarty czytelnik.

**Files:**
- Create: `web/src/timeline/normalize.ts`
- Modify: `web/src/timeline/shotOperations.ts`
- Modify: `web/src/timeline/useDragBoundary.ts`
- Modify: `web/src/panels/Inspector.tsx`
- Test: `web/test/timeline/normalize.test.ts`

**Interfaces:**
- Consumes: `Shot`, `snapToFrame` z `@mmh3/shared`
- Produces:
  - `normalizeShots(shots: Shot[], durationMs: number): Shot[]` — jedyna droga, którą wolno zapisać listę ujęć

- [ ] **Krok 1: Napisz test**

`web/test/timeline/normalize.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MS_PER_FRAME, type Shot } from '@mmh3/shared'
import { normalizeShots } from '../../src/timeline/normalize.js'

const shot = (id: string, index: number, startMs: number): Shot => ({
  id, index, startMs,
  cutType: 'cut', cutPhrase: 'the camera cuts to', composition: '',
  body: [], cameraMoves: [], dialogue: [], screenText: [], diegeticSfx: [],
  labelRefs: [], anchors: [],
})

describe('normalizeShots', () => {
  it('numeruje po czasie, a nie po dotychczasowym indeksie', () => {
    const result = normalizeShots([shot('a', 0, 6000), shot('b', 1, 2000)], 8000)
    expect(result.map(s => s.id)).toEqual(['b', 'a'])
    expect(result.map(s => s.index)).toEqual([0, 1])
  })

  it('pierwsze ujęcie zawsze zaczyna się od zera', () => {
    const result = normalizeShots([shot('a', 0, 500)], 8000)
    expect(result[0]?.startMs).toBe(0)
  })

  it('przyciąga każdy czas do siatki klatek', () => {
    const result = normalizeShots([shot('a', 0, 0), shot('b', 1, 2010)], 8000)
    expect(result[1]?.startMs).toBe(Math.round(Math.round(2010 / MS_PER_FRAME) * MS_PER_FRAME))
  })

  it('rozsuwa ujęcia, które po przyciągnięciu wypadły na tej samej klatce', () => {
    const result = normalizeShots([shot('a', 0, 0), shot('b', 1, 4000), shot('c', 2, 4001)], 8000)
    const starts = result.map(s => s.startMs)
    expect(new Set(starts).size).toBe(3)
    expect(starts[2]).toBeGreaterThan(starts[1] ?? 0)
  })

  it('nie wypuszcza ujęcia poza materiał', () => {
    const result = normalizeShots([shot('a', 0, 0), shot('b', 1, 99999)], 8000)
    expect(result[1]?.startMs).toBeLessThan(8000)
  })

  it('pustej listy nie psuje', () => {
    expect(normalizeShots([], 8000)).toEqual([])
  })
})
```

- [ ] **Krok 2: Uruchom test i zobacz czerwony**

Run: `npm test --workspace @mmh3/web -- normalize`
Expected: FAIL, „Failed to resolve import … normalize.js".

- [ ] **Krok 3: Napisz `normalize.ts`**

```ts
import { MS_PER_FRAME, snapToFrame, type Shot } from '@mmh3/shared'

/** Najkrótsze dopuszczalne ujęcie w klatkach — ta sama wartość co w `useDragBoundary`. */
const MIN_SHOT_FRAMES = 2

const frameIndexOf = (ms: number): number => Math.round(ms / MS_PER_FRAME)
const msOfFrameIndex = (frame: number): number => Math.round(frame * MS_PER_FRAME)

/**
 * Jedyna droga zapisu listy ujęć. Wymusza cztery niezmienniki naraz, bo trzymają
 * się albo wszystkie, albo żaden: pierwsze ujęcie zaczyna się od zera, kolejność
 * `index` zgadza się z kolejnością `startMs`, każdy czas leży na klatce, a dwa
 * ujęcia nigdy nie dzielą tej samej klatki.
 *
 * Ostatni warunek nie jest ozdobą. Przyciąganie do klatki potrafi zetknąć dwa
 * czasy, które w modelu różniły się o milisekundę, a wtedy `shotSpans` daje
 * ujęcie o zerowej długości — nie do chwycenia i nie do naprawienia myszą.
 * Rozsuwanie w prawo o jedną klatkę jest tu tańsze niż odmowa, bo odmowa
 * zostawiłaby użytkownika z modelem, którego nie da się doprowadzić do porządku.
 */
export function normalizeShots(shots: Shot[], durationMs: number): Shot[] {
  const lastFrame = frameIndexOf(durationMs) - MIN_SHOT_FRAMES
  const ordered = [...shots].sort((a, b) => a.startMs - b.startMs)

  let previousFrame = -1
  return ordered.map((shot, index) => {
    if (index === 0) {
      previousFrame = 0
      return { ...shot, index, startMs: 0 }
    }
    const wanted = frameIndexOf(snapToFrame(shot.startMs))
    const frame = Math.min(lastFrame, Math.max(previousFrame + 1, wanted))
    previousFrame = frame
    return { ...shot, index, startMs: msOfFrameIndex(frame) }
  })
}
```

- [ ] **Krok 4: Uruchom test i zobacz zielony**

Run: `npm test --workspace @mmh3/web -- normalize`
Expected: PASS, 6 testów.

- [ ] **Krok 5: Przepuść przez normalizację każdego pisarza**

W `web/src/timeline/shotOperations.ts` usuń lokalne `renumber` i użyj `normalizeShots`. Funkcja `renumber` nie przyjmowała `durationMs`, więc podpis obu operacji już go ma — `splitAtMs(project, ms)` i `removeShots(project, ids)` czytają `project.video.durationMs`.

Zamień oba `return { ...project, shots: renumber(...) }` na `normalizeShots(..., project.video.durationMs)` i skasuj definicję `renumber` wraz z jej importem, jeśli został osierocony.

W `web/src/timeline/useDragBoundary.ts`, w recepcie przekazywanej do `apply`, zamień mapowanie po `shot.id` na normalizację całej listy po podmianie:

```ts
      useProject.getState().apply(
        candidate => ({
          ...candidate,
          shots: normalizeShots(
            candidate.shots.map(shot => shot.id === shotId ? { ...shot, startMs } : shot),
            candidate.video.durationMs,
          ),
        }),
        { coalesceKey },
      )
```

W `web/src/panels/Inspector.tsx` funkcja zapisująca czas cięcia robi dziś to samo mapowanie — przepuść jej wynik przez `normalizeShots` tym samym wzorem. Nie zmieniaj polityki zatwierdzania na blur i Enter; ona została rozstrzygnięta w recenzji końcowej Planu 3 i zostaje.

- [ ] **Krok 6: Dopisz test, że przeciągnięcie utrzymuje porządek**

W `web/test/timeline/dragBoundary.test.tsx` dopisz:

```ts
  it('przeciągnięcie granicy za sąsiada nie rozjeżdża indeksów z czasami', () => {
    setProject(projectWithShots([
      { id: 'a', startMs: 0 }, { id: 'b', startMs: 2000 }, { id: 'c', startMs: 6000 },
    ]))
    const { container } = render(<ShotTrack scale={scale} />)
    const handle = handleFor(container, 'b')
    handle.setPointerCapture = () => {}
    handle.releasePointerCapture = () => {}

    firePointer(handle, 'pointerdown', 200)
    firePointer(handle, 'pointermove', 780)
    firePointer(handle, 'pointerup', 780)

    const shots = useProject.getState().project?.shots ?? []
    const byIndex = [...shots].sort((x, y) => x.index - y.index).map(s => s.startMs)
    expect(byIndex).toEqual([...byIndex].sort((x, y) => x - y))
  })
```

Podpatrz w tym pliku, jak nazywają się już istniejące pomocniki (`setProject`, `projectWithShots`, `handleFor` albo ich odpowiedniki) i użyj tych, które tam są, zamiast wprowadzać nowe.

- [ ] **Krok 7: Uruchom całość**

Run: `npm test && npm run typecheck`
Expected: wszystko zielone. Jeśli test spoza tego zadania zmienił kolor, zatrzymaj się i zgłoś — to znaczy, że któryś konsument liczył na stary porządek.

- [ ] **Krok 8: Commit**

```bash
git add web/src/timeline/normalize.ts web/src/timeline/shotOperations.ts web/src/timeline/useDragBoundary.ts web/src/panels/Inspector.tsx web/test/timeline/normalize.test.ts web/test/timeline/dragBoundary.test.tsx
git commit -m "feat: jedna normalizacja ujec zamiast trzech pojec o ich kolejnosci"
```

---

### Task 2: Unikalność identyfikatorów w schemacie i naprawa przy odczycie

Recenzja końcowa zamknęła krytyczną usterkę duplikowanych `shot.id` po stronie aplikacji, ale `ProjectSchema` nadal przyjmuje projekt z dwoma takimi samymi identyfikatorami (punkt 15 długu). Ręcznie zredagowany `project.json` albo łatka od modelu wnosi wtedy stan, w którym jedno przeciągnięcie niszczy czas cięcia drugiego ujęcia. Samo zaostrzenie schematu odrzuciłoby takie pliki kodem 400 i użytkownik nie miałby czym ich otworzyć, więc zaostrzeniu musi towarzyszyć naprawa przy odczycie.

**Files:**
- Modify: `shared/src/model/schema.ts`
- Modify: `server/src/storage/projectStore.ts`
- Test: `shared/test/model/uniqueIds.test.ts`
- Test: `server/test/storage/repairIds.test.ts`

**Interfaces:**
- Produces: `repairDuplicateIds(raw: unknown): unknown` w `server/src/storage/projectStore.ts` (nieeksportowane poza moduł, testowane przez `readProject`)

- [ ] **Krok 1: Napisz test schematu**

`shared/test/model/uniqueIds.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ProjectSchema } from '../../src/model/schema.js'
import { newProject } from '../fixtures/newProject.js'

describe('ProjectSchema — unikalność identyfikatorów', () => {
  it('odrzuca dwa ujęcia o tym samym id', () => {
    const project = newProject()
    const first = project.shots[0]
    if (!first) throw new Error('fixture bez ujęć')
    const result = ProjectSchema.safeParse({
      ...project,
      shots: [first, { ...first, startMs: 4000 }],
    })
    expect(result.success).toBe(false)
  })

  it('odrzuca dwie etykiety o tym samym id', () => {
    const project = newProject()
    const label = { id: 'l1', kind: 'subject' as const, index: 1, assetIds: [], definition: 'x', role: 'y', standalone: false }
    const result = ProjectSchema.safeParse({ ...project, labels: [label, { ...label, index: 2 }] })
    expect(result.success).toBe(false)
  })

  it('przyjmuje projekt o różnych identyfikatorach', () => {
    expect(ProjectSchema.safeParse(newProject()).success).toBe(true)
  })
})
```

Sprawdź, czy `shared/test/fixtures/newProject.ts` istnieje pod tą nazwą; jeśli fixture nazywa się inaczej, użyj istniejącego zamiast tworzyć drugi.

- [ ] **Krok 2: Uruchom i zobacz czerwony**

Run: `npm test --workspace @mmh3/shared -- uniqueIds`
Expected: FAIL — dwa pierwsze testy przechodzą walidację, choć nie powinny.

- [ ] **Krok 3: Zaostrz schemat**

W `shared/src/model/schema.ts`, przy definicji `ProjectSchema`, dopisz kontrolę na końcu:

```ts
const hasDuplicate = (ids: string[]): boolean => new Set(ids).size !== ids.length

/**
 * Identyfikatory muszą być unikalne w obrębie swojej rodziny, bo cały interfejs
 * adresuje obiekty po nich: zaznaczenie, przeciąganie granicy, przełączanie
 * kotwicy. Przy duplikacie gest wymierzony w jeden obiekt trafia we wszystkie
 * o tym samym identyfikatorze — zmierzone w recenzji Planu 3: jedno
 * przeciągnięcie zeruje długość drugiego ujęcia.
 */
export const ProjectSchema = ProjectShapeSchema.superRefine((project, ctx) => {
  const families: Array<[string, string[]]> = [
    ['shots', project.shots.map(s => s.id)],
    ['labels', project.labels.map(l => l.id)],
    ['speakers', project.speakers.map(s => s.id)],
    ['assets', project.assets.map(a => a.id)],
  ]
  for (const [path, ids] of families) {
    if (hasDuplicate(ids)) {
      ctx.addIssue({ code: 'custom', path: [path], message: `powtórzony identyfikator w ${path}` })
    }
  }
})
```

Nazwij dotychczasowy obiekt `ProjectShapeSchema` i zostaw go wyeksportowanego, jeśli coś już go importuje pod starą nazwą; w przeciwnym razie trzymaj go lokalnie. Sprawdź `git grep 'ProjectSchema'` przed zmianą nazwy — `server/` i `web/` z niego korzystają, a `superRefine` zwraca `ZodEffects`, więc miejsca wołające `.extend()` albo `.partial()` na tym obiekcie przestaną się kompilować i muszą sięgnąć po `ProjectShapeSchema`.

- [ ] **Krok 4: Uruchom i zobacz zielony**

Run: `npm test --workspace @mmh3/shared -- uniqueIds`
Expected: PASS, 3 testy.

- [ ] **Krok 5: Napisz test naprawy przy odczycie**

`server/test/storage/repairIds.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readProject } from '../../src/storage/projectStore.js'
import { newProject } from '../fixtures/newProject.js'

let root = ''

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mmh3-repair-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('readProject naprawia powtórzone identyfikatory', () => {
  it('otwiera projekt z dwoma ujęciami o tym samym id i nadaje drugiemu nowe', async () => {
    const project = newProject()
    const first = project.shots[0]
    if (!first) throw new Error('fixture bez ujęć')
    const dir = join(root, 'zepsuty')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'project.json'),
      JSON.stringify({ ...project, shots: [first, { ...first, startMs: 4000 }] }),
    )

    const loaded = await readProject(root, 'zepsuty')

    expect(loaded.shots).toHaveLength(2)
    expect(new Set(loaded.shots.map(s => s.id)).size).toBe(2)
    expect(loaded.shots[0]?.id).toBe(first.id)
  })
})
```

Dopasuj podpis `readProject` do istniejącego w `server/src/storage/projectStore.ts` — jeśli bierze korzeń z konfiguracji zamiast z argumentu, ustaw korzeń tak, jak robią to sąsiednie testy w `server/test/storage/`.

- [ ] **Krok 6: Uruchom i zobacz czerwony**

Run: `npm test --workspace @mmh3/server -- repairIds`
Expected: FAIL — odczyt rzuca błędem walidacji zamiast naprawić plik.

- [ ] **Krok 7: Napraw przy odczycie**

W `server/src/storage/projectStore.ts`, przed walidacją schematem:

```ts
/**
 * Projekt sprzed zaostrzenia schematu mógł mieć powtórzone identyfikatory —
 * do Planu 4 `splitAtMs` numerował po liczbie ujęć, więc identyfikator wracał
 * po usunięciu. Odrzucenie takiego pliku zostawiłoby użytkownika bez sposobu
 * na jego otwarcie, więc pierwszy z duplikatów zachowuje swój identyfikator,
 * a każdy następny dostaje nowy z sufiksem. Naprawa działa na surowym JSON-ie,
 * bo dzieje się przed walidacją.
 */
function repairDuplicateIds(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw
  const project = raw as Record<string, unknown>
  const repaired: Record<string, unknown> = { ...project }

  for (const family of ['shots', 'labels', 'speakers', 'assets']) {
    const list = project[family]
    if (!Array.isArray(list)) continue
    const seen = new Set<string>()
    repaired[family] = list.map(entry => {
      if (typeof entry !== 'object' || entry === null) return entry
      const record = entry as Record<string, unknown>
      const id = record['id']
      if (typeof id !== 'string') return entry
      if (!seen.has(id)) { seen.add(id); return entry }
      let candidate = id
      let suffix = 2
      while (seen.has(candidate)) { candidate = `${id}-dup${suffix}`; suffix += 1 }
      seen.add(candidate)
      return { ...record, id: candidate }
    })
  }
  return repaired
}
```

Wstaw wywołanie tak, żeby wynik `JSON.parse` szedł przez `repairDuplicateIds` przed `ProjectSchema.parse`. Nie zapisuj naprawionego pliku z powrotem na dysk w tym kroku — zapis nastąpi przy pierwszej edycji przez istniejącą ścieżkę zapisu, a odczyt ma pozostać bez skutków ubocznych.

- [ ] **Krok 8: Uruchom i zobacz zielony**

Run: `npm test --workspace @mmh3/server -- repairIds`
Expected: PASS.

- [ ] **Krok 9: Uruchom całość**

Run: `npm test && npm run typecheck`
Expected: zielone. Zwróć uwagę na `web/` — zmiana typu `ProjectSchema` na `ZodEffects` może wywrócić miejsca wołające metody dostępne tylko na obiekcie.

- [ ] **Krok 10: Commit**

```bash
git add shared/src/model/schema.ts server/src/storage/projectStore.ts shared/test/model/uniqueIds.test.ts server/test/storage/repairIds.test.ts
git commit -m "feat: schemat wymaga unikalnych id, odczyt naprawia stare pliki"
```

---

### Task 3: Zoom poniżej jedności i rzedzenie etykiet sekund

`MIN_ZOOM = 1` sprawia, że oś czasu nigdy nie jest węższa niż 900 px, więc „Dopasuj" nie dopasowuje się w kontenerze węższym — okno na pół ekranu, tablet. Obniżenie progu wymaga jednak progu gęstości dla etykiet sekund, bo `secondTicks` emituje dziś jedną kreskę na sekundę niezależnie od skali, podczas gdy `frameTicks` ma już `MIN_FRAME_GAP_PX`.

**Files:**
- Modify: `web/src/timeline/scale.ts`
- Test: `web/test/timeline/scale.test.ts`

**Interfaces:**
- Produces: `secondTicks` zwraca teraz co drugą albo co piątą sekundę, gdy odstęp spadnie poniżej progu; `MIN_ZOOM` obniżone do `0.25`

- [ ] **Krok 1: Napisz test**

Dopisz do `web/test/timeline/scale.test.ts`:

```ts
  it('pozwala zejść poniżej jedności, bo inaczej Dopasuj nie zmieści się w wąskim oknie', () => {
    expect(clampZoom(0.4)).toBe(0.4)
    expect(clampZoom(0.01)).toBe(MIN_ZOOM)
    expect(MIN_ZOOM).toBeLessThan(1)
  })

  it('rzedzi etykiety sekund, gdy zaczynają na siebie nachodzić', () => {
    const wide = createScale(15000, 900, 1)
    const narrow = createScale(15000, 900, 0.25)
    expect(secondTicks(wide)).toHaveLength(16)
    const thinned = secondTicks(narrow)
    expect(thinned.length).toBeLessThan(16)
    expect(thinned[0]).toBe(0)
    expect(thinned[thinned.length - 1]).toBe(15000)
  })

  it('rzedzenie zachowuje stały krok, a nie przypadkowe kreski', () => {
    const narrow = createScale(15000, 900, 0.25)
    const ticks = secondTicks(narrow).filter(ms => ms !== 15000)
    const steps = ticks.slice(1).map((ms, i) => ms - (ticks[i] ?? 0))
    expect(new Set(steps).size).toBe(1)
  })
```

Dopisz `MIN_ZOOM` i `secondTicks` do importów tego pliku, jeśli ich tam nie ma.

- [ ] **Krok 2: Uruchom i zobacz czerwony**

Run: `npm test --workspace @mmh3/web -- scale`
Expected: FAIL — `clampZoom(0.4)` daje 1, a `secondTicks` zwraca 16 kresek w obu skalach.

- [ ] **Krok 3: Zmień `scale.ts`**

```ts
export const MIN_ZOOM = 0.25
```

oraz:

```ts
/**
 * Poniżej tego odstępu etykiety sekund zaczynają na siebie nachodzić. Etykieta
 * ma trzy znaki („15s") w foncie 10 px, czyli około 18 px, plus 4 px odsunięcia
 * od kreski.
 */
const MIN_SECOND_GAP_PX = 24

/** Kroki rzedzenia w sekundach. Stały krok czyta się lepiej niż nierówne odstępy. */
const SECOND_STEPS = [1, 2, 5, 10]

export function secondTicks(scale: Scale): number[] {
  const step = SECOND_STEPS.find(seconds => msToPx(scale, seconds * 1000) >= MIN_SECOND_GAP_PX)
    ?? SECOND_STEPS[SECOND_STEPS.length - 1]
    ?? 1

  const ticks: number[] = []
  for (let ms = 0; ms <= scale.durationMs; ms += step * 1000) ticks.push(ms)
  const last = ticks[ticks.length - 1]
  if (last !== undefined && last !== scale.durationMs) ticks.push(scale.durationMs)
  return ticks
}
```

- [ ] **Krok 4: Uruchom i zobacz zielony**

Run: `npm test --workspace @mmh3/web -- scale`
Expected: PASS.

- [ ] **Krok 5: Sprawdź, czy linijka nadal zna swoje kreski**

Run: `npm test --workspace @mmh3/web -- ruler timeline`
Expected: PASS. Test linijki liczy etykiety sekund przy zoomie 1, gdzie krok pozostaje jednosekundowy, więc nie powinien zmienić koloru. Jeśli zmienił — zatrzymaj się i zgłoś, zamiast dopasowywać liczbę w teście.

- [ ] **Krok 6: Uruchom całość i commit**

```bash
npm test && npm run typecheck
git add web/src/timeline/scale.ts web/test/timeline/scale.test.ts
git commit -m "feat: zoom ponizej jednosci z rzedzeniem etykiet sekund"
```

---

### Task 4: Wspólny klip czasowy i jeden gest przeciągania

Kamera, dialog i SFX to trzy razy to samo pojęcie: prostokąt o czasie początku i końca, który wolno przesunąć w całości albo złapać za krawędź. Bez wspólnego gestu powstałyby trzy kopie logiki przechwytywania wskaźnika, przyciągania do klatki i sklejania historii — a każda z nich miałaby własny zestaw błędów, jak pokazał Plan 3 na jednym tylko przeciąganiu granicy.

**Files:**
- Create: `web/src/timeline/clips.ts`
- Create: `web/src/timeline/useDragClip.ts`
- Modify: `web/src/timeline/ShotTrack.tsx`
- Test: `web/test/timeline/clips.test.ts`
- Test: `web/test/timeline/dragClip.test.tsx`

**Interfaces:**
- Consumes: `Scale`, `msToPx`, `pxToMs`, `snapMs` ze `scale.ts`; `snapToFrame`, `MS_PER_FRAME` z `@mmh3/shared`; `useProject`
- Produces:
  - `interface TimeClip { id: string; startMs: number; endMs: number }`
  - `clipBox(scale: Scale, clip: TimeClip): { left: number; width: number }` — przeniesione z `ShotTrack.tsx`, uogólnione
  - `type ClipGrip = 'move' | 'start' | 'end'`
  - `clipTargetMs(args: ClipTargetArgs): { startMs: number; endMs: number }`
  - `useDragClip(scale: Scale, options: DragClipOptions): (clipId: string, grip: ClipGrip, event: React.PointerEvent<HTMLElement>) => void`

- [ ] **Krok 1: Napisz test czystej geometrii**

`web/test/timeline/clips.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MS_PER_FRAME } from '@mmh3/shared'
import { createScale } from '../../src/timeline/scale.js'
import { MIN_CLIP_MS, clipBox, clipTargetMs } from '../../src/timeline/clips.js'

const scale = createScale(8000, 800, 1)

describe('clipBox', () => {
  it('przelicza czasy na piksele', () => {
    expect(clipBox(scale, { id: 'a', startMs: 2000, endMs: 4000 })).toEqual({ left: 200, width: 200 })
  })

  it('trzyma klip przy krawędzi, gdy wyszedł poza materiał', () => {
    const box = clipBox(scale, { id: 'a', startMs: 9000, endMs: 12000 })
    expect(box.left).toBeLessThanOrEqual(800)
    expect(box.width).toBeGreaterThanOrEqual(8)
  })
})

describe('clipTargetMs', () => {
  const bounds = { lowestMs: 0, highestMs: 8000 }

  it('przesuwa cały klip zachowując długość', () => {
    const result = clipTargetMs({
      grip: 'move', clip: { id: 'a', startMs: 2000, endMs: 3000 },
      desiredMs: 5000, grabOffsetMs: 0, snapPoints: [], toleranceMs: 0, ...bounds,
    })
    expect(result.endMs - result.startMs).toBe(1000)
    expect(result.startMs).toBe(5000)
  })

  it('przesunięcie w całości nie wychodzi poza ograniczenia', () => {
    const result = clipTargetMs({
      grip: 'move', clip: { id: 'a', startMs: 2000, endMs: 3000 },
      desiredMs: 7800, grabOffsetMs: 0, snapPoints: [], toleranceMs: 0, ...bounds,
    })
    expect(result.endMs).toBe(8000)
    expect(result.endMs - result.startMs).toBe(1000)
  })

  it('krawędź początkowa nie przechodzi przez koniec', () => {
    const result = clipTargetMs({
      grip: 'start', clip: { id: 'a', startMs: 2000, endMs: 3000 },
      desiredMs: 5000, grabOffsetMs: 0, snapPoints: [], toleranceMs: 0, ...bounds,
    })
    expect(result.startMs).toBeLessThan(result.endMs)
    expect(result.endMs - result.startMs).toBeGreaterThanOrEqual(MIN_CLIP_MS)
  })

  it('krawędź końcowa nie przechodzi przez początek', () => {
    const result = clipTargetMs({
      grip: 'end', clip: { id: 'a', startMs: 2000, endMs: 3000 },
      desiredMs: 100, grabOffsetMs: 0, snapPoints: [], toleranceMs: 0, ...bounds,
    })
    expect(result.startMs).toBe(2000)
    expect(result.endMs - result.startMs).toBeGreaterThanOrEqual(MIN_CLIP_MS)
  })

  it('oba czasy leżą na siatce klatek', () => {
    const result = clipTargetMs({
      grip: 'end', clip: { id: 'a', startMs: 0, endMs: 1000 },
      desiredMs: 2010, grabOffsetMs: 0, snapPoints: [], toleranceMs: 0, ...bounds,
    })
    for (const ms of [result.startMs, result.endMs]) {
      expect(ms).toBe(Math.round(Math.round(ms / MS_PER_FRAME) * MS_PER_FRAME))
    }
  })

  it('przyciąga do podanego punktu w zasięgu tolerancji', () => {
    const result = clipTargetMs({
      grip: 'end', clip: { id: 'a', startMs: 0, endMs: 1000 },
      desiredMs: 3960, grabOffsetMs: 0, snapPoints: [4000], toleranceMs: 100, ...bounds,
    })
    expect(result.endMs).toBe(4000)
  })
})
```

- [ ] **Krok 2: Uruchom i zobacz czerwony**

Run: `npm test --workspace @mmh3/web -- clips`
Expected: FAIL, „Failed to resolve import … clips.js".

- [ ] **Krok 3: Napisz `clips.ts`**

```ts
import { MS_PER_FRAME, snapToFrame } from '@mmh3/shared'
import { msToPx, snapMs, type Scale } from './scale.js'

export interface TimeClip {
  id: string
  startMs: number
  endMs: number
}

export type ClipGrip = 'move' | 'start' | 'end'

/** Najwęższy klip, jaki da się jeszcze chwycić myszą. */
export const MIN_CLIP_PX = 8

const frameIndexOf = (ms: number): number => Math.round(ms / MS_PER_FRAME)
const msOfFrameIndex = (frame: number): number => Math.round(frame * MS_PER_FRAME)

/** Najkrótszy klip w klatkach — poniżej dwóch klatek krawędzie zlewają się po przyciągnięciu. */
const MIN_CLIP_FRAMES = 2

export const MIN_CLIP_MS = msOfFrameIndex(MIN_CLIP_FRAMES)

/**
 * Prostokąt klipu przycięty do widocznego obszaru. Klip wykraczający poza
 * materiał jest błędem, który walidator zgłasza — ale narysowany poza ekranem
 * byłby nie do chwycenia, więc jedyny klip wymagający naprawy byłby jedynym
 * nieosiągalnym. Przypinamy go do krawędzi zamiast gubić.
 */
export function clipBox(scale: Scale, clip: TimeClip): { left: number; width: number } {
  const edge = msToPx(scale, scale.durationMs)
  const left = Math.min(msToPx(scale, clip.startMs), edge - MIN_CLIP_PX)
  const right = Math.min(msToPx(scale, clip.endMs), edge)
  return { left: Math.max(0, left), width: Math.max(MIN_CLIP_PX, right - left) }
}

export interface ClipTargetArgs {
  grip: ClipGrip
  clip: TimeClip
  /** Czas pod kursorem. */
  desiredMs: number
  /** Odległość od początku klipu do punktu chwycenia — tylko dla `move`. */
  grabOffsetMs: number
  lowestMs: number
  highestMs: number
  snapPoints: number[]
  toleranceMs: number
}

/**
 * Nowe czasy klipu. Kolejność jak przy granicy ujęcia: najpierw przyciąganie do
 * punktów, potem do klatki, na końcu ograniczenia — postawione na końcu nie da
 * się ich obejść żadnym przyciąganiem.
 *
 * Liczymy na indeksach klatek, nie na milisekundach. `startMs + MIN_CLIP_MS`
 * wygląda prościej, ale `MIN_CLIP_MS` to zaokrąglone dwie klatki (83 ms, nie
 * 83,333…), więc dodane do czasu spoza klatki zerowej zdejmuje wynik z siatki.
 */
export function clipTargetMs(args: ClipTargetArgs): { startMs: number; endMs: number } {
  const lowest = frameIndexOf(args.lowestMs)
  const highest = frameIndexOf(args.highestMs)
  const snapped = frameIndexOf(snapToFrame(snapMs(args.desiredMs, args.snapPoints, args.toleranceMs)))

  if (args.grip === 'move') {
    const lengthFrames = frameIndexOf(args.clip.endMs) - frameIndexOf(args.clip.startMs)
    const wanted = snapped - frameIndexOf(args.grabOffsetMs)
    const start = Math.min(Math.max(wanted, lowest), highest - lengthFrames)
    return { startMs: msOfFrameIndex(start), endMs: msOfFrameIndex(start + lengthFrames) }
  }

  if (args.grip === 'start') {
    const endFrame = frameIndexOf(args.clip.endMs)
    const start = Math.min(Math.max(snapped, lowest), endFrame - MIN_CLIP_FRAMES)
    return { startMs: msOfFrameIndex(start), endMs: msOfFrameIndex(endFrame) }
  }

  const startFrame = frameIndexOf(args.clip.startMs)
  const end = Math.max(Math.min(snapped, highest), startFrame + MIN_CLIP_FRAMES)
  return { startMs: msOfFrameIndex(startFrame), endMs: msOfFrameIndex(end) }
}
```

- [ ] **Krok 4: Uruchom i zobacz zielony**

Run: `npm test --workspace @mmh3/web -- clips`
Expected: PASS, 9 testów.

- [ ] **Krok 5: Napisz test gestu**

`web/test/timeline/dragClip.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createScale } from '../../src/timeline/scale.js'
import { useDragClip } from '../../src/timeline/useDragClip.js'
import { clipBox, type TimeClip } from '../../src/timeline/clips.js'
import { firePointer } from './pointer.js'

const scale = createScale(8000, 800, 1)

let clips: TimeClip[] = []
let commits = 0

function Harness() {
  const startDrag = useDragClip(scale, {
    read: id => clips.find(clip => clip.id === id),
    bounds: () => ({ lowestMs: 0, highestMs: 8000 }),
    snapPoints: () => [],
    write: (id, next) => {
      clips = clips.map(clip => clip.id === id ? { ...clip, ...next } : clip)
      commits += 1
    },
  })

  return (
    <div
      data-testid="track"
      style={{ position: 'relative', width: 800 }}
    >
      {clips.map(clip => (
        <div key={clip.id} data-testid={`clip-${clip.id}`} style={{ position: 'absolute', ...clipBox(scale, clip) }}>
          <button type="button" data-testid={`move-${clip.id}`} onPointerDown={e => startDrag(clip.id, 'move', e)}>x</button>
          <button type="button" data-testid={`start-${clip.id}`} onPointerDown={e => startDrag(clip.id, 'start', e)}>[</button>
          <button type="button" data-testid={`end-${clip.id}`} onPointerDown={e => startDrag(clip.id, 'end', e)}>]</button>
        </div>
      ))}
    </div>
  )
}

const grab = (testId: string) => {
  const element = screen.getByTestId(testId)
  element.setPointerCapture = () => {}
  element.releasePointerCapture = () => {}
  return element
}

beforeEach(() => {
  clips = [{ id: 'a', startMs: 2000, endMs: 3000 }]
  commits = 0
})

describe('useDragClip', () => {
  it('przesuwa cały klip zachowując jego długość', () => {
    render(<Harness />)
    const handle = grab('move-a')
    firePointer(handle, 'pointerdown', 200)
    firePointer(handle, 'pointermove', 500)
    firePointer(handle, 'pointerup', 500)
    const clip = clips[0]
    expect(clip?.startMs).toBe(5000)
    expect((clip?.endMs ?? 0) - (clip?.startMs ?? 0)).toBe(1000)
  })

  it('przeciągnięcie krawędzi zmienia tylko ją', () => {
    render(<Harness />)
    const handle = grab('end-a')
    firePointer(handle, 'pointerdown', 300)
    firePointer(handle, 'pointermove', 600)
    firePointer(handle, 'pointerup', 600)
    expect(clips[0]?.startMs).toBe(2000)
    expect(clips[0]?.endMs).toBe(6000)
  })

  it('każdy ruch wskaźnika zapisuje, więc klip nadąża za kursorem', () => {
    render(<Harness />)
    const handle = grab('move-a')
    firePointer(handle, 'pointerdown', 200)
    firePointer(handle, 'pointermove', 300)
    firePointer(handle, 'pointermove', 400)
    firePointer(handle, 'pointerup', 400)
    expect(commits).toBe(2)
  })

  it('zwolnienie i anulowanie odpinają nasłuch', () => {
    render(<Harness />)
    const handle = grab('move-a')
    firePointer(handle, 'pointerdown', 200)
    firePointer(handle, 'pointercancel', 200)
    const before = commits
    firePointer(handle, 'pointermove', 700)
    expect(commits).toBe(before)
  })
})
```

- [ ] **Krok 6: Uruchom i zobacz czerwony**

Run: `npm test --workspace @mmh3/web -- dragClip`
Expected: FAIL, „Failed to resolve import … useDragClip.js".

- [ ] **Krok 7: Napisz `useDragClip.ts`**

```ts
import { pxToMs, type Scale } from './scale.js'
import { clipTargetMs, type ClipGrip, type TimeClip } from './clips.js'

/**
 * Licznik gestów w zakresie modułu, nie w `useRef`. Referencja komponentu
 * zeruje się po przemontowaniu, a klucz sklejania historii żyje w store, który
 * go nie czyści — dwa osobne przeciągnięcia dostawały wtedy ten sam klucz
 * i wpadały do jednego wpisu cofania. Tożsamość gestu musi być unikalna w skali
 * procesu, a nie komponentu.
 */
let gestureCounter = 0

export interface DragClipOptions {
  read: (clipId: string) => TimeClip | undefined
  bounds: (clipId: string) => { lowestMs: number; highestMs: number }
  snapPoints: (clipId: string) => number[]
  write: (clipId: string, next: { startMs: number; endMs: number }, coalesceKey: string) => void
  toleranceMs?: number
}

export function useDragClip(scale: Scale, options: DragClipOptions) {
  return (clipId: string, grip: ClipGrip, event: React.PointerEvent<HTMLElement>) => {
    const clip = options.read(clipId)
    const track = event.currentTarget.closest('[data-track]') ?? event.currentTarget.parentElement
    if (!clip || !track) return

    event.preventDefault()
    event.stopPropagation()
    gestureCounter += 1
    const coalesceKey = `clip:${clipId}:${gestureCounter}`
    const bounds = track.getBoundingClientRect()
    const target = event.currentTarget
    const grabOffsetMs = Math.max(0, pxToMs(scale, event.clientX - bounds.left) - clip.startMs)

    const move = (moveEvent: PointerEvent) => {
      const current = options.read(clipId)
      if (!current) return
      const next = clipTargetMs({
        grip,
        clip: current,
        desiredMs: pxToMs(scale, moveEvent.clientX - bounds.left),
        grabOffsetMs,
        snapPoints: options.snapPoints(clipId),
        toleranceMs: options.toleranceMs ?? 0,
        ...options.bounds(clipId),
      })
      options.write(clipId, next, coalesceKey)
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

- [ ] **Krok 8: Uruchom i zobacz zielony**

Run: `npm test --workspace @mmh3/web -- dragClip`
Expected: PASS, 4 testy.

- [ ] **Krok 9: Przenieś `clipBox` z `ShotTrack.tsx`**

`ShotTrack.tsx` ma dziś własne `clipBox` i `MIN_CLIP_PX`. Usuń oba i importuj z `clips.js`. Podpis się różni — tamten brał `ShotSpan`, nowy bierze `TimeClip` — więc w miejscu użycia podaj `{ id: span.shot.id, startMs: span.startMs, endMs: span.endMs }`. Popraw import w `web/test/timeline/shotTrack.test.tsx`, jeśli test importował `clipBox` ze starego miejsca.

- [ ] **Krok 10: Uruchom całość i commit**

```bash
npm test && npm run typecheck
git add web/src/timeline/clips.ts web/src/timeline/useDragClip.ts web/src/timeline/ShotTrack.tsx web/test/timeline/clips.test.ts web/test/timeline/dragClip.test.tsx web/test/timeline/shotTrack.test.tsx
git commit -m "feat: wspolny klip czasowy i jeden gest dla przesuniecia i krawedzi"
```

---

### Task 5: Ścieżka KAMERA

Pierwsza ścieżka zbudowana na wspólnym klipie. Ruch kamery jest klipem **wewnątrz** ujęcia: reguła `CAM_IN_SHOT_BOUNDS` wymaga, żeby mieścił się w jego granicach, więc ograniczenia gestu biorą się z rozpiętości ujęcia, do którego ruch należy, a nie z całego materiału.

**Files:**
- Create: `web/src/timeline/CameraTrack.tsx`
- Modify: `web/src/i18n/dict.ts`
- Test: `web/test/timeline/cameraTrack.test.tsx`

**Interfaces:**
- Consumes: `useProject`, `useSelection` (`same`), `useT`, `Scale`, `clipBox`, `useDragClip`, `shotSpans`, `normalizeShots`
- Produces: `<CameraTrack scale={Scale} />`

- [ ] **Krok 1: Dodaj klucze słownika**

W `web/src/i18n/dict.ts`, połowa polska, obok kluczy `timeline.*`:

```ts
  'timeline.trackCamera': 'Kamera',
  'camera.clipLabel': 'Ruch kamery {type} w ujęciu {shot}',
  'camera.dragStart': 'Przesuń początek ruchu {type}',
  'camera.dragEnd': 'Przesuń koniec ruchu {type}',
  'camera.add': 'Dodaj ruch kamery',
  'camera.remove': 'Usuń ruch kamery',
```

angielska:

```ts
  'timeline.trackCamera': 'Camera',
  'camera.clipLabel': 'Camera move {type} in shot {shot}',
  'camera.dragStart': 'Move start of {type}',
  'camera.dragEnd': 'Move end of {type}',
  'camera.add': 'Add camera move',
  'camera.remove': 'Remove camera move',
```

- [ ] **Krok 2: Napisz testy**

`web/test/timeline/cameraTrack.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createScale } from '../../src/timeline/scale.js'
import { CameraTrack } from '../../src/timeline/CameraTrack.jsx'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { firePointer } from './pointer.js'
import { projectWithCamera } from './fixtures.js'

const scale = createScale(8000, 800, 1)

beforeEach(() => {
  useSelection.setState({ selected: [] })
  useProject.getState().load('test', projectWithCamera())
})

const grab = (name: RegExp) => {
  const element = screen.getByRole('button', { name })
  element.setPointerCapture = () => {}
  element.releasePointerCapture = () => {}
  return element
}

const moveOf = (id: string) =>
  useProject.getState().project?.shots.flatMap(shot => shot.cameraMoves).find(move => move.id === id)

describe('CameraTrack', () => {
  it('rysuje po jednym klipie na ruch kamery', () => {
    render(<CameraTrack scale={scale} />)
    expect(screen.getAllByRole('button', { name: /ruch kamery/i })).toHaveLength(2)
  })

  it('klip stoi tam, gdzie ruch zaczyna się w czasie', () => {
    render(<CameraTrack scale={scale} />)
    const clip = screen.getByRole('button', { name: /ruch kamery push-in/i })
    expect(clip.style.left).toBe('100px')
    expect(clip.style.width).toBe('300px')
  })

  it('kliknięcie klipu zaznacza ruch', async () => {
    const user = userEvent.setup()
    render(<CameraTrack scale={scale} />)
    await user.click(screen.getByRole('button', { name: /ruch kamery push-in/i }))
    expect(useSelection.getState().selected).toEqual([{ kind: 'camera', id: 'm1' }])
  })

  it('przeciągnięcie krawędzi końcowej wydłuża ruch', () => {
    render(<CameraTrack scale={scale} />)
    const handle = grab(/przesuń koniec ruchu push-in/i)
    firePointer(handle, 'pointerdown', 400)
    firePointer(handle, 'pointermove', 600)
    firePointer(handle, 'pointerup', 600)
    expect(moveOf('m1')?.endMs).toBe(6000)
  })

  it('ruch nie wychodzi poza ujęcie, do którego należy', () => {
    render(<CameraTrack scale={scale} />)
    const handle = grab(/przesuń koniec ruchu push-in/i)
    firePointer(handle, 'pointerdown', 400)
    firePointer(handle, 'pointermove', 790)
    firePointer(handle, 'pointerup', 790)
    const shotEnd = 6000
    expect(moveOf('m1')?.endMs).toBeLessThanOrEqual(shotEnd)
  })

  it('cały gest to jeden wpis historii cofania', () => {
    render(<CameraTrack scale={scale} />)
    const before = useProject.getState().past.length
    const handle = grab(/przesuń koniec ruchu push-in/i)
    firePointer(handle, 'pointerdown', 400)
    firePointer(handle, 'pointermove', 500)
    firePointer(handle, 'pointermove', 600)
    firePointer(handle, 'pointerup', 600)
    expect(useProject.getState().past.length).toBe(before + 1)
  })
})
```

Utwórz `web/test/timeline/fixtures.ts` z pomocnikiem, jeśli go nie ma; jeśli sąsiednie testy mają już własne budowanie projektu, przenieś je tam zamiast tworzyć drugą wersję:

```ts
import type { CameraMove, Project, Shot } from '@mmh3/shared'

export const emptyShot = (id: string, index: number, startMs: number): Shot => ({
  id, index, startMs,
  cutType: 'cut', cutPhrase: 'the camera cuts to', composition: '',
  body: [], cameraMoves: [], dialogue: [], screenText: [], diegeticSfx: [],
  labelRefs: [], anchors: [],
})

export const baseProject = (shots: Shot[]): Project => ({
  schemaVersion: 1, id: 'p1', name: 'test', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '1920x1080' },
  style: '', assets: [], labels: [], speakers: [], shots,
  audio: { overallSoundscape: '', nonDiegeticMusic: '' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
})

const move = (id: string, type: CameraMove['type'], startMs: number, endMs: number): CameraMove =>
  ({ id, type, startMs, endMs })

export const projectWithCamera = (): Project => baseProject([
  { ...emptyShot('a', 0, 0), cameraMoves: [move('m1', 'push-in', 1000, 4000)] },
  { ...emptyShot('b', 1, 6000), cameraMoves: [move('m2', 'pan-left', 6000, 7000)] },
])
```

- [ ] **Krok 3: Uruchom i zobacz czerwony**

Run: `npm test --workspace @mmh3/web -- cameraTrack`
Expected: FAIL, „Failed to resolve import … CameraTrack.jsx".

- [ ] **Krok 4: Napisz `CameraTrack.tsx`**

```tsx
import { useProject } from '../store/projectStore.js'
import { same, useSelection } from '../store/selectionStore.js'
import { useT } from '../i18n/useT.js'
import { msToPx, type Scale } from './scale.js'
import { clipBox } from './clips.js'
import { useDragClip } from './useDragClip.js'
import { shotSpans } from './spans.js'

/**
 * Ruch kamery należy do ujęcia i reguła `CAM_IN_SHOT_BOUNDS` wymaga, żeby się
 * w nim mieścił. Ograniczenia gestu biorą się więc z rozpiętości ujęcia, a nie
 * z całego materiału — inaczej interfejs pozwalałby wyprodukować stan, który
 * walidator zaraz odrzuci.
 */
export function CameraTrack({ scale }: { scale: Scale }) {
  const t = useT()
  const project = useProject(state => state.project)
  const selected = useSelection(state => state.selected)
  const select = useSelection(state => state.select)

  const spans = project ? shotSpans(project.shots, project.video.durationMs) : []

  const findMove = (moveId: string) => {
    for (const span of spans) {
      const move = span.shot.cameraMoves.find(candidate => candidate.id === moveId)
      if (move) return { span, move }
    }
    return undefined
  }

  const startDrag = useDragClip(scale, {
    read: moveId => {
      const found = findMove(moveId)
      return found && { id: moveId, startMs: found.move.startMs, endMs: found.move.endMs }
    },
    bounds: moveId => {
      const found = findMove(moveId)
      return found
        ? { lowestMs: found.span.startMs, highestMs: found.span.endMs }
        : { lowestMs: 0, highestMs: scale.durationMs }
    },
    snapPoints: () => spans.flatMap(span => [span.startMs, span.endMs]),
    toleranceMs: 80,
    write: (moveId, next, coalesceKey) => {
      useProject.getState().apply(
        candidate => ({
          ...candidate,
          shots: candidate.shots.map(shot => ({
            ...shot,
            cameraMoves: shot.cameraMoves.map(move =>
              move.id === moveId ? { ...move, ...next } : move),
          })),
        }),
        { coalesceKey },
      )
    },
  })

  if (!project) return null

  return (
    <div
      data-track="camera"
      aria-label={t('timeline.trackCamera')}
      className="relative h-8 border-b border-neutral-800"
      style={{ width: msToPx(scale, scale.durationMs) }}
    >
      {spans.flatMap(span => span.shot.cameraMoves.map(move => {
        const ref = { kind: 'camera' as const, id: move.id }
        const isSelected = selected.some(candidate => same(candidate, ref))
        return (
          <div key={move.id} className="absolute top-1 h-6" style={clipBox(scale, move)}>
            <button
              type="button"
              aria-pressed={isSelected}
              aria-label={t('camera.clipLabel', { type: move.type, shot: span.shot.index + 1 })}
              onClick={() => select(ref)}
              onPointerDown={event => startDrag(move.id, 'move', event)}
              className={`h-full w-full overflow-hidden rounded border px-1 text-left text-[10px] ${
                isSelected
                  ? 'border-violet-500 bg-violet-950 text-violet-100'
                  : 'border-neutral-700 bg-neutral-900 hover:border-neutral-500'
              }`}
            >
              {move.type}
            </button>
            <button
              type="button"
              aria-label={t('camera.dragStart', { type: move.type })}
              onPointerDown={event => startDrag(move.id, 'start', event)}
              className="absolute inset-y-0 left-0 w-1 cursor-ew-resize bg-violet-500/40"
            />
            <button
              type="button"
              aria-label={t('camera.dragEnd', { type: move.type })}
              onPointerDown={event => startDrag(move.id, 'end', event)}
              className="absolute inset-y-0 right-0 w-1 cursor-ew-resize bg-violet-500/40"
            />
          </div>
        )
      }))}
    </div>
  )
}
```

- [ ] **Krok 5: Uruchom i zobacz zielony**

Run: `npm test --workspace @mmh3/web -- cameraTrack`
Expected: PASS, 6 testów. Jeśli test ograniczenia do ujęcia przechodzi także po usunięciu `bounds`, popraw test — musi być czerwony bez ograniczenia.

- [ ] **Krok 6: Uruchom całość i commit**

```bash
npm test && npm run typecheck
git add web/src/timeline/CameraTrack.tsx web/src/i18n/dict.ts web/test/timeline/cameraTrack.test.tsx web/test/timeline/fixtures.ts
git commit -m "feat: sciezka kamery z klipami ruchu ograniczonymi do ujecia"
```

---

### Task 6: Pasy dialogów per mówca

Specyfikacja pokazuje po jednym pasie na mówcę: `(S1)` i `(S2)` mają własne wiersze, bo równoległe kwestie dwóch osób muszą być widoczne obok siebie, a nie jedna na drugiej. Kwestia bez mówcy (narracja) trafia do pasa zbiorczego na końcu.

**Files:**
- Create: `web/src/timeline/DialogueTracks.tsx`
- Modify: `web/src/i18n/dict.ts`
- Test: `web/test/timeline/dialogueTracks.test.tsx`

**Interfaces:**
- Consumes: `useProject`, `useSelection` (`same`), `useT`, `Scale`, `clipBox`, `useDragClip`, `shotSpans`
- Produces: `<DialogueTracks scale={Scale} />`

- [ ] **Krok 1: Dodaj klucze słownika**

Polska:

```ts
  'timeline.trackDialogue': 'Dialog {speaker}',
  'timeline.trackDialogueOther': 'Dialog bez mówcy',
  'dialogue.clipLabel': 'Kwestia {speaker}: {text}',
  'dialogue.dragStart': 'Przesuń początek kwestii {speaker}',
  'dialogue.dragEnd': 'Przesuń koniec kwestii {speaker}',
```

angielska:

```ts
  'timeline.trackDialogue': 'Dialogue {speaker}',
  'timeline.trackDialogueOther': 'Dialogue without speaker',
  'dialogue.clipLabel': 'Line by {speaker}: {text}',
  'dialogue.dragStart': 'Move start of line by {speaker}',
  'dialogue.dragEnd': 'Move end of line by {speaker}',
```

- [ ] **Krok 2: Napisz testy**

`web/test/timeline/dialogueTracks.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { createScale } from '../../src/timeline/scale.js'
import { DialogueTracks } from '../../src/timeline/DialogueTracks.jsx'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { firePointer } from './pointer.js'
import { projectWithDialogue } from './fixtures.js'

const scale = createScale(8000, 800, 1)

beforeEach(() => {
  useSelection.setState({ selected: [] })
  useProject.getState().load('test', projectWithDialogue())
})

const eventOf = (id: string) =>
  useProject.getState().project?.shots.flatMap(shot => shot.dialogue).find(event => event.id === id)

describe('DialogueTracks', () => {
  it('daje każdemu mówcy własny pas', () => {
    render(<DialogueTracks scale={scale} />)
    expect(screen.getByLabelText(/dialog S1/i)).toBeTruthy()
    expect(screen.getByLabelText(/dialog S2/i)).toBeTruthy()
  })

  it('kwestia trafia do pasa swojego mówcy, a nie cudzego', () => {
    render(<DialogueTracks scale={scale} />)
    const laneOne = screen.getByLabelText(/dialog S1/i)
    expect(within(laneOne).getAllByRole('button', { name: /kwestia/i })).toHaveLength(1)
  })

  it('kwestia dwóch mówców pojawia się w obu pasach', () => {
    render(<DialogueTracks scale={scale} />)
    const clips = screen.getAllByRole('button', { name: /kwestia .*razem/i })
    expect(clips).toHaveLength(2)
  })

  it('kwestia bez mówcy trafia do pasa zbiorczego', () => {
    render(<DialogueTracks scale={scale} />)
    const lane = screen.getByLabelText(/dialog bez mówcy/i)
    expect(within(lane).getAllByRole('button', { name: /kwestia/i })).toHaveLength(1)
  })

  it('przeciągnięcie klipu przesuwa kwestię w czasie', () => {
    render(<DialogueTracks scale={scale} />)
    const lane = screen.getByLabelText(/dialog S1/i)
    const clip = within(lane).getByRole('button', { name: /kwestia/i })
    clip.setPointerCapture = () => {}
    clip.releasePointerCapture = () => {}
    firePointer(clip, 'pointerdown', 100)
    firePointer(clip, 'pointermove', 300)
    firePointer(clip, 'pointerup', 300)
    expect(eventOf('d1')?.startMs).toBe(3000)
  })

  it('przesunięcie w obu pasach tej samej kwestii daje jeden wpis historii', () => {
    render(<DialogueTracks scale={scale} />)
    const before = useProject.getState().past.length
    const lane = screen.getByLabelText(/dialog S1/i)
    const clip = within(lane).getByRole('button', { name: /kwestia/i })
    clip.setPointerCapture = () => {}
    clip.releasePointerCapture = () => {}
    firePointer(clip, 'pointerdown', 100)
    firePointer(clip, 'pointermove', 200)
    firePointer(clip, 'pointermove', 300)
    firePointer(clip, 'pointerup', 300)
    expect(useProject.getState().past.length).toBe(before + 1)
  })
})
```

Dopisz do `web/test/timeline/fixtures.ts`:

```ts
import type { DialogueEvent, Speaker } from '@mmh3/shared'

const speaker = (id: string, code: string): Speaker => ({
  id, code, characterType: 'woman', age: 'in her thirties', gender: 'female',
  pitch: 'medium', timbre: 'warm', rate: 'measured', accent: 'neutral',
  onScreen: true, fullDescriptor: 'a woman', shortDescriptor: 'the woman',
})

const line = (id: string, speakerIds: string[], text: string, startMs: number, endMs: number): DialogueEvent => ({
  id, speakerIds, verb: 'says', punctuation: ':', language: 'English', text,
  voiceover: false, sceneTransBefore: false, sceneTransAfter: false, cutoff: false,
  startMs, endMs,
})

export const projectWithDialogue = (): Project => ({
  ...baseProject([
    {
      ...emptyShot('a', 0, 0),
      dialogue: [
        line('d1', ['s1'], 'Nadchodzi', 1000, 2000),
        line('d2', ['s2'], 'Wiem', 2500, 3500),
        line('d3', ['s1', 's2'], 'razem', 4000, 5000),
        line('d4', [], 'narracja', 6000, 7000),
      ],
    },
  ]),
  speakers: [speaker('s1', 'S1'), speaker('s2', 'S2')],
})
```

- [ ] **Krok 3: Uruchom i zobacz czerwony**

Run: `npm test --workspace @mmh3/web -- dialogueTracks`
Expected: FAIL, brak modułu.

- [ ] **Krok 4: Napisz `DialogueTracks.tsx`**

```tsx
import type { DialogueEvent } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { same, useSelection } from '../store/selectionStore.js'
import { useT } from '../i18n/useT.js'
import { msToPx, type Scale } from './scale.js'
import { clipBox } from './clips.js'
import { useDragClip } from './useDragClip.js'
import { shotSpans } from './spans.js'

/**
 * Kwestia dwóch mówców pojawia się w obu pasach — to ta sama kwestia widziana
 * dwa razy, nie dwie kwestie. Przeciągnięcie w jednym pasie musi więc ruszyć
 * ten sam obiekt, a nie utworzyć kopii; klucz sklejania historii pochodzi z
 * identyfikatora kwestii, nie z pasa.
 */
export function DialogueTracks({ scale }: { scale: Scale }) {
  const t = useT()
  const project = useProject(state => state.project)
  const selected = useSelection(state => state.selected)
  const select = useSelection(state => state.select)

  const events: DialogueEvent[] = project
    ? shotSpans(project.shots, project.video.durationMs).flatMap(span => span.shot.dialogue)
    : []

  const startDrag = useDragClip(scale, {
    read: eventId => {
      const event = events.find(candidate => candidate.id === eventId)
      return event && { id: eventId, startMs: event.startMs, endMs: event.endMs }
    },
    bounds: () => ({ lowestMs: 0, highestMs: scale.durationMs }),
    snapPoints: () => project
      ? shotSpans(project.shots, project.video.durationMs).map(span => span.startMs)
      : [],
    toleranceMs: 80,
    write: (eventId, next, coalesceKey) => {
      useProject.getState().apply(
        candidate => ({
          ...candidate,
          shots: candidate.shots.map(shot => ({
            ...shot,
            dialogue: shot.dialogue.map(event =>
              event.id === eventId ? { ...event, ...next } : event),
          })),
        }),
        { coalesceKey },
      )
    },
  })

  if (!project) return null

  const lanes: Array<{ key: string; label: string; events: DialogueEvent[] }> = [
    ...project.speakers.map(speaker => ({
      key: speaker.id,
      label: t('timeline.trackDialogue', { speaker: speaker.code }),
      events: events.filter(event => event.speakerIds.includes(speaker.id)),
    })),
    {
      key: 'none',
      label: t('timeline.trackDialogueOther'),
      events: events.filter(event => event.speakerIds.length === 0),
    },
  ]

  const codeOf = (event: DialogueEvent): string =>
    event.speakerIds
      .map(id => project.speakers.find(speaker => speaker.id === id)?.code ?? id)
      .join(', ')

  return (
    <>
      {lanes.map(lane => (
        <div
          key={lane.key}
          data-track={`dialogue-${lane.key}`}
          aria-label={lane.label}
          className="relative h-8 border-b border-neutral-800"
          style={{ width: msToPx(scale, scale.durationMs) }}
        >
          {lane.events.map(event => {
            const ref = { kind: 'dialogue' as const, id: event.id }
            const isSelected = selected.some(candidate => same(candidate, ref))
            return (
              <div key={event.id} className="absolute top-1 h-6" style={clipBox(scale, event)}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={t('dialogue.clipLabel', { speaker: codeOf(event) || '—', text: event.text })}
                  onClick={() => select(ref)}
                  onPointerDown={pointerEvent => startDrag(event.id, 'move', pointerEvent)}
                  className={`h-full w-full overflow-hidden rounded border px-1 text-left text-[10px] ${
                    isSelected
                      ? 'border-emerald-500 bg-emerald-950 text-emerald-100'
                      : 'border-neutral-700 bg-neutral-900 hover:border-neutral-500'
                  }`}
                >
                  {event.text}
                </button>
                <button
                  type="button"
                  aria-label={t('dialogue.dragStart', { speaker: codeOf(event) || '—' })}
                  onPointerDown={pointerEvent => startDrag(event.id, 'start', pointerEvent)}
                  className="absolute inset-y-0 left-0 w-1 cursor-ew-resize bg-emerald-500/40"
                />
                <button
                  type="button"
                  aria-label={t('dialogue.dragEnd', { speaker: codeOf(event) || '—' })}
                  onPointerDown={pointerEvent => startDrag(event.id, 'end', pointerEvent)}
                  className="absolute inset-y-0 right-0 w-1 cursor-ew-resize bg-emerald-500/40"
                />
              </div>
            )
          })}
        </div>
      ))}
    </>
  )
}
```

- [ ] **Krok 5: Uruchom i zobacz zielony**

Run: `npm test --workspace @mmh3/web -- dialogueTracks`
Expected: PASS, 6 testów.

- [ ] **Krok 6: Uruchom całość i commit**

```bash
npm test && npm run typecheck
git add web/src/timeline/DialogueTracks.tsx web/src/i18n/dict.ts web/test/timeline/dialogueTracks.test.tsx web/test/timeline/fixtures.ts
git commit -m "feat: pasy dialogow z osobnym wierszem na mowce"
```

---

### Task 7: Naturalna długość kwestii

Specyfikacja stawia to jako zachowanie odróżniające narzędzie od formularza: „klip dialogowy ma realną długość liczoną z liczby słów i ustawialnego tempa mowy — widać, czy kwestia mieści się w oknie 4–15 s". Klip pokazuje więc cień naturalnej długości obok długości ustawionej i mówi, kiedy kwestia się nie zmieści.

Tempo mowy nie trafia do modelu domeny. `Speaker.rate` niesie prozę do promptu („measured pace"), a nie liczbę, i dokładanie tam pola liczbowego zmieniłoby schemat po to, żeby zasilić podpowiedź wyświetlaną. Tempo żyje więc w magazynie widoku, nietrwałym między sesjami, z wartością domyślną — i tak jest opisane w komentarzu, żeby nikt nie szukał go w `project.json`.

**Files:**
- Create: `web/src/timeline/speech.ts`
- Create: `web/src/store/speechRateStore.ts`
- Modify: `web/src/timeline/DialogueTracks.tsx`
- Modify: `web/src/i18n/dict.ts`
- Test: `web/test/timeline/speech.test.ts`
- Test: `web/test/timeline/dialogueLength.test.tsx`

**Interfaces:**
- Produces:
  - `countWords(text: string): number`
  - `naturalDurationMs(text: string, wordsPerMinute: number): number`
  - `useSpeechRate` — magazyn z `wordsPerMinute` i `setWordsPerMinute`
  - `DEFAULT_WORDS_PER_MINUTE = 150`

- [ ] **Krok 1: Dodaj klucze słownika**

Polska:

```ts
  'dialogue.tooShort': 'Kwestia nie mieści się w klipie: potrzeba {needed} s, jest {actual} s',
  'dialogue.naturalLength': 'Naturalna długość kwestii',
```

angielska:

```ts
  'dialogue.tooShort': 'Line does not fit the clip: needs {needed} s, has {actual} s',
  'dialogue.naturalLength': 'Natural length of the line',
```

- [ ] **Krok 2: Napisz test czystej funkcji**

`web/test/timeline/speech.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { countWords, naturalDurationMs, DEFAULT_WORDS_PER_MINUTE } from '../../src/timeline/speech.js'

describe('countWords', () => {
  it('liczy słowa oddzielone dowolną białą spacją', () => {
    expect(countWords('jedno dwa\ttrzy\ncztery')).toBe(4)
  })

  it('nie liczy pustego ciągu ani samych spacji', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
  })

  it('nie rozbija słowa na apostrofie ani myślniku', () => {
    expect(countWords("don't stop")).toBe(2)
    expect(countWords('czarno-biały film')).toBe(2)
  })
})

describe('naturalDurationMs', () => {
  it('sto pięćdziesiąt słów przy stu pięćdziesięciu na minutę to minuta', () => {
    const text = Array.from({ length: 150 }, () => 'słowo').join(' ')
    expect(naturalDurationMs(text, DEFAULT_WORDS_PER_MINUTE)).toBe(60000)
  })

  it('szybsze tempo skraca kwestię', () => {
    const text = 'jedno dwa trzy cztery pięć sześć'
    expect(naturalDurationMs(text, 300)).toBeLessThan(naturalDurationMs(text, 150))
  })

  it('pusta kwestia trwa zero', () => {
    expect(naturalDurationMs('', DEFAULT_WORDS_PER_MINUTE)).toBe(0)
  })

  it('tempo zerowe albo ujemne nie daje nieskończoności', () => {
    expect(Number.isFinite(naturalDurationMs('jedno dwa', 0))).toBe(true)
    expect(Number.isFinite(naturalDurationMs('jedno dwa', -5))).toBe(true)
  })
})
```

- [ ] **Krok 3: Uruchom i zobacz czerwony**

Run: `npm test --workspace @mmh3/web -- speech`
Expected: FAIL, brak modułu.

- [ ] **Krok 4: Napisz `speech.ts`**

```ts
/**
 * Tempo mowy w słowach na minutę. Sto pięćdziesiąt to spokojna narracja —
 * wartość poglądowa, od której zaczyna suwak, a nie prawda o modelu.
 */
export const DEFAULT_WORDS_PER_MINUTE = 150

/** Najniższe tempo, jakie ma sens — poniżej wynik uciekłby w nieskończoność. */
const MIN_WORDS_PER_MINUTE = 40

export function countWords(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  return trimmed.split(/\s+/).length
}

/**
 * Ile kwestia potrwa, jeśli wypowiedzieć ją w podanym tempie. Służy wyłącznie
 * do pokazania, czy zmieści się w klipie — nie zapisuje się do modelu, bo
 * `<d>` idzie do promptu verbatim i długość klipu jest decyzją użytkownika.
 */
export function naturalDurationMs(text: string, wordsPerMinute: number): number {
  const words = countWords(text)
  if (words === 0) return 0
  const rate = Math.max(MIN_WORDS_PER_MINUTE, wordsPerMinute)
  return Math.round((words / rate) * 60000)
}
```

- [ ] **Krok 5: Napisz magazyn tempa**

`web/src/store/speechRateStore.ts`:

```ts
import { create } from 'zustand'
import { DEFAULT_WORDS_PER_MINUTE } from '../timeline/speech.js'

/**
 * Tempo mowy jest ustawieniem widoku, nie częścią projektu. `Speaker.rate`
 * niesie prozę do promptu („measured pace"), a nie liczbę, i dokładanie tam
 * pola liczbowego zmieniałoby schemat po to, żeby zasilić podpowiedź na
 * ekranie. Wartość nie przeżywa przeładowania strony i tak ma być.
 */
interface SpeechRateState {
  wordsPerMinute: number
  setWordsPerMinute: (value: number) => void
}

export const useSpeechRate = create<SpeechRateState>(set => ({
  wordsPerMinute: DEFAULT_WORDS_PER_MINUTE,
  setWordsPerMinute: value => set({ wordsPerMinute: value }),
}))
```

- [ ] **Krok 6: Uruchom i zobacz zielony**

Run: `npm test --workspace @mmh3/web -- speech`
Expected: PASS, 7 testów.

- [ ] **Krok 7: Napisz test cienia na klipie**

`web/test/timeline/dialogueLength.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { createScale } from '../../src/timeline/scale.js'
import { DialogueTracks } from '../../src/timeline/DialogueTracks.jsx'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useSpeechRate } from '../../src/store/speechRateStore.js'
import { DEFAULT_WORDS_PER_MINUTE } from '../../src/timeline/speech.js'
import { projectWithDialogue } from './fixtures.js'

const scale = createScale(8000, 800, 1)

beforeEach(() => {
  useSelection.setState({ selected: [] })
  useSpeechRate.setState({ wordsPerMinute: DEFAULT_WORDS_PER_MINUTE })
  useProject.getState().load('test', projectWithDialogue())
})

describe('naturalna długość na klipie dialogowym', () => {
  it('rysuje cień naturalnej długości obok klipu', () => {
    render(<DialogueTracks scale={scale} />)
    const lane = screen.getByLabelText(/dialog S1/i)
    expect(within(lane).getByLabelText(/naturalna długość/i)).toBeTruthy()
  })

  it('ostrzega, gdy kwestia nie mieści się w klipie', () => {
    useProject.getState().apply(project => ({
      ...project,
      shots: project.shots.map(shot => ({
        ...shot,
        dialogue: shot.dialogue.map(event =>
          event.id === 'd1'
            ? { ...event, text: Array.from({ length: 40 }, () => 'słowo').join(' ') }
            : event),
      })),
    }))
    render(<DialogueTracks scale={scale} />)
    const lane = screen.getByLabelText(/dialog S1/i)
    expect(within(lane).getByRole('button', { name: /nie mieści się/i })).toBeTruthy()
  })

  it('szybsze tempo usuwa ostrzeżenie', () => {
    useProject.getState().apply(project => ({
      ...project,
      shots: project.shots.map(shot => ({
        ...shot,
        dialogue: shot.dialogue.map(event =>
          event.id === 'd1'
            ? { ...event, text: Array.from({ length: 40 }, () => 'słowo').join(' '), endMs: 9000 }
            : event),
      })),
    }))
    useSpeechRate.setState({ wordsPerMinute: 600 })
    render(<DialogueTracks scale={scale} />)
    const lane = screen.getByLabelText(/dialog S1/i)
    expect(within(lane).queryByRole('button', { name: /nie mieści się/i })).toBeNull()
  })
})
```

- [ ] **Krok 8: Uruchom i zobacz czerwony**

Run: `npm test --workspace @mmh3/web -- dialogueLength`
Expected: FAIL — nie ma cienia ani ostrzeżenia.

- [ ] **Krok 9: Dołóż cień i ostrzeżenie do `DialogueTracks.tsx`**

Wewnątrz pętli po kwestiach, przed przyciskiem klipu, dołóż liczenie i dwa elementy:

```tsx
            const wordsPerMinute = useSpeechRate.getState().wordsPerMinute
            const naturalMs = naturalDurationMs(event.text, wordsPerMinute)
            const actualMs = event.endMs - event.startMs
            const fits = naturalMs <= actualMs
```

oraz, wewnątrz `<div>` klipu, obok przycisków:

```tsx
                <span
                  aria-label={t('dialogue.naturalLength')}
                  className="pointer-events-none absolute inset-y-0 left-0 border-r border-dashed border-emerald-300/60"
                  style={{ width: msToPx(scale, naturalMs) }}
                />
                {!fits && (
                  <button
                    type="button"
                    aria-label={t('dialogue.tooShort', {
                      needed: (naturalMs / 1000).toFixed(1),
                      actual: (actualMs / 1000).toFixed(1),
                    })}
                    onClick={() => select(ref)}
                    className="absolute -top-1 right-0 h-2 w-2 rounded-full bg-amber-400"
                  />
                )}
```

Subskrybuj tempo przez `useSpeechRate(state => state.wordsPerMinute)` na górze komponentu, a nie przez `getState()` w pętli — inaczej zmiana tempa nie przemaluje klipów. Zamień powyższy `useSpeechRate.getState()` na tę zmienną; `getState()` w ciele renderu jest odczytem bez subskrypcji, dokładnie tym błędem, który Plan 3 znalazł dwa razy (`state.isSelected` w `ShotTrack` i w `PromptPanel`).

- [ ] **Krok 10: Uruchom i zobacz zielony**

Run: `npm test --workspace @mmh3/web -- dialogueLength dialogueTracks`
Expected: PASS. Sprawdź różnicowo: zamień subskrypcję z powrotem na `getState()` i potwierdź, że test „szybsze tempo usuwa ostrzeżenie" czerwienieje.

- [ ] **Krok 11: Uruchom całość i commit**

```bash
npm test && npm run typecheck
git add web/src/timeline/speech.ts web/src/store/speechRateStore.ts web/src/timeline/DialogueTracks.tsx web/src/i18n/dict.ts web/test/timeline/speech.test.ts web/test/timeline/dialogueLength.test.tsx
git commit -m "feat: naturalna dlugosc kwestii z liczby slow i tempa mowy"
```

---

### Task 8: Propozycje `<scenetrans>` i `<cutoff>` z geometrii

Specyfikacja: „przejście klipu przez cięcie proponuje `<scenetrans>` po obu stronach; wystawanie poza koniec proponuje `<cutoff>`". To jest wnioskowanie z geometrii, a nie reguła walidatora — model ma już pola `sceneTransBefore`, `sceneTransAfter` i `cutoff`, więc oś czasu tylko zauważa, że układ klipów o coś prosi, i daje to zrobić jednym kliknięciem.

Propozycja nigdy nie stosuje się sama. To ta sama zasada, którą specyfikacja stawia LLM-owi: zmiana modelu jest decyzją użytkownika.

**Files:**
- Create: `web/src/timeline/proposals.ts`
- Modify: `web/src/timeline/DialogueTracks.tsx`
- Modify: `web/src/i18n/dict.ts`
- Test: `web/test/timeline/proposals.test.ts`
- Test: `web/test/timeline/proposalsUi.test.tsx`

**Interfaces:**
- Produces:
  - `type ProposalKind = 'scenetrans' | 'cutoff'`
  - `interface DialogueProposal { eventId: string; kind: ProposalKind }`
  - `dialogueProposals(project: Project): DialogueProposal[]`
  - `applyProposal(project: Project, proposal: DialogueProposal): Project`

- [ ] **Krok 1: Dodaj klucze słownika**

Polska:

```ts
  'proposal.scenetrans': 'Kwestia przechodzi przez cięcie — dodaj <scenetrans>',
  'proposal.cutoff': 'Kwestia wystaje poza koniec materiału — oznacz <cutoff>',
```

angielska:

```ts
  'proposal.scenetrans': 'Line crosses a cut — add <scenetrans>',
  'proposal.cutoff': 'Line runs past the end of the material — mark <cutoff>',
```

- [ ] **Krok 2: Napisz test czystej funkcji**

`web/test/timeline/proposals.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyProposal, dialogueProposals } from '../../src/timeline/proposals.js'
import { baseProject, emptyShot, lineFixture } from './fixtures.js'

const withDialogue = (startMs: number, endMs: number, extra: Partial<ReturnType<typeof lineFixture>> = {}) =>
  baseProject([
    { ...emptyShot('a', 0, 0), dialogue: [{ ...lineFixture('d1', ['s1'], 'tekst', startMs, endMs), ...extra }] },
    emptyShot('b', 1, 4000),
  ])

describe('dialogueProposals', () => {
  it('proponuje scenetrans dla kwestii przechodzącej przez cięcie', () => {
    const result = dialogueProposals(withDialogue(3000, 5000))
    expect(result).toContainEqual({ eventId: 'd1', kind: 'scenetrans' })
  })

  it('nie proponuje scenetrans, gdy kwestia mieści się w jednym ujęciu', () => {
    expect(dialogueProposals(withDialogue(1000, 2000))).toEqual([])
  })

  it('nie proponuje scenetrans, gdy oba znaczniki już stoją', () => {
    const result = dialogueProposals(withDialogue(3000, 5000, { sceneTransBefore: true, sceneTransAfter: true }))
    expect(result.some(p => p.kind === 'scenetrans')).toBe(false)
  })

  it('proponuje cutoff dla kwestii wystającej poza materiał', () => {
    const result = dialogueProposals(withDialogue(7000, 9000))
    expect(result).toContainEqual({ eventId: 'd1', kind: 'cutoff' })
  })

  it('nie proponuje cutoff, gdy znacznik już stoi', () => {
    const result = dialogueProposals(withDialogue(7000, 9000, { cutoff: true }))
    expect(result.some(p => p.kind === 'cutoff')).toBe(false)
  })

  it('kwestia kończąca się dokładnie na końcu materiału nie wystaje', () => {
    expect(dialogueProposals(withDialogue(7000, 8000)).some(p => p.kind === 'cutoff')).toBe(false)
  })
})

describe('applyProposal', () => {
  it('scenetrans ustawia oba znaczniki', () => {
    const next = applyProposal(withDialogue(3000, 5000), { eventId: 'd1', kind: 'scenetrans' })
    const event = next.shots.flatMap(s => s.dialogue).find(e => e.id === 'd1')
    expect(event?.sceneTransBefore).toBe(true)
    expect(event?.sceneTransAfter).toBe(true)
  })

  it('cutoff ustawia swój znacznik i nie rusza pozostałych', () => {
    const next = applyProposal(withDialogue(7000, 9000), { eventId: 'd1', kind: 'cutoff' })
    const event = next.shots.flatMap(s => s.dialogue).find(e => e.id === 'd1')
    expect(event?.cutoff).toBe(true)
    expect(event?.sceneTransBefore).toBe(false)
  })

  it('propozycja o nieznanym identyfikatorze zwraca ten sam obiekt', () => {
    const project = withDialogue(1000, 2000)
    expect(applyProposal(project, { eventId: 'brak', kind: 'cutoff' })).toBe(project)
  })
})
```

Ostatni test jest istotny: `projectStore.apply` przerywa, gdy recepta zwraca ten sam obiekt, więc zwrócenie identycznej referencji przy braku zmian zapobiega pustemu wpisowi w historii cofania.

Wyeksportuj z `web/test/timeline/fixtures.ts` dotychczasową funkcję `line` pod nazwą `lineFixture`, żeby dało się jej użyć spoza pliku.

- [ ] **Krok 3: Uruchom i zobacz czerwony**

Run: `npm test --workspace @mmh3/web -- proposals`
Expected: FAIL, brak modułu.

- [ ] **Krok 4: Napisz `proposals.ts`**

```ts
import type { Project } from '@mmh3/shared'
import { shotSpans } from './spans.js'

export type ProposalKind = 'scenetrans' | 'cutoff'

export interface DialogueProposal {
  eventId: string
  kind: ProposalKind
}

/**
 * Propozycje wynikające z samego układu klipów, nie z reguł walidatora.
 * Kwestia przechodząca przez cięcie brzmi w prompcie jak przerwana, chyba że
 * po obu stronach stoi `<scenetrans>`; kwestia wystająca poza materiał kończy
 * się w połowie, co guide zapisuje przez `<cutoff>`. Jedno i drugie widać z
 * geometrii, więc oś czasu może o tym powiedzieć — ale nie zmienia modelu bez
 * decyzji użytkownika.
 */
export function dialogueProposals(project: Project): DialogueProposal[] {
  const spans = shotSpans(project.shots, project.video.durationMs)
  const cuts = spans.map(span => span.startMs).filter(ms => ms > 0)
  const proposals: DialogueProposal[] = []

  for (const span of spans) {
    for (const event of span.shot.dialogue) {
      const crossesCut = cuts.some(cut => event.startMs < cut && event.endMs > cut)
      if (crossesCut && !(event.sceneTransBefore && event.sceneTransAfter)) {
        proposals.push({ eventId: event.id, kind: 'scenetrans' })
      }
      if (event.endMs > project.video.durationMs && !event.cutoff) {
        proposals.push({ eventId: event.id, kind: 'cutoff' })
      }
    }
  }
  return proposals
}

/** Nie zmienia niczego poza jednym znacznikiem jednej kwestii. */
export function applyProposal(project: Project, proposal: DialogueProposal): Project {
  let touched = false
  const shots = project.shots.map(shot => ({
    ...shot,
    dialogue: shot.dialogue.map(event => {
      if (event.id !== proposal.eventId) return event
      touched = true
      return proposal.kind === 'scenetrans'
        ? { ...event, sceneTransBefore: true, sceneTransAfter: true }
        : { ...event, cutoff: true }
    }),
  }))
  return touched ? { ...project, shots } : project
}
```

- [ ] **Krok 5: Uruchom i zobacz zielony**

Run: `npm test --workspace @mmh3/web -- proposals`
Expected: PASS, 9 testów.

- [ ] **Krok 6: Napisz test interfejsu**

`web/test/timeline/proposalsUi.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createScale } from '../../src/timeline/scale.js'
import { DialogueTracks } from '../../src/timeline/DialogueTracks.jsx'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { projectWithDialogue } from './fixtures.js'

const scale = createScale(8000, 800, 1)

beforeEach(() => {
  useSelection.setState({ selected: [] })
  useProject.getState().load('test', projectWithDialogue())
})

describe('propozycje na klipie dialogowym', () => {
  it('pokazuje przycisk propozycji, gdy kwestia przechodzi przez cięcie', async () => {
    useProject.getState().apply(project => ({
      ...project,
      shots: [
        { ...(project.shots[0] ?? { id: 'a' }), startMs: 0 },
      ].length === 1 ? { ...project }.shots : project.shots,
    }))
    useProject.getState().load('test', {
      ...projectWithDialogue(),
      shots: [
        { ...projectWithDialogue().shots[0], dialogue: [
          { ...projectWithDialogue().shots[0].dialogue[0], startMs: 3000, endMs: 5000 },
        ] },
        { ...projectWithDialogue().shots[0], id: 'b', index: 1, startMs: 4000, dialogue: [] },
      ],
    })
    render(<DialogueTracks scale={scale} />)
    expect(screen.getByRole('button', { name: /przechodzi przez cięcie/i })).toBeTruthy()
  })

  it('kliknięcie propozycji zmienia model i zostawia jeden wpis historii', async () => {
    const user = userEvent.setup()
    useProject.getState().load('test', {
      ...projectWithDialogue(),
      shots: [
        { ...projectWithDialogue().shots[0], dialogue: [
          { ...projectWithDialogue().shots[0].dialogue[0], startMs: 3000, endMs: 5000 },
        ] },
        { ...projectWithDialogue().shots[0], id: 'b', index: 1, startMs: 4000, dialogue: [] },
      ],
    })
    render(<DialogueTracks scale={scale} />)
    const before = useProject.getState().past.length

    await user.click(screen.getByRole('button', { name: /przechodzi przez cięcie/i }))

    const event = useProject.getState().project?.shots.flatMap(s => s.dialogue).find(e => e.id === 'd1')
    expect(event?.sceneTransBefore).toBe(true)
    expect(useProject.getState().past.length).toBe(before + 1)
  })

  it('po zastosowaniu propozycja znika', async () => {
    const user = userEvent.setup()
    useProject.getState().load('test', {
      ...projectWithDialogue(),
      shots: [
        { ...projectWithDialogue().shots[0], dialogue: [
          { ...projectWithDialogue().shots[0].dialogue[0], startMs: 3000, endMs: 5000 },
        ] },
        { ...projectWithDialogue().shots[0], id: 'b', index: 1, startMs: 4000, dialogue: [] },
      ],
    })
    render(<DialogueTracks scale={scale} />)
    await user.click(screen.getByRole('button', { name: /przechodzi przez cięcie/i }))
    expect(screen.queryByRole('button', { name: /przechodzi przez cięcie/i })).toBeNull()
  })
})
```

Ten kod budowania projektu jest rozwlekły i powtarza się trzy razy — przenieś go do `fixtures.ts` jako `projectWithCrossingLine()` i użyj w każdym z trzech testów. Zostawienie go w tej postaci byłoby usterką, którą i tak wychwyci recenzja.

- [ ] **Krok 7: Uruchom i zobacz czerwony, potem dołóż przyciski do `DialogueTracks.tsx`**

Policz propozycje raz na render i pokaż po jednym przycisku na kwestię:

```tsx
  const proposals = project ? dialogueProposals(project) : []
```

a wewnątrz pętli po kwestiach:

```tsx
                {proposals
                  .filter(proposal => proposal.eventId === event.id)
                  .map(proposal => (
                    <button
                      key={proposal.kind}
                      type="button"
                      aria-label={t(`proposal.${proposal.kind}`)}
                      onClick={() => useProject.getState().apply(candidate => applyProposal(candidate, proposal))}
                      className="absolute -top-1 left-0 h-2 w-2 rounded-full bg-sky-400"
                    />
                  ))}
```

- [ ] **Krok 8: Uruchom i zobacz zielony**

Run: `npm test --workspace @mmh3/web -- proposalsUi proposals dialogueTracks dialogueLength`
Expected: PASS. Sprawdź różnicowo, że test „po zastosowaniu propozycja znika" czerwienieje, gdy `applyProposal` zwraca projekt bez zmiany.

- [ ] **Krok 9: Uruchom całość i commit**

```bash
npm test && npm run typecheck
git add web/src/timeline/proposals.ts web/src/timeline/DialogueTracks.tsx web/src/i18n/dict.ts web/test/timeline/proposals.test.ts web/test/timeline/proposalsUi.test.tsx web/test/timeline/fixtures.ts
git commit -m "feat: propozycje scenetrans i cutoff wynikajace z ukladu klipow"
```

---

### Task 9: Ścieżki TEKST i SFX

Dwie ścieżki w jednym zadaniu, bo różnią się tylko tym, skąd biorą czasy. `DiegeticSfx` niesie własne `startMs` i `endMs`, więc jest zwykłym klipem. `ScreenText` **nie ma czasów** — należy do ujęcia i tyle. Jego klip pokrywa więc rozpiętość swojego ujęcia i nie da się go przeciągnąć; dokładanie czasów do modelu tylko po to, żeby dało się je przesuwać, byłoby zmianą schematu dla wygody rysowania.

**Files:**
- Create: `web/src/timeline/ScreenTextTrack.tsx`
- Create: `web/src/timeline/SfxTrack.tsx`
- Modify: `web/src/i18n/dict.ts`
- Test: `web/test/timeline/screenTextTrack.test.tsx`
- Test: `web/test/timeline/sfxTrack.test.tsx`

**Interfaces:**
- Produces: `<ScreenTextTrack scale={Scale} />`, `<SfxTrack scale={Scale} />`

- [ ] **Krok 1: Dodaj klucze słownika**

Polska:

```ts
  'timeline.trackScreenText': 'Tekst na ekranie',
  'timeline.trackSfx': 'SFX',
  'screenText.clipLabel': 'Tekst na ekranie w ujęciu {shot}: {text}',
  'sfx.clipLabel': 'Dźwięk: {description}',
  'sfx.dragStart': 'Przesuń początek dźwięku {description}',
  'sfx.dragEnd': 'Przesuń koniec dźwięku {description}',
```

angielska:

```ts
  'timeline.trackScreenText': 'On-screen text',
  'timeline.trackSfx': 'SFX',
  'screenText.clipLabel': 'On-screen text in shot {shot}: {text}',
  'sfx.clipLabel': 'Sound: {description}',
  'sfx.dragStart': 'Move start of sound {description}',
  'sfx.dragEnd': 'Move end of sound {description}',
```

- [ ] **Krok 2: Napisz testy tekstu na ekranie**

`web/test/timeline/screenTextTrack.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createScale } from '../../src/timeline/scale.js'
import { ScreenTextTrack } from '../../src/timeline/ScreenTextTrack.jsx'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { baseProject, emptyShot } from './fixtures.js'

const scale = createScale(8000, 800, 1)

const projectWithText = () => baseProject([
  { ...emptyShot('a', 0, 0), screenText: [{ id: 't1', text: 'OTWARTE' }] },
  emptyShot('b', 1, 4000),
])

beforeEach(() => {
  useSelection.setState({ selected: [] })
  useProject.getState().load('test', projectWithText())
})

describe('ScreenTextTrack', () => {
  it('rysuje klip tylko dla ujęcia, które ma tekst', () => {
    render(<ScreenTextTrack scale={scale} />)
    expect(screen.getAllByRole('button', { name: /tekst na ekranie w ujęciu/i })).toHaveLength(1)
  })

  it('klip pokrywa całą rozpiętość swojego ujęcia', () => {
    render(<ScreenTextTrack scale={scale} />)
    const clip = screen.getByRole('button', { name: /tekst na ekranie w ujęciu 1/i })
    expect(clip.style.left).toBe('0px')
    expect(clip.style.width).toBe('400px')
  })

  it('kliknięcie zaznacza tekst, a nie ujęcie', async () => {
    const user = userEvent.setup()
    render(<ScreenTextTrack scale={scale} />)
    await user.click(screen.getByRole('button', { name: /tekst na ekranie w ujęciu 1/i }))
    expect(useSelection.getState().selected).toEqual([{ kind: 'screenText', id: 't1' }])
  })
})
```

- [ ] **Krok 3: Napisz testy SFX**

`web/test/timeline/sfxTrack.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createScale } from '../../src/timeline/scale.js'
import { SfxTrack } from '../../src/timeline/SfxTrack.jsx'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { firePointer } from './pointer.js'
import { baseProject, emptyShot } from './fixtures.js'

const scale = createScale(8000, 800, 1)

const projectWithSfx = () => baseProject([
  { ...emptyShot('a', 0, 0), diegeticSfx: [{ id: 'x1', description: 'krok', startMs: 1000, endMs: 2000 }] },
])

beforeEach(() => {
  useSelection.setState({ selected: [] })
  useProject.getState().load('test', projectWithSfx())
})

const sfxOf = (id: string) =>
  useProject.getState().project?.shots.flatMap(shot => shot.diegeticSfx).find(sfx => sfx.id === id)

describe('SfxTrack', () => {
  it('rysuje klip dźwięku tam, gdzie zaczyna się w czasie', () => {
    render(<SfxTrack scale={scale} />)
    const clip = screen.getByRole('button', { name: /dźwięk: krok/i })
    expect(clip.style.left).toBe('100px')
    expect(clip.style.width).toBe('100px')
  })

  it('przeciągnięcie przesuwa dźwięk w czasie', () => {
    render(<SfxTrack scale={scale} />)
    const clip = screen.getByRole('button', { name: /dźwięk: krok/i })
    clip.setPointerCapture = () => {}
    clip.releasePointerCapture = () => {}
    firePointer(clip, 'pointerdown', 100)
    firePointer(clip, 'pointermove', 400)
    firePointer(clip, 'pointerup', 400)
    expect(sfxOf('x1')?.startMs).toBe(4000)
  })

  it('dźwięk może sięgać poza swoje ujęcie, ale nie poza materiał', () => {
    render(<SfxTrack scale={scale} />)
    const clip = screen.getByRole('button', { name: /dźwięk: krok/i })
    clip.setPointerCapture = () => {}
    clip.releasePointerCapture = () => {}
    firePointer(clip, 'pointerdown', 100)
    firePointer(clip, 'pointermove', 795)
    firePointer(clip, 'pointerup', 795)
    expect(sfxOf('x1')?.endMs).toBeLessThanOrEqual(8000)
  })
})
```

Trzeci test pilnuje różnicy wobec kamery: dźwięk diegetyczny nie jest ograniczony do ujęcia — żadna reguła tego nie wymaga — więc ograniczeniem jest tylko materiał.

- [ ] **Krok 4: Uruchom oba i zobacz czerwone**

Run: `npm test --workspace @mmh3/web -- screenTextTrack sfxTrack`
Expected: FAIL, brak obu modułów.

- [ ] **Krok 5: Napisz `ScreenTextTrack.tsx`**

```tsx
import { useProject } from '../store/projectStore.js'
import { same, useSelection } from '../store/selectionStore.js'
import { useT } from '../i18n/useT.js'
import { msToPx, type Scale } from './scale.js'
import { clipBox } from './clips.js'
import { shotSpans } from './spans.js'

/**
 * `ScreenText` nie ma własnych czasów — należy do ujęcia i tyle. Klip pokrywa
 * więc rozpiętość ujęcia i nie da się go przeciągnąć. Dokładanie czasów do
 * modelu tylko po to, żeby dało się je przesuwać, zmieniłoby schemat dla
 * wygody rysowania.
 */
export function ScreenTextTrack({ scale }: { scale: Scale }) {
  const t = useT()
  const project = useProject(state => state.project)
  const selected = useSelection(state => state.selected)
  const select = useSelection(state => state.select)

  if (!project) return null

  return (
    <div
      data-track="screen-text"
      aria-label={t('timeline.trackScreenText')}
      className="relative h-8 border-b border-neutral-800"
      style={{ width: msToPx(scale, scale.durationMs) }}
    >
      {shotSpans(project.shots, project.video.durationMs).flatMap(span =>
        span.shot.screenText.map(entry => {
          const ref = { kind: 'screenText' as const, id: entry.id }
          const isSelected = selected.some(candidate => same(candidate, ref))
          return (
            <button
              key={entry.id}
              type="button"
              aria-pressed={isSelected}
              aria-label={t('screenText.clipLabel', { shot: span.shot.index + 1, text: entry.text })}
              onClick={() => select(ref)}
              className={`absolute top-1 h-6 overflow-hidden rounded border px-1 text-left text-[10px] ${
                isSelected
                  ? 'border-amber-500 bg-amber-950 text-amber-100'
                  : 'border-neutral-700 bg-neutral-900 hover:border-neutral-500'
              }`}
              style={clipBox(scale, { id: entry.id, startMs: span.startMs, endMs: span.endMs })}
            >
              {entry.text}
            </button>
          )
        }))}
    </div>
  )
}
```

- [ ] **Krok 6: Napisz `SfxTrack.tsx`**

```tsx
import { useProject } from '../store/projectStore.js'
import { same, useSelection } from '../store/selectionStore.js'
import { useT } from '../i18n/useT.js'
import { msToPx, type Scale } from './scale.js'
import { clipBox } from './clips.js'
import { useDragClip } from './useDragClip.js'
import { shotSpans } from './spans.js'

/**
 * Dźwięk diegetyczny nie jest przywiązany do ujęcia — żadna reguła tego nie
 * wymaga, a krok wchodzący w następne ujęcie jest zwyczajnym zabiegiem
 * montażowym. Ograniczeniem jest więc materiał, nie rozpiętość ujęcia.
 */
export function SfxTrack({ scale }: { scale: Scale }) {
  const t = useT()
  const project = useProject(state => state.project)
  const selected = useSelection(state => state.selected)
  const select = useSelection(state => state.select)

  const sounds = project
    ? shotSpans(project.shots, project.video.durationMs).flatMap(span => span.shot.diegeticSfx)
    : []

  const startDrag = useDragClip(scale, {
    read: id => sounds.find(sound => sound.id === id),
    bounds: () => ({ lowestMs: 0, highestMs: scale.durationMs }),
    snapPoints: () => project
      ? shotSpans(project.shots, project.video.durationMs).map(span => span.startMs)
      : [],
    toleranceMs: 80,
    write: (id, next, coalesceKey) => {
      useProject.getState().apply(
        candidate => ({
          ...candidate,
          shots: candidate.shots.map(shot => ({
            ...shot,
            diegeticSfx: shot.diegeticSfx.map(sound =>
              sound.id === id ? { ...sound, ...next } : sound),
          })),
        }),
        { coalesceKey },
      )
    },
  })

  if (!project) return null

  return (
    <div
      data-track="sfx"
      aria-label={t('timeline.trackSfx')}
      className="relative h-8 border-b border-neutral-800"
      style={{ width: msToPx(scale, scale.durationMs) }}
    >
      {sounds.map(sound => {
        const ref = { kind: 'sfx' as const, id: sound.id }
        const isSelected = selected.some(candidate => same(candidate, ref))
        return (
          <div key={sound.id} className="absolute top-1 h-6" style={clipBox(scale, sound)}>
            <button
              type="button"
              aria-pressed={isSelected}
              aria-label={t('sfx.clipLabel', { description: sound.description })}
              onClick={() => select(ref)}
              onPointerDown={event => startDrag(sound.id, 'move', event)}
              className={`h-full w-full overflow-hidden rounded border px-1 text-left text-[10px] ${
                isSelected
                  ? 'border-cyan-500 bg-cyan-950 text-cyan-100'
                  : 'border-neutral-700 bg-neutral-900 hover:border-neutral-500'
              }`}
            >
              {sound.description}
            </button>
            <button
              type="button"
              aria-label={t('sfx.dragStart', { description: sound.description })}
              onPointerDown={event => startDrag(sound.id, 'start', event)}
              className="absolute inset-y-0 left-0 w-1 cursor-ew-resize bg-cyan-500/40"
            />
            <button
              type="button"
              aria-label={t('sfx.dragEnd', { description: sound.description })}
              onPointerDown={event => startDrag(sound.id, 'end', event)}
              className="absolute inset-y-0 right-0 w-1 cursor-ew-resize bg-cyan-500/40"
            />
          </div>
        )
      })}
    </div>
  )
}
```

Sprawdź, czy `ObjectRef['kind']` w `shared/` dopuszcza `'screenText'` i `'sfx'`. Jeśli nie — dopisz je do tego typu; bez tego zaznaczenie tych obiektów nie skompiluje się, a rzutowanie byłoby obejściem typów, którego ten projekt nie stosuje.

- [ ] **Krok 7: Uruchom i zobacz zielone**

Run: `npm test --workspace @mmh3/web -- screenTextTrack sfxTrack`
Expected: PASS, 6 testów.

- [ ] **Krok 8: Uruchom całość i commit**

```bash
npm test && npm run typecheck
git add web/src/timeline/ScreenTextTrack.tsx web/src/timeline/SfxTrack.tsx web/src/i18n/dict.ts web/test/timeline/screenTextTrack.test.tsx web/test/timeline/sfxTrack.test.tsx
git commit -m "feat: sciezki tekstu na ekranie i dzwiekow diegetycznych"
```

---

### Task 10: Ścieżki pejzażu dźwiękowego i muzyki

Obie opisują całe wideo, nie jego fragment — `project.audio.overallSoundscape` i `nonDiegeticMusic` to pojedyncze pola tekstowe. Ich klipy rozciągają się więc na cały materiał, nie mają krawędzi do przeciągania i służą do dwóch rzeczy: pokazania treści na osi i zaznaczenia, żeby inspektor pokazał pole do pisania.

**Files:**
- Create: `web/src/timeline/AudioBedTracks.tsx`
- Modify: `web/src/i18n/dict.ts`
- Test: `web/test/timeline/audioBedTracks.test.tsx`

**Interfaces:**
- Produces: `<AudioBedTracks scale={Scale} />`

- [ ] **Krok 1: Dodaj klucze słownika**

Polska:

```ts
  'timeline.trackSoundscape': 'Pejzaż dźwiękowy',
  'timeline.trackMusic': 'Muzyka',
  'audio.soundscapeClip': 'Pejzaż dźwiękowy całego wideo',
  'audio.musicClip': 'Muzyka całego wideo',
  'audio.empty': 'nie opisano',
```

angielska:

```ts
  'timeline.trackSoundscape': 'Soundscape',
  'timeline.trackMusic': 'Music',
  'audio.soundscapeClip': 'Soundscape of the whole video',
  'audio.musicClip': 'Music of the whole video',
  'audio.empty': 'not described',
```

- [ ] **Krok 2: Napisz testy**

`web/test/timeline/audioBedTracks.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createScale } from '../../src/timeline/scale.js'
import { AudioBedTracks } from '../../src/timeline/AudioBedTracks.jsx'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { baseProject, emptyShot } from './fixtures.js'

const scale = createScale(8000, 800, 1)

beforeEach(() => {
  useSelection.setState({ selected: [] })
  useProject.getState().load('test', {
    ...baseProject([emptyShot('a', 0, 0)]),
    audio: { overallSoundscape: 'deszcz o szyby', nonDiegeticMusic: '' },
  })
})

describe('AudioBedTracks', () => {
  it('rozciąga oba klipy na cały materiał', () => {
    render(<AudioBedTracks scale={scale} />)
    for (const name of [/pejzaż dźwiękowy całego wideo/i, /muzyka całego wideo/i]) {
      const clip = screen.getByRole('button', { name })
      expect(clip.style.left).toBe('0px')
      expect(clip.style.width).toBe('800px')
    }
  })

  it('pokazuje treść opisu na klipie', () => {
    render(<AudioBedTracks scale={scale} />)
    expect(screen.getByText('deszcz o szyby')).toBeTruthy()
  })

  it('pusty opis oznacza jako nieopisany, zamiast zostawiać pusty klip', () => {
    render(<AudioBedTracks scale={scale} />)
    expect(screen.getByText(/nie opisano/i)).toBeTruthy()
  })

  it('kliknięcie zaznacza pejzaż i muzykę osobno', async () => {
    const user = userEvent.setup()
    render(<AudioBedTracks scale={scale} />)
    await user.click(screen.getByRole('button', { name: /pejzaż dźwiękowy całego wideo/i }))
    expect(useSelection.getState().selected).toEqual([{ kind: 'audio', id: 'soundscape' }])
    await user.click(screen.getByRole('button', { name: /muzyka całego wideo/i }))
    expect(useSelection.getState().selected).toEqual([{ kind: 'audio', id: 'music' }])
  })
})
```

- [ ] **Krok 3: Uruchom i zobacz czerwony**

Run: `npm test --workspace @mmh3/web -- audioBedTracks`
Expected: FAIL, brak modułu.

- [ ] **Krok 4: Napisz `AudioBedTracks.tsx`**

```tsx
import { useProject } from '../store/projectStore.js'
import { same, useSelection } from '../store/selectionStore.js'
import { useT } from '../i18n/useT.js'
import { msToPx, type Scale } from './scale.js'

/**
 * Pejzaż dźwiękowy i muzyka opisują całe wideo, nie jego fragment — w modelu
 * to dwa pola tekstowe, nie obiekty o czasach. Ich klipy nie mają więc krawędzi
 * do przeciągania: pokazują treść i otwierają inspektor. Rysowanie ich jako
 * przeciągalnych sugerowałoby możliwość, której model nie ma.
 */
export function AudioBedTracks({ scale }: { scale: Scale }) {
  const t = useT()
  const project = useProject(state => state.project)
  const selected = useSelection(state => state.selected)
  const select = useSelection(state => state.select)

  if (!project) return null

  const width = msToPx(scale, scale.durationMs)

  const beds = [
    { id: 'soundscape', track: t('timeline.trackSoundscape'), label: t('audio.soundscapeClip'), text: project.audio.overallSoundscape },
    { id: 'music', track: t('timeline.trackMusic'), label: t('audio.musicClip'), text: project.audio.nonDiegeticMusic },
  ]

  return (
    <>
      {beds.map(bed => {
        const ref = { kind: 'audio' as const, id: bed.id }
        const isSelected = selected.some(candidate => same(candidate, ref))
        return (
          <div
            key={bed.id}
            data-track={`audio-${bed.id}`}
            aria-label={bed.track}
            className="relative h-8 border-b border-neutral-800"
            style={{ width }}
          >
            <button
              type="button"
              aria-pressed={isSelected}
              aria-label={bed.label}
              onClick={() => select(ref)}
              className={`absolute top-1 h-6 overflow-hidden rounded border px-2 text-left text-[10px] ${
                isSelected
                  ? 'border-fuchsia-500 bg-fuchsia-950 text-fuchsia-100'
                  : 'border-neutral-700 bg-neutral-900 hover:border-neutral-500'
              }`}
              style={{ left: 0, width }}
            >
              {bed.text === '' ? <span className="text-neutral-500">{t('audio.empty')}</span> : bed.text}
            </button>
          </div>
        )
      })}
    </>
  )
}
```

- [ ] **Krok 5: Uruchom i zobacz zielony, potem całość i commit**

```bash
npm test --workspace @mmh3/web -- audioBedTracks
npm test && npm run typecheck
git add web/src/timeline/AudioBedTracks.tsx web/src/i18n/dict.ts web/test/timeline/audioBedTracks.test.tsx
git commit -m "feat: sciezki pejzazu dzwiekowego i muzyki na calosc materialu"
```

---

### Task 11: Ścieżka REFERENCJE

Widoczna tylko w trybie REF. Dla każdej etykiety pokazuje, w których ujęciach występuje, i pozwala to przełączyć klikając w kratkę — a z tego wynika wprost treść `(appears in [Shot 1], [Shot 3])` w `retention_analysis`. Dziś nic w interfejsie nie ustawia `shot.labelRefs`, więc etykieta zdefiniowana w binie nie ma jak trafić do ujęcia.

**Files:**
- Create: `web/src/timeline/ReferencesTrack.tsx`
- Create: `web/src/timeline/retentionScope.ts`
- Modify: `web/src/i18n/dict.ts`
- Test: `web/test/timeline/retentionScope.test.ts`
- Test: `web/test/timeline/referencesTrack.test.tsx`

**Interfaces:**
- Produces:
  - `scopeForLabel(project: Project, labelId: string): string` — treść nawiasu, pusty ciąg gdy etykieta jest wszędzie albo nigdzie
  - `toggleLabelInShot(project: Project, labelId: string, shotId: string): Project`
  - `<ReferencesTrack scale={Scale} />`

- [ ] **Krok 1: Dodaj klucze słownika**

Polska:

```ts
  'timeline.trackReferences': 'Referencje',
  'references.cell': 'Etykieta {label} w ujęciu {shot}',
  'references.rowLabel': 'Występowanie etykiety {label}',
```

angielska:

```ts
  'timeline.trackReferences': 'References',
  'references.cell': 'Label {label} in shot {shot}',
  'references.rowLabel': 'Occurrences of label {label}',
```

- [ ] **Krok 2: Napisz test zakresu**

`web/test/timeline/retentionScope.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { scopeForLabel, toggleLabelInShot } from '../../src/timeline/retentionScope.js'
import { baseProject, emptyShot } from './fixtures.js'

const withRefs = (a: string[], b: string[], c: string[]) => ({
  ...baseProject([
    { ...emptyShot('a', 0, 0), labelRefs: a },
    { ...emptyShot('b', 1, 3000), labelRefs: b },
    { ...emptyShot('c', 2, 6000), labelRefs: c },
  ]),
  labels: [{ id: 'l1', kind: 'subject' as const, index: 1, assetIds: [], definition: 'kobieta', role: 'bohaterka', standalone: false }],
})

describe('scopeForLabel', () => {
  it('wymienia ujęcia, w których etykieta występuje', () => {
    expect(scopeForLabel(withRefs(['l1'], [], ['l1']), 'l1')).toBe('appears in [Shot 1], [Shot 3]')
  })

  it('nie stawia nawiasu, gdy etykieta jest we wszystkich ujęciach', () => {
    expect(scopeForLabel(withRefs(['l1'], ['l1'], ['l1']), 'l1')).toBe('')
  })

  it('nie stawia nawiasu, gdy etykiety nie ma nigdzie', () => {
    expect(scopeForLabel(withRefs([], [], []), 'l1')).toBe('')
  })

  it('numeruje ujęcia po kolejności na osi, a nie po kolejności w tablicy', () => {
    const project = withRefs([], [], ['l1'])
    const reordered = { ...project, shots: [...project.shots].reverse() }
    expect(scopeForLabel(reordered, 'l1')).toBe('appears in [Shot 3]')
  })
})

describe('toggleLabelInShot', () => {
  it('dokłada etykietę do ujęcia, które jej nie ma', () => {
    const next = toggleLabelInShot(withRefs([], [], []), 'l1', 'b')
    expect(next.shots.find(s => s.id === 'b')?.labelRefs).toEqual(['l1'])
  })

  it('zdejmuje etykietę z ujęcia, które ją ma', () => {
    const next = toggleLabelInShot(withRefs([], ['l1'], []), 'l1', 'b')
    expect(next.shots.find(s => s.id === 'b')?.labelRefs).toEqual([])
  })

  it('przelicza zakres w odpowiadającym wpisie retencji', () => {
    const project = {
      ...withRefs(['l1'], [], []),
      ref: { taskTypes: [], summaryText: '', retention: [{ id: 'r1', labelId: 'l1', scope: '', marker: 'fully_preserved' as const, note: '' }] },
    }
    const next = toggleLabelInShot(project, 'l1', 'c')
    expect(next.ref.retention[0]?.scope).toBe('appears in [Shot 1], [Shot 3]')
  })

  it('nieznane ujęcie zwraca ten sam obiekt', () => {
    const project = withRefs([], [], [])
    expect(toggleLabelInShot(project, 'l1', 'brak')).toBe(project)
  })
})
```

- [ ] **Krok 3: Uruchom i zobacz czerwony**

Run: `npm test --workspace @mmh3/web -- retentionScope`
Expected: FAIL, brak modułu.

- [ ] **Krok 4: Napisz `retentionScope.ts`**

```ts
import type { Project } from '@mmh3/shared'
import { shotSpans } from './spans.js'

/**
 * Treść nawiasu do `retention_analysis`. Guide każe wskazać ujęcia tylko wtedy,
 * gdy etykieta nie dotyczy całego materiału — przy występowaniu wszędzie nawias
 * jest szumem, a przy nieobecności nie ma czego wskazywać.
 *
 * Numeracja idzie po kolejności na osi czasu, nie po pozycji w tablicy: to samo
 * ujęcie musi nazywać się `[Shot 3]` tu i w skompilowanym prompcie.
 */
export function scopeForLabel(project: Project, labelId: string): string {
  const spans = shotSpans(project.shots, project.video.durationMs)
  const numbers = spans
    .map((span, position) => span.shot.labelRefs.includes(labelId) ? position + 1 : null)
    .filter((value): value is number => value !== null)

  if (numbers.length === 0 || numbers.length === spans.length) return ''
  return `appears in ${numbers.map(number => `[Shot ${number}]`).join(', ')}`
}

/**
 * Przełącza obecność etykiety w ujęciu i od razu przelicza zakres w jej wpisie
 * retencji — te dwie rzeczy opisują ten sam fakt, więc rozjazd między nimi
 * byłby widoczny dopiero w gotowym prompcie.
 */
export function toggleLabelInShot(project: Project, labelId: string, shotId: string): Project {
  if (!project.shots.some(shot => shot.id === shotId)) return project

  const shots = project.shots.map(shot => {
    if (shot.id !== shotId) return shot
    const present = shot.labelRefs.includes(labelId)
    return {
      ...shot,
      labelRefs: present
        ? shot.labelRefs.filter(id => id !== labelId)
        : [...shot.labelRefs, labelId],
    }
  })

  const withShots = { ...project, shots }
  return {
    ...withShots,
    ref: {
      ...withShots.ref,
      retention: withShots.ref.retention.map(entry =>
        entry.labelId === labelId ? { ...entry, scope: scopeForLabel(withShots, labelId) } : entry),
    },
  }
}
```

- [ ] **Krok 5: Uruchom i zobacz zielony**

Run: `npm test --workspace @mmh3/web -- retentionScope`
Expected: PASS, 9 testów.

- [ ] **Krok 6: Napisz test ścieżki**

`web/test/timeline/referencesTrack.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createScale } from '../../src/timeline/scale.js'
import { ReferencesTrack } from '../../src/timeline/ReferencesTrack.jsx'
import { useProject } from '../../src/store/projectStore.js'
import { baseProject, emptyShot } from './fixtures.js'

const scale = createScale(8000, 800, 1)

const refProject = (mode: 'REF' | 'T2VA') => ({
  ...baseProject([
    { ...emptyShot('a', 0, 0), labelRefs: ['l1'] },
    { ...emptyShot('b', 1, 4000), labelRefs: [] },
  ]),
  mode,
  labels: [{ id: 'l1', kind: 'subject' as const, index: 1, assetIds: [], definition: 'kobieta', role: 'bohaterka', standalone: false }],
})

beforeEach(() => { useProject.getState().load('test', refProject('REF')) })

describe('ReferencesTrack', () => {
  it('daje każdej etykiecie wiersz z kratką na ujęcie', () => {
    render(<ReferencesTrack scale={scale} />)
    expect(screen.getAllByRole('button', { name: /etykieta <Subject 1> w ujęciu/i })).toHaveLength(2)
  })

  it('kratka pokazuje, czy etykieta występuje w tym ujęciu', () => {
    render(<ReferencesTrack scale={scale} />)
    expect(screen.getByRole('button', { name: /w ujęciu 1/i }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /w ujęciu 2/i }).getAttribute('aria-pressed')).toBe('false')
  })

  it('kliknięcie kratki dokłada etykietę i przelicza zakres', async () => {
    const user = userEvent.setup()
    useProject.getState().load('test', {
      ...refProject('REF'),
      ref: { taskTypes: [], summaryText: '', retention: [{ id: 'r1', labelId: 'l1', scope: '', marker: 'fully_preserved' as const, note: '' }] },
    })
    render(<ReferencesTrack scale={scale} />)
    await user.click(screen.getByRole('button', { name: /w ujęciu 2/i }))
    expect(useProject.getState().project?.ref.retention[0]?.scope).toBe('')
    expect(useProject.getState().project?.shots.find(s => s.id === 'b')?.labelRefs).toEqual(['l1'])
  })

  it('nie pokazuje się poza trybem REF', () => {
    useProject.getState().load('test', refProject('T2VA'))
    const { container } = render(<ReferencesTrack scale={scale} />)
    expect(container.firstChild).toBeNull()
  })
})
```

Trzeci test celowo oczekuje **pustego** zakresu: po dołożeniu etykiety do drugiego z dwóch ujęć występuje ona wszędzie, więc nawias znika. To ta sama reguła, którą pinuje test czystej funkcji, sprawdzona tu przez interfejs.

- [ ] **Krok 7: Napisz `ReferencesTrack.tsx`**

```tsx
import { useProject } from '../store/projectStore.js'
import { useT } from '../i18n/useT.js'
import { msToPx, type Scale } from './scale.js'
import { clipBox } from './clips.js'
import { shotSpans } from './spans.js'
import { toggleLabelInShot } from './retentionScope.js'

const FAMILY_PREFIX: Record<string, string> = {
  subject: 'Subject', picture: 'Picture', video: 'Video', audio: 'Audio',
}

/**
 * Ścieżka istnieje tylko w trybie REF, bo tylko tam etykiety mają sens — poza
 * nim `labelRefs` nie trafia do promptu i pokazywanie kratek sugerowałoby
 * działanie, którego nie ma.
 */
export function ReferencesTrack({ scale }: { scale: Scale }) {
  const t = useT()
  const project = useProject(state => state.project)

  if (!project || project.mode !== 'REF') return null

  const spans = shotSpans(project.shots, project.video.durationMs)

  return (
    <>
      {project.labels.map(label => {
        const name = `<${FAMILY_PREFIX[label.kind] ?? label.kind} ${label.index}>`
        return (
          <div
            key={label.id}
            data-track={`references-${label.id}`}
            aria-label={t('references.rowLabel', { label: name })}
            className="relative h-6 border-b border-neutral-800"
            style={{ width: msToPx(scale, scale.durationMs) }}
          >
            {spans.map((span, position) => {
              const present = span.shot.labelRefs.includes(label.id)
              return (
                <button
                  key={span.shot.id}
                  type="button"
                  aria-pressed={present}
                  aria-label={t('references.cell', { label: name, shot: position + 1 })}
                  onClick={() => useProject.getState().apply(
                    candidate => toggleLabelInShot(candidate, label.id, span.shot.id))}
                  className={`absolute top-1 h-4 rounded-sm border ${
                    present
                      ? 'border-teal-400 bg-teal-500/60'
                      : 'border-neutral-700 bg-neutral-900 hover:border-neutral-500'
                  }`}
                  style={clipBox(scale, { id: span.shot.id, startMs: span.startMs, endMs: span.endMs })}
                />
              )
            })}
          </div>
        )
      })}
    </>
  )
}
```

- [ ] **Krok 8: Uruchom i zobacz zielony, potem całość i commit**

```bash
npm test --workspace @mmh3/web -- referencesTrack retentionScope
npm test && npm run typecheck
git add web/src/timeline/ReferencesTrack.tsx web/src/timeline/retentionScope.ts web/src/i18n/dict.ts web/test/timeline/referencesTrack.test.tsx web/test/timeline/retentionScope.test.ts
git commit -m "feat: sciezka referencji zasilajaca zakres w retention_analysis"
```

---

### Task 12: Stos ścieżek — nagłówki, zwijanie, wspólne przewijanie

Dziewięć rodzajów ścieżek nie zmieści się w pasku o stałej wysokości, a każda potrzebuje podpisu po lewej, który **nie** przewija się razem z materiałem. Ten task składa je w jeden stos: kolumna nagłówków stoi, obszar klipów przewija się poziomo, a linijka i playhead idą razem z nim.

**Files:**
- Create: `web/src/timeline/TrackStack.tsx`
- Modify: `web/src/timeline/Timeline.tsx`
- Modify: `web/src/i18n/dict.ts`
- Test: `web/test/timeline/trackStack.test.tsx`

**Interfaces:**
- Produces: `<TrackStack scale={Scale} />` — składa wszystkie ścieżki z nagłówkami

- [ ] **Krok 1: Dodaj klucze słownika**

Polska:

```ts
  'timeline.collapse': 'Zwiń ścieżkę {track}',
  'timeline.expand': 'Rozwiń ścieżkę {track}',
  'timeline.tracks': 'Ścieżki osi czasu',
```

angielska:

```ts
  'timeline.collapse': 'Collapse track {track}',
  'timeline.expand': 'Expand track {track}',
  'timeline.tracks': 'Timeline tracks',
```

- [ ] **Krok 2: Napisz testy**

`web/test/timeline/trackStack.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createScale } from '../../src/timeline/scale.js'
import { TrackStack } from '../../src/timeline/TrackStack.jsx'
import { useProject } from '../../src/store/projectStore.js'
import { baseProject, emptyShot } from './fixtures.js'

const scale = createScale(8000, 800, 1)

beforeEach(() => {
  useProject.getState().load('test', baseProject([emptyShot('a', 0, 0)]))
})

describe('TrackStack', () => {
  it('pokazuje nagłówek każdej widocznej ścieżki', () => {
    render(<TrackStack scale={scale} />)
    for (const name of [/^ujęcia$/i, /^kamera$/i, /^tekst na ekranie$/i, /^sfx$/i, /^pejzaż dźwiękowy$/i, /^muzyka$/i]) {
      expect(screen.getByText(name)).toBeTruthy()
    }
  })

  it('nie pokazuje referencji poza trybem REF', () => {
    render(<TrackStack scale={scale} />)
    expect(screen.queryByText(/^referencje$/i)).toBeNull()
  })

  it('pokazuje referencje w trybie REF', () => {
    useProject.getState().load('test', { ...baseProject([emptyShot('a', 0, 0)]), mode: 'REF' })
    render(<TrackStack scale={scale} />)
    expect(screen.getByText(/^referencje$/i)).toBeTruthy()
  })

  it('zwinięcie ścieżki chowa jej klipy, ale zostawia nagłówek', async () => {
    const user = userEvent.setup()
    render(<TrackStack scale={scale} />)
    await user.click(screen.getByRole('button', { name: /zwiń ścieżkę kamera/i }))
    expect(screen.getByText(/^kamera$/i)).toBeTruthy()
    expect(screen.queryByLabelText(/^kamera$/i)).toBeNull()
  })

  it('zwinięcie i rozwinięcie wraca do stanu wyjściowego', async () => {
    const user = userEvent.setup()
    render(<TrackStack scale={scale} />)
    await user.click(screen.getByRole('button', { name: /zwiń ścieżkę kamera/i }))
    await user.click(screen.getByRole('button', { name: /rozwiń ścieżkę kamera/i }))
    expect(screen.getByLabelText(/^kamera$/i)).toBeTruthy()
  })

  it('nagłówki nie przewijają się razem z klipami', () => {
    const { container } = render(<TrackStack scale={scale} />)
    const scroller = container.querySelector('[data-scroller]')
    const headers = container.querySelector('[data-headers]')
    expect(scroller).not.toBeNull()
    expect(headers).not.toBeNull()
    expect(scroller?.contains(headers ?? null)).toBe(false)
  })
})
```

- [ ] **Krok 3: Uruchom i zobacz czerwony**

Run: `npm test --workspace @mmh3/web -- trackStack`
Expected: FAIL, brak modułu.

- [ ] **Krok 4: Napisz `TrackStack.tsx`**

```tsx
import { useState } from 'react'
import { useProject } from '../store/projectStore.js'
import { useT } from '../i18n/useT.js'
import type { Scale } from './scale.js'
import { ShotTrack } from './ShotTrack.jsx'
import { CameraTrack } from './CameraTrack.jsx'
import { DialogueTracks } from './DialogueTracks.jsx'
import { ScreenTextTrack } from './ScreenTextTrack.jsx'
import { SfxTrack } from './SfxTrack.jsx'
import { AudioBedTracks } from './AudioBedTracks.jsx'
import { ReferencesTrack } from './ReferencesTrack.jsx'

/**
 * Nagłówki stoją poza obszarem przewijanym, bo podpis ścieżki musi być widoczny
 * także wtedy, gdy materiał jest przewinięty w prawo. Wysokości obu kolumn
 * muszą się zgadzać wiersz w wiersz — stąd jedna lista opisująca oba boki naraz
 * zamiast dwóch osobnych.
 */
export function TrackStack({ scale }: { scale: Scale }) {
  const t = useT()
  const project = useProject(state => state.project)
  const [collapsed, setCollapsed] = useState<string[]>([])

  if (!project) return null

  const rows = [
    { key: 'shots', title: t('timeline.trackShots'), height: 'h-10', render: () => <ShotTrack scale={scale} /> },
    { key: 'camera', title: t('timeline.trackCamera'), height: 'h-8', render: () => <CameraTrack scale={scale} /> },
    { key: 'dialogue', title: t('timeline.trackDialogueAll'), height: 'h-8', render: () => <DialogueTracks scale={scale} /> },
    { key: 'screenText', title: t('timeline.trackScreenText'), height: 'h-8', render: () => <ScreenTextTrack scale={scale} /> },
    { key: 'sfx', title: t('timeline.trackSfx'), height: 'h-8', render: () => <SfxTrack scale={scale} /> },
    { key: 'audio', title: t('timeline.trackSoundscape'), height: 'h-8', render: () => <AudioBedTracks scale={scale} /> },
    ...(project.mode === 'REF'
      ? [{ key: 'references', title: t('timeline.trackReferences'), height: 'h-6', render: () => <ReferencesTrack scale={scale} /> }]
      : []),
  ]

  const isCollapsed = (key: string) => collapsed.includes(key)
  const toggle = (key: string) => setCollapsed(current =>
    current.includes(key) ? current.filter(entry => entry !== key) : [...current, key])

  return (
    <div aria-label={t('timeline.tracks')} className="flex">
      <div data-headers className="w-32 shrink-0 border-r border-neutral-800">
        {rows.map(row => (
          <div key={row.key} className="flex items-center justify-between border-b border-neutral-800 px-2 py-1 text-[10px]">
            <span>{row.title}</span>
            <button
              type="button"
              aria-label={isCollapsed(row.key)
                ? t('timeline.expand', { track: row.title })
                : t('timeline.collapse', { track: row.title })}
              onClick={() => toggle(row.key)}
              className="px-1 text-neutral-400 hover:text-neutral-100"
            >
              {isCollapsed(row.key) ? '▸' : '▾'}
            </button>
          </div>
        ))}
      </div>
      <div data-scroller className="flex-1 overflow-x-auto">
        {rows.map(row => (
          <div key={row.key}>{isCollapsed(row.key) ? null : row.render()}</div>
        ))}
      </div>
    </div>
  )
}
```

Klucz `timeline.trackDialogueAll` jeszcze nie istnieje — dopisz go do słownika („Dialogi" / „Dialogue"), bo `timeline.trackDialogue` przyjmuje parametr mówcy i nie nadaje się na tytuł grupy.

Wysokości wierszy w nagłówku i w obszarze klipów rozjadą się, gdy pas dialogów urośnie o mówcę — nagłówek ma jeden wiersz, a `DialogueTracks` rysuje ich tylu, ilu mówców. **Zatrzymaj się i zgłoś to**, zamiast dopasowywać na oko: to prawdziwy problem projektowy tego zadania i chcę o nim wiedzieć, zanim wybierzesz rozwiązanie.

- [ ] **Krok 5: Wstaw stos do `Timeline.tsx`**

Zamień bezpośrednie renderowanie `ShotTrack` w `Timeline.tsx` na `TrackStack`. Linijka i playhead zostają tam, gdzie są — playhead ma przecinać wszystkie ścieżki, więc jego kontener musi obejmować cały stos, a nie pojedynczą ścieżkę. Sprawdź w `web/test/timeline/timeline.test.tsx`, czy któryś test nie liczył na `ShotTrack` bezpośrednio pod `Timeline`.

- [ ] **Krok 6: Uruchom i zobacz zielony**

Run: `npm test --workspace @mmh3/web`
Expected: PASS w całości.

- [ ] **Krok 7: Commit**

```bash
npm test && npm run typecheck
git add web/src/timeline/TrackStack.tsx web/src/timeline/Timeline.tsx web/src/i18n/dict.ts web/test/timeline/trackStack.test.tsx web/test/timeline/timeline.test.tsx
git commit -m "feat: stos sciezek z naglowkami poza obszarem przewijania"
```

---

### Task 13: Test end-to-end przez nowe ścieżki

Ostatnie zadanie planu. Jsdom nie ma silnika układu, nie honoruje `pointer-events` ani warstw przy roznoszeniu zdarzeń i pozwala testowi samemu wybrać odstępy klatek — Plan 3 zapłacił za to odtwarzaniem, które przechodziło wszystkie testy jednostkowe i w przeglądarce stało w miejscu. Ten test sprawdza w prawdziwym Chromium to, czego tamte sprawdzić nie mogą.

**Files:**
- Modify: `web/e2e/happyPath.spec.ts`
- Test: `web/e2e/tracks.spec.ts`

- [ ] **Krok 1: Napisz scenariusz**

`web/e2e/tracks.spec.ts` — nowy plik, żeby nie rozdymać ścieżki podstawowej:

```ts
import { expect, test } from '@playwright/test'

/**
 * Interfejs startuje po polsku, więc selektory celują w polskie nazwy
 * dostępności ze słownika. Przełączenie domyślnego języka sprawi, że przestaną
 * cokolwiek znajdować — to zamierzone: test ma wtedy paść, a nie przejść po
 * cichu na innym elemencie.
 */
test('praca na ścieżkach kamery, dialogu i referencji', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /nowy projekt/i }).click()
  await page.getByRole('button', { name: /^T2VA/ }).click()

  // Podział daje drugie ujęcie, więc ścieżki mają na czym pracować.
  await page.getByRole('slider', { name: /linijka/i }).click({ position: { x: 400, y: 8 } })
  await page.keyboard.press('s')
  await expect(page.getByRole('button', { name: /^ujęcie 2/i })).toBeVisible()

  // Nagłówki ścieżek stoją, choć obszar klipów da się przewinąć.
  await expect(page.getByText('Kamera', { exact: true })).toBeVisible()
  await expect(page.getByText('SFX', { exact: true })).toBeVisible()

  // Zwinięcie chowa klipy i zostawia nagłówek.
  await page.getByRole('button', { name: /zwiń ścieżkę kamera/i }).click()
  await expect(page.getByText('Kamera', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /rozwiń ścieżkę kamera/i }).click()
})
```

Sprawdź w `web/e2e/happyPath.spec.ts`, jak nazywają się przyciski tworzenia projektu i wyboru trybu — użyj tych nazw, nie zgadywanych.

- [ ] **Krok 2: Dopisz do scenariusza przeciągnięcie prawdziwym wskaźnikiem**

Po podziale dołóż ruch kamery przez interfejs, a potem przeciągnij jego krawędź prawdziwymi zdarzeniami wskaźnika (`page.mouse.move`, `down`, `move`, `up`) i sprawdź, że prompt się zmienił. Jeśli w interfejsie nie ma jeszcze przycisku dodającego ruch kamery, **zatrzymaj się i zgłoś** — to znaczy, że ścieżka kamery umie rysować i przeciągać, ale nie umie niczego stworzyć, i brakuje kroku, którego żaden task w tym planie nie objął.

- [ ] **Krok 3: Uruchom dwa razy pod rząd**

Run: `npm run e2e` (dwukrotnie)
Expected: oba przebiegi zielone. Konfiguracja czyści `/tmp/mmh3-e2e` w `globalSetup` i startuje serwer z `reuseExistingServer: false` — jeśli drugi przebieg pada, to znaczy, że nowy scenariusz zostawia po sobie stan, i trzeba to naprawić, a nie obejść.

- [ ] **Krok 4: Uruchom całość i commit**

```bash
npm test && npm run typecheck && npm run e2e --workspace @mmh3/web
git add web/e2e/tracks.spec.ts web/e2e/happyPath.spec.ts
git commit -m "test: scenariusz e2e przez sciezki kamery, dialogu i referencji"
```

---

### Task 14: Tworzenie i usuwanie obiektów na ścieżkach

Zadania 5–11 uczą ścieżki rysować i przeciągać to, co w modelu już jest. Nowy projekt nie ma jednak ani jednego ruchu kamery, kwestii, tekstu ani dźwięku — bez tego zadania wszystkie te ścieżki są w praktyce puste i nie da się ich zapełnić inaczej niż ręczną edycją `project.json`. To luka wykryta przy przeglądzie planu, a nie osobna funkcja: ścieżka, na której nic nie można stworzyć, nie jest skończona.

Wzorem jest istniejący przycisk „Dodaj ujęcie" w `Timeline.tsx` — nowy obiekt powstaje **na playheadzie**, bo to jedyne miejsce, o którym wiadomo, że użytkownik właśnie na nie patrzy.

**Files:**
- Create: `web/src/timeline/createOnTrack.ts`
- Modify: `web/src/timeline/CameraTrack.tsx`
- Modify: `web/src/timeline/DialogueTracks.tsx`
- Modify: `web/src/timeline/ScreenTextTrack.tsx`
- Modify: `web/src/timeline/SfxTrack.tsx`
- Modify: `web/src/timeline/useTimelineShortcuts.ts`
- Modify: `web/src/i18n/dict.ts`
- Test: `web/test/timeline/createOnTrack.test.ts`
- Test: `web/test/timeline/trackCreation.test.tsx`

**Interfaces:**
- Produces:
  - `addCameraMove(project: Project, atMs: number): Project`
  - `addDialogue(project: Project, atMs: number, speakerId: string | null): Project`
  - `addScreenText(project: Project, atMs: number): Project`
  - `addSfx(project: Project, atMs: number): Project`
  - `removeSelected(project: Project, selected: ObjectRef[]): Project`

- [ ] **Krok 1: Dodaj klucze słownika**

Polska:

```ts
  'track.addCamera': 'Dodaj ruch kamery na playheadzie',
  'track.addDialogue': 'Dodaj kwestię na playheadzie',
  'track.addScreenText': 'Dodaj tekst na ekranie w tym ujęciu',
  'track.addSfx': 'Dodaj dźwięk na playheadzie',
  'track.newDialogue': 'nowa kwestia',
  'track.newScreenText': 'TEKST',
  'track.newSfx': 'nowy dźwięk',
```

angielska:

```ts
  'track.addCamera': 'Add camera move at the playhead',
  'track.addDialogue': 'Add line at the playhead',
  'track.addScreenText': 'Add on-screen text in this shot',
  'track.addSfx': 'Add sound at the playhead',
  'track.newDialogue': 'new line',
  'track.newScreenText': 'TEXT',
  'track.newSfx': 'new sound',
```

Trzy ostatnie klucze to treść **modelu**, nie interfejsu, a model idzie do promptu po angielsku. Wstaw je do słownika mimo to i użyj wersji angielskiej niezależnie od wybranego języka — inaczej polski interfejs wstawiałby polskie słowa do promptu, który musi być angielski. Zapisz ten powód w komentarzu przy użyciu.

- [ ] **Krok 2: Napisz test czystych funkcji**

`web/test/timeline/createOnTrack.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MS_PER_FRAME } from '@mmh3/shared'
import {
  addCameraMove, addDialogue, addScreenText, addSfx, removeSelected,
} from '../../src/timeline/createOnTrack.js'
import { baseProject, emptyShot } from './fixtures.js'

const twoShots = () => baseProject([emptyShot('a', 0, 0), emptyShot('b', 1, 4000)])

describe('addCameraMove', () => {
  it('wkłada ruch do ujęcia, na które wskazuje playhead', () => {
    const next = addCameraMove(twoShots(), 5000)
    expect(next.shots.find(s => s.id === 'a')?.cameraMoves).toHaveLength(0)
    expect(next.shots.find(s => s.id === 'b')?.cameraMoves).toHaveLength(1)
  })

  it('nowy ruch mieści się w swoim ujęciu', () => {
    const next = addCameraMove(twoShots(), 5000)
    const move = next.shots.find(s => s.id === 'b')?.cameraMoves[0]
    expect(move?.startMs).toBeGreaterThanOrEqual(4000)
    expect(move?.endMs).toBeLessThanOrEqual(8000)
  })

  it('nowy ruch leży na siatce klatek', () => {
    const move = addCameraMove(twoShots(), 5010).shots.find(s => s.id === 'b')?.cameraMoves[0]
    for (const ms of [move?.startMs ?? 0, move?.endMs ?? 0]) {
      expect(ms).toBe(Math.round(Math.round(ms / MS_PER_FRAME) * MS_PER_FRAME))
    }
  })

  it('dwa ruchy dodane w tym samym miejscu mają różne identyfikatory', () => {
    const once = addCameraMove(twoShots(), 5000)
    const twice = addCameraMove(once, 5000)
    const ids = twice.shots.flatMap(s => s.cameraMoves).map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('playhead poza jakimkolwiek ujęciem zwraca ten sam obiekt', () => {
    const project = { ...twoShots(), shots: [] }
    expect(addCameraMove(project, 5000)).toBe(project)
  })
})

describe('addDialogue', () => {
  it('przypisuje kwestię wskazanemu mówcy', () => {
    const next = addDialogue(twoShots(), 1000, 's1')
    expect(next.shots.flatMap(s => s.dialogue)[0]?.speakerIds).toEqual(['s1'])
  })

  it('bez mówcy tworzy kwestię bez przypisania', () => {
    const next = addDialogue(twoShots(), 1000, null)
    expect(next.shots.flatMap(s => s.dialogue)[0]?.speakerIds).toEqual([])
  })

  it('treść nowej kwestii jest po angielsku, bo idzie do promptu', () => {
    const next = addDialogue(twoShots(), 1000, null)
    expect(next.shots.flatMap(s => s.dialogue)[0]?.text).toBe('new line')
  })
})

describe('addScreenText i addSfx', () => {
  it('tekst trafia do ujęcia spod playheada', () => {
    const next = addScreenText(twoShots(), 5000)
    expect(next.shots.find(s => s.id === 'b')?.screenText).toHaveLength(1)
  })

  it('dźwięk dostaje czasy zaczynające się na playheadzie', () => {
    const sound = addSfx(twoShots(), 5000).shots.flatMap(s => s.diegeticSfx)[0]
    expect(sound?.startMs).toBe(5000)
    expect(sound?.endMs).toBeGreaterThan(5000)
  })

  it('dźwięk przy samym końcu materiału nie wychodzi poza niego', () => {
    const sound = addSfx(twoShots(), 7990).shots.flatMap(s => s.diegeticSfx)[0]
    expect(sound?.endMs).toBeLessThanOrEqual(8000)
  })
})

describe('removeSelected', () => {
  it('usuwa ruch kamery po referencji', () => {
    const withMove = addCameraMove(twoShots(), 5000)
    const moveId = withMove.shots.flatMap(s => s.cameraMoves)[0]?.id ?? ''
    const next = removeSelected(withMove, [{ kind: 'camera', id: moveId }])
    expect(next.shots.flatMap(s => s.cameraMoves)).toHaveLength(0)
  })

  it('usuwa kilka obiektów różnych rodzajów naraz', () => {
    const withBoth = addSfx(addCameraMove(twoShots(), 5000), 1000)
    const moveId = withBoth.shots.flatMap(s => s.cameraMoves)[0]?.id ?? ''
    const soundId = withBoth.shots.flatMap(s => s.diegeticSfx)[0]?.id ?? ''
    const next = removeSelected(withBoth, [
      { kind: 'camera', id: moveId }, { kind: 'sfx', id: soundId },
    ])
    expect(next.shots.flatMap(s => s.cameraMoves)).toHaveLength(0)
    expect(next.shots.flatMap(s => s.diegeticSfx)).toHaveLength(0)
  })

  it('puste zaznaczenie zwraca ten sam obiekt', () => {
    const project = twoShots()
    expect(removeSelected(project, [])).toBe(project)
  })

  it('zaznaczenie samych ujęć zostawia je nietknięte, bo od tego jest osobna operacja', () => {
    const project = twoShots()
    expect(removeSelected(project, [{ kind: 'shot', id: 'a' }])).toBe(project)
  })
})
```

Ostatni test pilnuje podziału odpowiedzialności: ujęcia usuwa `removeShots` z `shotOperations.ts`, które umie utrzymać niezmienniki listy ujęć. Dublowanie tego tutaj rozjechałoby obie ścieżki.

- [ ] **Krok 3: Uruchom i zobacz czerwony**

Run: `npm test --workspace @mmh3/web -- createOnTrack`
Expected: FAIL, brak modułu.

- [ ] **Krok 4: Napisz `createOnTrack.ts`**

```ts
import { MS_PER_FRAME, snapToFrame, type ObjectRef, type Project } from '@mmh3/shared'
import { shotSpans } from './spans.js'

/** Domyślna długość nowego obiektu: sekunda, przycięta do tego, co zostało. */
const DEFAULT_LENGTH_MS = 1000

const frameIndexOf = (ms: number): number => Math.round(ms / MS_PER_FRAME)
const msOfFrameIndex = (frame: number): number => Math.round(frame * MS_PER_FRAME)

/**
 * Identyfikator z maksimum istniejących, nie z ich liczby. Numeracja po liczbie
 * wraca do wcześniejszej wartości po usunięciu obiektu i produkuje duplikat, a
 * duplikat sprawia, że gest wymierzony w jeden obiekt trafia we wszystkie o tym
 * samym identyfikatorze — zmierzone w recenzji Planu 3 na czasach cięcia.
 */
function nextId(prefix: string, existing: string[]): string {
  const pattern = new RegExp(`^${prefix}-(\d+)$`)
  const highest = existing.reduce((best, id) => {
    const match = pattern.exec(id)
    const value = match?.[1] === undefined ? 0 : Number.parseInt(match[1], 10)
    return Number.isFinite(value) && value > best ? value : best
  }, 0)
  return `${prefix}-${highest + 1}`
}

const spanAt = (project: Project, atMs: number) =>
  shotSpans(project.shots, project.video.durationMs)
    .find(span => atMs >= span.startMs && atMs < span.endMs)

/** Zakres nowego obiektu: od playheada, sekunda długości, przycięte do granicy. */
function rangeFrom(atMs: number, highestMs: number): { startMs: number; endMs: number } {
  const startFrame = frameIndexOf(snapToFrame(atMs))
  const highestFrame = frameIndexOf(highestMs)
  const endFrame = Math.min(highestFrame, startFrame + frameIndexOf(DEFAULT_LENGTH_MS))
  const safeStart = Math.min(startFrame, endFrame - 2)
  return { startMs: msOfFrameIndex(Math.max(0, safeStart)), endMs: msOfFrameIndex(endFrame) }
}

export function addCameraMove(project: Project, atMs: number): Project {
  const span = spanAt(project, atMs)
  if (!span) return project
  const range = rangeFrom(Math.max(atMs, span.startMs), span.endMs)
  const id = nextId('move', project.shots.flatMap(shot => shot.cameraMoves).map(move => move.id))

  return {
    ...project,
    shots: project.shots.map(shot => shot.id === span.shot.id
      ? { ...shot, cameraMoves: [...shot.cameraMoves, { id, type: 'static' as const, ...range }] }
      : shot),
  }
}

export function addDialogue(project: Project, atMs: number, speakerId: string | null): Project {
  const span = spanAt(project, atMs)
  if (!span) return project
  const range = rangeFrom(Math.max(atMs, span.startMs), project.video.durationMs)
  const id = nextId('line', project.shots.flatMap(shot => shot.dialogue).map(event => event.id))

  return {
    ...project,
    shots: project.shots.map(shot => shot.id === span.shot.id
      ? {
          ...shot,
          dialogue: [...shot.dialogue, {
            id,
            speakerIds: speakerId === null ? [] : [speakerId],
            verb: 'says',
            punctuation: ':' as const,
            language: 'English',
            // Treść modelu, nie interfejsu — prompt jest po angielsku niezależnie
            // od języka aplikacji, więc nie idzie przez słownik użytkownika.
            text: 'new line',
            voiceover: false,
            sceneTransBefore: false,
            sceneTransAfter: false,
            cutoff: false,
            ...range,
          }],
        }
      : shot),
  }
}

export function addScreenText(project: Project, atMs: number): Project {
  const span = spanAt(project, atMs)
  if (!span) return project
  const id = nextId('text', project.shots.flatMap(shot => shot.screenText).map(entry => entry.id))

  return {
    ...project,
    shots: project.shots.map(shot => shot.id === span.shot.id
      ? { ...shot, screenText: [...shot.screenText, { id, text: 'TEXT' }] }
      : shot),
  }
}

export function addSfx(project: Project, atMs: number): Project {
  const span = spanAt(project, atMs)
  if (!span) return project
  const range = rangeFrom(atMs, project.video.durationMs)
  const id = nextId('sfx', project.shots.flatMap(shot => shot.diegeticSfx).map(sound => sound.id))

  return {
    ...project,
    shots: project.shots.map(shot => shot.id === span.shot.id
      ? { ...shot, diegeticSfx: [...shot.diegeticSfx, { id, description: 'new sound', ...range }] }
      : shot),
  }
}

/**
 * Usuwa obiekty ścieżek po referencji zaznaczenia. Ujęć celowo nie rusza —
 * od nich jest `removeShots`, które umie utrzymać niezmienniki listy ujęć,
 * a druga implementacja tego samego rozjechałaby się z pierwszą.
 */
export function removeSelected(project: Project, selected: ObjectRef[]): Project {
  const ids = (kind: string) => selected.filter(ref => ref.kind === kind).map(ref => ref.id)
  const cameras = ids('camera')
  const lines = ids('dialogue')
  const texts = ids('screenText')
  const sounds = ids('sfx')
  if (cameras.length + lines.length + texts.length + sounds.length === 0) return project

  return {
    ...project,
    shots: project.shots.map(shot => ({
      ...shot,
      cameraMoves: shot.cameraMoves.filter(move => !cameras.includes(move.id)),
      dialogue: shot.dialogue.filter(event => !lines.includes(event.id)),
      screenText: shot.screenText.filter(entry => !texts.includes(entry.id)),
      diegeticSfx: shot.diegeticSfx.filter(sound => !sounds.includes(sound.id)),
    })),
  }
}
```

- [ ] **Krok 5: Uruchom i zobacz zielony**

Run: `npm test --workspace @mmh3/web -- createOnTrack`
Expected: PASS, 15 testów.

- [ ] **Krok 6: Dołóż przyciski do ścieżek**

Każda z czterech ścieżek dostaje jeden przycisk dodawania, umieszczony w nagłówku wiersza — nie na obszarze klipów, gdzie kolidowałby z zaznaczaniem. Ponieważ nagłówki żyją w `TrackStack` (zadanie 12), a to zadanie może iść przed nim, wstaw przyciski **do samych ścieżek**, w lewym górnym rogu, i w zadaniu 12 przenieś je do nagłówka razem z resztą.

Wzór dla `CameraTrack.tsx` (pozostałe trzy analogicznie, ze swoją funkcją i swoim kluczem słownika — powtórz kod zamiast go uogólniać, dopóki nie widać, że wszystkie cztery naprawdę robią to samo):

```tsx
      <button
        type="button"
        aria-label={t('track.addCamera')}
        onClick={() => useProject.getState().apply(
          candidate => addCameraMove(candidate, usePlayhead.getState().ms))}
        className="absolute left-0 top-0 z-10 px-1 text-[10px] text-neutral-400 hover:text-neutral-100"
      >
        +
      </button>
```

Sprawdź w `web/src/store/playheadStore.ts`, jak faktycznie nazywa się pole czasu (`ms` czy `playheadMs`) i użyj właściwej nazwy.

- [ ] **Krok 7: Podłącz usuwanie pod Delete**

`useTimelineShortcuts` obsługuje dziś `Delete` przez `removeShots`. Rozszerz to: gdy zaznaczenie zawiera obiekty ścieżek, usuń je przez `removeSelected`; gdy zawiera ujęcia, zostaw dotychczasową drogę. Jedno naciśnięcie klawisza to nadal jeden wpis historii, także gdy zaznaczenie miesza rodzaje.

- [ ] **Krok 8: Napisz test interfejsu**

`web/test/timeline/trackCreation.test.tsx`: wyrenderuj `CameraTrack`, ustaw playhead na 5000, kliknij przycisk dodawania i sprawdź, że na ścieżce pojawił się klip; potem zaznacz go, naciśnij `Delete` i sprawdź, że zniknął, a historia ma dwa wpisy. Powtórz dla `SfxTrack`. Użyj `firePointer` i `userEvent.setup()` zgodnie z ograniczeniami globalnymi.

- [ ] **Krok 9: Uruchom całość i commit**

```bash
npm test && npm run typecheck
git add web/src/timeline/createOnTrack.ts web/src/timeline/CameraTrack.tsx web/src/timeline/DialogueTracks.tsx web/src/timeline/ScreenTextTrack.tsx web/src/timeline/SfxTrack.tsx web/src/timeline/useTimelineShortcuts.ts web/src/i18n/dict.ts web/test/timeline/createOnTrack.test.ts web/test/timeline/trackCreation.test.tsx
git commit -m "feat: tworzenie i usuwanie obiektow na sciezkach z playheada"
```

---

## Uwaga o kolejności

Zadania 1–3 spłacają dług i nie zależą od siebie nawzajem. Zadanie 4 musi poprzedzać 5–11, bo wszystkie stoją na `useDragClip` i `clipBox`. Zadania 5–11 są od siebie niezależne i mogą iść w dowolnej kolejności. Zadanie **14 wykonuje się po 5–11 i przed 12** — dokłada przyciski do tych ścieżek, a zadanie 12 przenosi je do nagłówków. Zadanie 12 wymaga wszystkich ścieżek, 13 wymaga 12 i 14.

Zadanie 13 sprawdza w prawdziwej przeglądarce to, czego jsdom sprawdzić nie może, więc jest ostatnie mimo że kolejność w numeracji sugeruje inaczej.
