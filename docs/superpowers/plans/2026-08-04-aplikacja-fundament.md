# MMH3 Prompt Studio — Plan 2: aplikacja (fundament)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zbudować działającą lokalną aplikację webową wokół gotowego rdzenia: backend z persystencją projektów i assetów, powłokę frontendu z dwujęzycznym interfejsem, ekran wyboru trybu, panel promptu na żywo, klikalny panel walidacji, inspektor ujęcia i eksport — łącznie z workflow ComfyUI.

**Architecture:** Trzy pakiety w jednym workspace: `shared/` (gotowy rdzeń — model, kompilator, walidator), `server/` (Fastify, persystencja na folderach, assety, eksport) i `web/` (React + Vite). Backend nie zna Reacta, frontend nie zna systemu plików, oba importują `@mmh3/shared`. Projekt żyje w stanie Zustanda z warstwą undo; każda zmiana przelicza prompt i diagnostykę przez `buildPrompt`, bo to czysta i szybka funkcja.

**Tech Stack:** TypeScript 5, Fastify 5, Zod 3, sharp, React 18, Vite 5, Zustand 4, Tailwind 3, Vitest 3, Playwright.

## Global Constraints

- Pakiet `shared/` jest **zamknięty** dla tego planu poza zadaniem 1. Żadne późniejsze zadanie nie zmienia jego kodu.
- Pięć testów złotych w `shared/test/golden/` musi pozostać zielone przez cały plan. Nie wolno ich modyfikować ani osłabiać żadnej ich asercji. Plik oczekiwany jest kopią dokumentacji dostawcy i nigdy nie jest zmienną.
- `shared/src/` nie importuje Reacta ani `node:*` — jedynym wyjątkiem jest `shared/src/cli.ts`. Program `tsconfig.json` pakietu `shared` ma `types: []` i to egzekwuje.
- Backend nie importuje niczego z `web/`; frontend nie importuje niczego z `server/`.
- Porty: **5173** dla interfejsu, **8899** dla API. Oba zweryfikowane jako wolne na maszynie docelowej.
- Katalog danych: `~/mmh3-studio/projects/<slug>/`. Jest w `.gitignore` i nigdy nie trafia do repozytorium.
- Cały tekst widoczny dla użytkownika przechodzi przez warstwę i18n — żadnych literałów w komponentach. Prompt wyjściowy zawsze po angielsku.
- Commity po polsku, prefiks `feat:` / `fix:` / `test:` / `chore:` / `docs:`. Treść dyktuje krok „Commit" danego zadania.
- Żadnych zapytań sieciowych do ComfyUI ani do usług zewnętrznych. Eksport to plik na dysku.
- **Slug pochodzący z adresu URL nigdy nie trafia do `path.join` bez walidacji kształtu.** Jedyna dozwolona postać to `/^[a-z0-9][a-z0-9-]*$/`, czyli dokładnie to, co produkuje `slugify`. Warstwa magazynu dodatkowo sprawdza, że wyliczona ścieżka leży wewnątrz katalogu danych — `deleteProject` kasuje rekurencyjnie, więc jedno sprawdzenie to za mało.

---

## Struktura plików

```
mmh3-studio/
  shared/                     rdzeń — bez zmian poza zadaniem 1
  server/
    package.json
    tsconfig.json
    src/
      app.ts                  budowa instancji Fastify (bez nasłuchu — testowalna)
      main.ts                 nasłuch na 8899
      config.ts               katalog danych, port
      storage/
        paths.ts              slug, ścieżki projektu, walidacja nazwy
        projectStore.ts       odczyt/zapis/lista/usuwanie projektów
        assetStore.ts         zapis plików assetów, miniatury
      routes/
        projects.ts           CRUD projektów
        assets.ts             upload i listowanie assetów
        export.ts             prompt, projekt, workflow ComfyUI
      export/
        comfyWorkflow.ts      podmiana promptu w workflow JSON
    test/
  web/
    package.json
    tsconfig.json
    vite.config.ts
    index.html
    src/
      main.tsx
      App.tsx
      i18n/
        dict.ts               typowany słownik PL/EN
        useT.ts               hook tłumaczeń
      api/client.ts           klient REST
      store/
        projectStore.ts       stan projektu + undo
        selectionStore.ts     zaznaczenie obiektu
      screens/
        ModePicker.tsx        pełnoekranowy wybór trybu
        Editor.tsx            układ trzykolumnowy
      panels/
        PromptPanel.tsx       prompt na żywo z podświetleniem
        ValidationPanel.tsx   klikalna lista diagnostyk
        AssetBin.tsx          assety, etykiety, mówcy
        Inspector.tsx         inspektor kontekstowy
        ShotList.tsx          tymczasowa lista ujęć (Plan 3 zastąpi ją osią czasu)
    test/
    e2e/
```

Każdy plik ma jedną odpowiedzialność. `projectStore.ts` w `server/` operuje na dysku i nie wie nic o HTTP; `routes/projects.ts` zna HTTP i nie wie nic o układzie katalogów.

---

### Task 1: Korekty rdzenia przeniesione z recenzji Planu 1

Pięć poprawek w `shared/`. Wszystkie są tanie teraz i drogie po związaniu edytora z modelem. Po tym zadaniu `shared/` jest zamknięty do końca planu.

**Files:**
- Modify: `shared/src/model/types.ts`
- Modify: `shared/src/model/schema.ts`
- Modify: `shared/src/validate/rules/anchors.ts`
- Modify: `shared/src/api.ts`
- Modify: `shared/src/compile/emitRef.ts`
- Modify: `shared/src/compile/tokens.ts`
- Modify: `shared/src/index.ts`
- Modify: `shared/test/golden/fixtures/base.ts`
- Modify: `shared/test/golden/fixtures/ref.ts`
- Modify: `shared/test/validate/rules/refAnchors.test.ts`
- Create: `shared/src/compile/describeSpeaker.ts`
- Test: `shared/test/compile/describeSpeaker.test.ts`

**Interfaces:**
- Consumes: cały rdzeń z Planu 1
- Produces:
  - `Shot.anchors: Anchor[]` zamiast `Shot.anchor: Anchor`
  - `describeSpeaker(speaker: Speaker): { full: string; short: string }`
  - `refSectionOffsets(project: Project): Array<{ name: string; start: number; end: number }>`
  - reguła `COMPILE_FAILED` obecna w rejestrze (43 reguły)

- [ ] **Step 1: Napisz testy kotwic w formie tablicy**

W `shared/test/validate/rules/refAnchors.test.ts`, w bloku `describe('reguły kotwic')`, zastąp istniejące testy `ANCHOR_REQUIRED` poniższymi i dopisz nowy test FL2VA. Nie ruszaj pozostałych bloków.

```ts
  it('ANCHOR_REQUIRED — I2VA bez etykiety obrazu', () => {
    expect(runAnchors({ ...i2vaProject, labels: [] })).toContain('ANCHOR_REQUIRED')
  })

  it('ANCHOR_REQUIRED — FL2VA z jednym obrazem', () => {
    expect(runAnchors({ ...fl2vaProject, labels: [fl2vaProject.labels[0]!] }))
      .toContain('ANCHOR_REQUIRED')
  })

  it('ANCHOR_REQUIRED — FL2VA bez kotwicy końcowej', () => {
    const shots = fl2vaProject.shots.map(s => ({ ...s, anchors: ['picture-first' as const] }))
    expect(runAnchors({ ...fl2vaProject, shots })).toContain('ANCHOR_REQUIRED')
  })

  it('ANCHOR_REQUIRED — FL2VA z obiema kotwicami w jednym ujęciu przechodzi', () => {
    expect(runAnchors(fl2vaProject)).toEqual([])
  })
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test -- refAnchors`
Expected: FAIL — `anchors` nie istnieje w typie `Shot`

- [ ] **Step 3: Zmień model na tablicę kotwic**

W `shared/src/model/types.ts`, w interfejsie `Shot`, zamień pole `anchor`:

```ts
  /**
   * Kotwice klatek referencyjnych tego ujęcia. Tryb FL2VA w swoim głównym
   * przypadku to jedno ujęcie zakotwiczone jednocześnie na pierwszej
   * i ostatniej klatce, czego pojedyncza wartość nie wyrażała.
   */
  anchors: Anchor[]
```

Usuń `'none'` z typu `Anchor` — pusta tablica wyraża brak kotwicy jednoznaczniej:

```ts
export type Anchor = 'picture-first' | 'picture-last' | 'keyframe'
```

W `shared/src/model/schema.ts`, w `ShotSchema`, zamień odpowiednią linię:

```ts
  anchors: z.array(z.enum(['picture-first', 'picture-last', 'keyframe'])),
```

- [ ] **Step 4: Zaktualizuj reguły kotwic**

W `shared/src/validate/rules/anchors.ts` zastąp `anchorRequired` i `l2vaAnchorLastShot`:

```ts
const anchorRequired = defineRule({
  id: 'ANCHOR_REQUIRED',
  severity: 'error',
  guideRef: 'guide_base §2.1, §3',
  run: ({ project }) => {
    const required = REQUIRED_PICTURES[project.mode]
    const out: Diagnostic[] = []
    const pictures = pictureCount(project)
    const allAnchors = project.shots.flatMap(s => s.anchors)

    if (required === undefined) {
      if (project.mode === 'T2VA' && pictures > 0) {
        out.push(makeDiagnostic(
          anchorRequired, { kind: 'project', id: project.id },
          'Tryb T2VA nie korzysta z obrazów referencyjnych.',
          'T2VA mode does not use reference images.',
        ))
      }
      return out
    }

    if (pictures !== required) {
      out.push(makeDiagnostic(
        anchorRequired, { kind: 'project', id: project.id },
        `Tryb ${project.mode} wymaga dokładnie ${required} obrazów referencyjnych, a jest ich ${pictures}.`,
        `Mode ${project.mode} requires exactly ${required} reference image(s), but there are ${pictures}.`,
      ))
    }

    const needed: Anchor[] = project.mode === 'FL2VA'
      ? ['picture-first', 'picture-last']
      : project.mode === 'I2VA'
        ? ['picture-first']
        : ['picture-last']

    for (const anchor of needed) {
      if (allAnchors.includes(anchor)) continue
      out.push(makeDiagnostic(
        anchorRequired, { kind: 'project', id: project.id },
        `Tryb ${project.mode} wymaga kotwicy "${anchor}" na którymś z ujęć.`,
        `Mode ${project.mode} requires a "${anchor}" anchor on one of the shots.`,
      ))
    }

    return out
  },
})

const l2vaAnchorLastShot = defineRule({
  id: 'L2VA_ANCHOR_LAST_SHOT',
  severity: 'error',
  guideRef: 'guide_base §3.3',
  run: ({ project }) => {
    if (project.mode !== 'L2VA') return []
    const shots = [...project.shots].sort((a, b) => a.index - b.index)
    const last = shots[shots.length - 1]
    if (!last) return []
    const anchored = shots.filter(s => s.anchors.includes('picture-last'))
    if (anchored.length === 1 && anchored[0]!.id === last.id) return []
    return [makeDiagnostic(
      l2vaAnchorLastShot, { kind: 'project', id: project.id },
      'W trybie L2VA klatka referencyjna należy do ostatniego ujęcia.',
      'In L2VA mode the reference frame belongs to the last shot.',
    )]
  },
})
```

Dodaj `Anchor` do importu typów w tym pliku.

- [ ] **Step 5: Zaktualizuj fixture'y**

W `shared/test/golden/fixtures/base.ts` zamień każde wystąpienie pola `anchor`:

- w `emptyShot` domyślne `anchor: 'none'` → `anchors: []`
- w ujęciu I2VA `anchor: 'picture-first'` → `anchors: ['picture-first']`
- w ujęciu FL2VA `anchor: 'picture-first'` → `anchors: ['picture-first', 'picture-last']`
- w ujęciu L2VA `anchor: 'picture-last'` → `anchors: ['picture-last']`

W `shared/test/golden/fixtures/ref.ts` w `emptyShot` zamień `anchor: 'none'` → `anchors: []`.

Nie zmieniaj niczego innego w tych plikach — teksty i segmenty zostają nietknięte, bo pilnują ich testy złote.

- [ ] **Step 6: Uruchom testy kotwic i złote**

Run: `cd ~/mmh3-studio && npm test -- refAnchors && npm test -- golden`
Expected: PASS — kotwice zielone, wszystkie pięć testów złotych nadal zielone

- [ ] **Step 7: Napisz test generatora opisu mówcy**

`shared/test/compile/describeSpeaker.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { describeSpeaker } from '../../src/compile/describeSpeaker.js'
import type { Speaker } from '../../src/model/types.js'

const baker: Speaker = {
  id: 'sp1', code: 'S1', characterType: 'baker', age: 'middle-aged', gender: 'male',
  pitch: 'low', timbre: 'slightly raspy', rate: 'calm', accent: 'neutral', onScreen: true,
  fullDescriptor: 'the middle-aged baker with a calm, slightly raspy voice',
  shortDescriptor: 'the baker',
}

describe('describeSpeaker', () => {
  it('odtwarza opis z przykładu guide dla kompletu pól', () => {
    expect(describeSpeaker(baker).full)
      .toBe('the middle-aged baker with a calm, slightly raspy voice')
  })

  it('buduje krótki opis z typu postaci', () => {
    expect(describeSpeaker(baker).short).toBe('the baker')
  })

  it('pomija puste pola zamiast zostawiać dziury', () => {
    const sparse: Speaker = { ...baker, age: '', rate: '', timbre: '' }
    expect(describeSpeaker(sparse).full).toBe('the baker')
  })

  it('radzi sobie z samą barwą głosu', () => {
    const onlyTimbre: Speaker = { ...baker, age: '', rate: '' }
    expect(describeSpeaker(onlyTimbre).full).toBe('the baker with a slightly raspy voice')
  })

  it('zwraca pusty opis, gdy nie ma nawet typu postaci', () => {
    const empty: Speaker = { ...baker, characterType: '', age: '', rate: '', timbre: '' }
    expect(describeSpeaker(empty).full).toBe('')
    expect(describeSpeaker(empty).short).toBe('')
  })
})
```

- [ ] **Step 8: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test -- describeSpeaker`
Expected: FAIL — brak modułu

- [ ] **Step 9: Zaimplementuj generator**

`shared/src/compile/describeSpeaker.ts`:

```ts
import type { Speaker } from '../model/types.js'

/**
 * Buduje opis tożsamości głosu z pól strukturalnych mówcy.
 *
 * Guide (§4.4) wymaga, żeby przy pierwszym wystąpieniu mówcy ustalić typ
 * postaci, wiek, płeć, obecność w kadrze oraz wysokość, barwę, tempo i akcent.
 * Te dane żyją w rekordzie mówcy, ale do promptu trafiają `fullDescriptor`
 * i `shortDescriptor`. Ta funkcja jest mostem między jednym a drugim:
 * edytor generuje nią opis, a użytkownik może go potem nadpisać ręcznie.
 * Kompilator nadal czyta wyłącznie gotowe pola opisowe, więc wygenerowany
 * tekst nigdy nie wchodzi do promptu bez wiedzy użytkownika.
 */
export function describeSpeaker(speaker: Speaker): { full: string; short: string } {
  const subject = [speaker.age, speaker.characterType]
    .map(part => part.trim())
    .filter(Boolean)
    .join(' ')

  if (!subject) return { full: '', short: '' }

  const voiceQualities = [speaker.rate, speaker.timbre]
    .map(part => part.trim())
    .filter(Boolean)
    .join(', ')

  const full = voiceQualities
    ? `the ${subject} with a ${voiceQualities} voice`
    : `the ${subject}`

  const short = speaker.characterType.trim()
    ? `the ${speaker.characterType.trim()}`
    : `the ${subject}`

  return { full, short }
}
```

- [ ] **Step 10: Uruchom testy generatora**

Run: `cd ~/mmh3-studio && npm test -- describeSpeaker`
Expected: PASS, 5 testów

- [ ] **Step 11: Napisz testy offsetów sekcji i reguły COMPILE_FAILED**

Dopisz do `shared/test/compile/compile.test.ts`:

```ts
  it('offsety sekcji REF liczone są z długości, nie z wyszukiwania tekstu', () => {
    const sections = refSectionOffsets(refProject)
    const { text } = compile(refProject)
    for (const section of sections) {
      expect(text.slice(section.start, section.start + section.name.length + 1))
        .toBe(`${section.name}:`)
    }
    const detailed = sections.find(s => s.name === 'detailed_description')
    expect(detailed).toBeDefined()
    expect(text.slice(detailed!.start, detailed!.end)).toContain('[Shot 1]')
  })

  it('token ujęcia 1 w REF nie daje się zwieść literałowi w treści sekcji', () => {
    const ref = {
      ...refProject.ref,
      summaryText: `detailed_description: ${refProject.ref.summaryText}`,
    }
    const project = { ...refProject, ref }
    const { text, tokens } = compile(project)
    const shot1 = tokens.find(t => t.ref.kind === 'shot' && t.ref.id === 's1')
    expect(shot1).toBeDefined()
    expect(text.slice(shot1!.start, shot1!.end)).toBe('[Shot 1]')
    expect(shot1!.start).toBeGreaterThan(text.lastIndexOf('detailed_description:'))
  })
```

Dopisz import `refSectionOffsets` z `../../src/compile/emitRef.js`.

Dopisz do `shared/test/api.test.ts`:

```ts
  it('COMPILE_FAILED jest regułą z rejestru, nie identyfikatorem znikąd', () => {
    registerAllRules()
    expect(allRules().map(r => r.id)).toContain('COMPILE_FAILED')
  })
```

Dopisz importy `registerAllRules` (już jest) oraz `allRules` z `../src/validate/registry.js`.

Dopisz do `shared/test/validate/rules/refAnchors.test.ts`, w bloku reguł REF:

```ts
  it('REF_WORD_COUNT jest wskazówką, nie ostrzeżeniem', () => {
    const diagnostics = validateWith(refRules, refProject, compile(refProject))
    const found = diagnostics.find(d => d.ruleId === 'REF_WORD_COUNT')
    expect(found).toBeDefined()
    expect(found!.severity).toBe('hint')
  })
```

- [ ] **Step 12: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test -- compile.test api refAnchors`
Expected: FAIL — brak `refSectionOffsets`, brak reguły `COMPILE_FAILED` w rejestrze

- [ ] **Step 13: Wyodrębnij kompozycję sekcji REF i policz offsety**

W `shared/src/compile/emitRef.ts` wyodrębnij listę sekcji i dodaj funkcję offsetów. `emitRef` ma zwracać dokładnie ten sam ciąg co dotąd — pilnuje tego test złoty.

```ts
const SECTION_SEPARATOR = '\n\n'

/** Sekcje trybu REF w kolejności, jako pary nazwa/treść. */
export function composeRefSections(project: Project): Array<[string, string]> {
  return [
    ['subject_definitions', renderSubjectDefinitions(project)],
    ['summary', renderSummary(project)],
    ['retention_analysis', renderRetention(project)],
    ['detailed_description', renderDetailedDescription(project)],
    ['overall_soundscape', project.audio.overallSoundscape],
    ['non_diegetic_music', project.audio.nonDiegeticMusic],
  ]
}

export function emitRef(project: Project): string {
  return composeRefSections(project)
    .map(([name, body]) => `${name}:\n${body}`)
    .join(SECTION_SEPARATOR)
}

/**
 * Granice sekcji wyliczone z długości składanych fragmentów.
 * Wcześniej mapa tokenów szukała literału "detailed_description:" w gotowym
 * tekście, co dawało zły wynik, gdy ten sam ciąg pojawił się wcześniej
 * w treści innej sekcji.
 */
export function refSectionOffsets(
  project: Project,
): Array<{ name: string; start: number; end: number }> {
  const out: Array<{ name: string; start: number; end: number }> = []
  let cursor = 0
  const sections = composeRefSections(project)
  sections.forEach(([name, body], index) => {
    const rendered = `${name}:\n${body}`
    out.push({ name, start: cursor, end: cursor + rendered.length })
    cursor += rendered.length
    if (index < sections.length - 1) cursor += SECTION_SEPARATOR.length
  })
  return out
}
```

- [ ] **Step 14: Zakotwicz mapę tokenów na wyliczonym offsecie**

W `shared/src/compile/tokens.ts` zamień probowanie literału na wyliczenie:

```ts
import { refSectionOffsets } from './emitRef.js'
```

```ts
export function buildTokens(project: Project, text: string): Token[] {
  const tokens: Token[] = []
  // W trybie REF etykiety ujęć pojawiają się także wcześniej, w retention_analysis.
  // Start liczymy z długości sekcji, a nie z wyszukiwania tekstu, żeby treść
  // wpisana przez użytkownika nie mogła przesunąć kotwicy.
  let cursor = 0
  if (project.mode === 'REF') {
    const detailed = refSectionOffsets(project).find(s => s.name === 'detailed_description')
    if (detailed) cursor = detailed.start
  }
```

Reszta funkcji zostaje bez zmian.

- [ ] **Step 15: Uczyń COMPILE_FAILED prawdziwą regułą**

W `shared/src/validate/rules/index.ts` dodaj regułę-znacznik i zarejestruj ją razem z pozostałymi:

```ts
import { defineRule, type Rule } from '../types.js'

/**
 * Reguła-znacznik. Nigdy nie odpala się sama — diagnostykę o tym identyfikatorze
 * wystawia `buildPrompt`, gdy kompilacja przerwie się na uszkodzonym modelu.
 * Istnieje w rejestrze, żeby wyszukanie metadanych po `ruleId` (cytat z guide'a
 * w panelu walidacji) nie natrafiło na dziurę.
 */
export const compileFailedRule: Rule = defineRule({
  id: 'COMPILE_FAILED',
  severity: 'error',
  guideRef: 'spójność modelu',
  run: () => [],
})
```

Dodaj `compileFailedRule` do tablicy przekazywanej do `registerRules`.

W `shared/src/api.ts` użyj jej zamiast literału:

```ts
import { compileFailedRule, registerAllRules } from './validate/rules/index.js'
import { makeDiagnostic } from './validate/types.js'
```

```ts
  if (compileFailure) {
    diagnostics.unshift(makeDiagnostic(
      compileFailedRule,
      { kind: 'project', id: project.id },
      `Kompilacja przerwana: ${compileFailure}`,
      `Compilation aborted: ${compileFailure}`,
    ))
  }
```

- [ ] **Step 16: Wyeksportuj nowe funkcje**

W `shared/src/index.ts` dopisz:

```ts
export * from './compile/describeSpeaker.js'
```

- [ ] **Step 17: Uruchom cały zestaw i sprawdzenie typów**

Run: `cd ~/mmh3-studio && npm test && npm run typecheck`
Expected: PASS — wszystkie testy zielone, w tym pięć złotych; liczba reguł wynosi teraz 43

Sprawdź liczbę reguł:

```bash
cd ~/mmh3-studio/shared && npx tsx -e "
import { registerAllRules } from './src/validate/rules/index.js'
import { allRules } from './src/validate/registry.js'
registerAllRules()
console.log('reguł:', allRules().length)
"
```

Expected: `reguł: 43`

- [ ] **Step 18: Commit**

```bash
cd ~/mmh3-studio
git add shared docs
git commit -m "feat: korekty rdzenia przed budowa edytora

Kotwice ujecia jako tablica — tryb FL2VA potrzebuje pierwszej i ostatniej
klatki naraz. Generator opisu mowcy z pol strukturalnych. Offsety sekcji
REF liczone z dlugosci zamiast wyszukiwania literalu. COMPILE_FAILED jako
regula w rejestrze."
```

---

### Task 2: Szkielet backendu

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `server/src/config.ts`
- Create: `server/src/app.ts`
- Create: `server/src/main.ts`
- Modify: `package.json` (workspaces, skrypty)
- Test: `server/test/app.test.ts`

**Interfaces:**
- Consumes: nic z wcześniejszych zadań
- Produces:
  - `buildApp(opts: { dataRoot: string }): Promise<FastifyInstance>` — instancja bez nasłuchu, testowalna przez `app.inject()`. Asynchroniczna od początku, bo rejestracja wtyczek Fastify (multipart w zadaniu 5) jest asynchroniczna i późniejsza zmiana sygnatury pociągnęłaby za sobą poprawki w testach wcześniejszych zadań.
  - `loadConfig(env?: NodeJS.ProcessEnv): { dataRoot: string; port: number }`
  - `GET /api/health` → `{ status: 'ok', version: string }`

- [ ] **Step 1: Napisz test**

`server/test/app.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  it('domyślnie celuje w katalog projektów w katalogu domowym i port 8899', () => {
    const config = loadConfig({ HOME: '/home/tester' })
    expect(config.dataRoot).toBe('/home/tester/mmh3-studio/projects')
    expect(config.port).toBe(8899)
  })

  it('pozwala nadpisać katalog danych i port', () => {
    const config = loadConfig({
      HOME: '/home/tester',
      MMH3_DATA_ROOT: '/tmp/dane',
      MMH3_PORT: '9100',
    })
    expect(config.dataRoot).toBe('/tmp/dane')
    expect(config.port).toBe(9100)
  })

  it('odrzuca nieliczbowy port zamiast po cichu wracać do domyślnego', () => {
    expect(() => loadConfig({ HOME: '/home/tester', MMH3_PORT: 'osiem' })).toThrow(/MMH3_PORT/)
  })
})

describe('buildApp', () => {
  it('odpowiada na sprawdzenie zdrowia', async () => {
    const app = await buildApp({ dataRoot: '/tmp/nieistotne' })
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', version: '0.1.0' })
    await app.close()
  })

  it('zwraca 404 w formacie JSON dla nieznanej ścieżki', async () => {
    const app = await buildApp({ dataRoot: '/tmp/nieistotne' })
    const response = await app.inject({ method: 'GET', url: '/api/nie-ma' })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: expect.any(String) })
    await app.close()
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/server`
Expected: FAIL — brak workspace'u `server`

- [ ] **Step 3: Utwórz pakiet backendu**

`server/package.json`:

```json
{
  "name": "@mmh3/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/main.ts",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "start": "tsx src/main.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mmh3/shared": "*",
    "fastify": "^5.2.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^4.1.10"
  }
}
```

`server/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test"]
}
```

`server/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 4: Zaimplementuj konfigurację i aplikację**

`server/src/config.ts`:

```ts
import { join } from 'node:path'

export interface Config {
  dataRoot: string
  port: number
}

const DEFAULT_PORT = 8899

/**
 * Konfiguracja z zmiennych środowiskowych. `MMH3_DATA_ROOT` istnieje przede
 * wszystkim po to, żeby testy mogły pracować na katalogu tymczasowym.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const home = env.HOME ?? ''
  const dataRoot = env.MMH3_DATA_ROOT ?? join(home, 'mmh3-studio', 'projects')

  let port = DEFAULT_PORT
  if (env.MMH3_PORT !== undefined) {
    const parsed = Number(env.MMH3_PORT)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`MMH3_PORT musi być dodatnią liczbą całkowitą, otrzymano: ${env.MMH3_PORT}`)
    }
    port = parsed
  }

  return { dataRoot, port }
}
```

`server/src/app.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify'

export const VERSION = '0.1.0'

export interface AppOptions {
  dataRoot: string
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  app.decorate('dataRoot', opts.dataRoot)

  app.get('/api/health', async () => ({ status: 'ok', version: VERSION }))

  // Kolejne zadania rejestrują tu swoje trasy i wtyczki.

  app.setNotFoundHandler(async (request, reply) => {
    await reply.status(404).send({ error: `Nie znaleziono ścieżki ${request.url}` })
  })

  return app
}

declare module 'fastify' {
  interface FastifyInstance {
    dataRoot: string
  }
}
```

`server/src/main.ts`:

```ts
import { buildApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const app = await buildApp({ dataRoot: config.dataRoot })

app.listen({ port: config.port, host: '127.0.0.1' })
  .then(address => {
    console.log(`MMH3 Prompt Studio API słucha na ${address}`)
    console.log(`Katalog danych: ${config.dataRoot}`)
  })
  .catch(err => {
    console.error('Nie udało się wystartować:', err)
    process.exit(1)
  })
```

- [ ] **Step 5: Podłącz workspace w katalogu głównym**

W `package.json` w katalogu głównym zamień pola `workspaces` i `scripts`:

```json
  "workspaces": ["shared", "server"],
  "scripts": {
    "test": "npm test --workspace @mmh3/shared && npm test --workspace @mmh3/server",
    "typecheck": "npm run typecheck --workspace @mmh3/shared && npm run typecheck --workspace @mmh3/server",
    "dev:api": "npm run dev --workspace @mmh3/server"
  }
```

- [ ] **Step 6: Zainstaluj i uruchom testy**

Run: `cd ~/mmh3-studio && npm install && npm test && npm run typecheck`
Expected: PASS — testy `shared` bez zmian, 5 nowych testów w `server`

- [ ] **Step 7: Commit**

```bash
cd ~/mmh3-studio
git add package.json package-lock.json server
git commit -m "feat: szkielet backendu Fastify z konfiguracja i sprawdzeniem zdrowia"
```

---

### Task 3: Warstwa magazynu projektów

Czysta logika na systemie plików, bez HTTP. Testowana na katalogu tymczasowym.

**Files:**
- Create: `server/src/storage/paths.ts`
- Create: `server/src/storage/newProject.ts`
- Create: `server/src/storage/projectStore.ts`
- Test: `server/test/storage/projectStore.test.ts`

**Interfaces:**
- Consumes: `parseProject`, typy domeny z `@mmh3/shared`
- Produces:
  - `slugify(name: string): string`
  - `projectDir(root: string, slug: string): string`
  - `newProject(name: string, mode: Mode, id: string): Project`
  - `listProjects(root): Promise<ProjectSummary[]>` gdzie `ProjectSummary = { slug: string; name: string; mode: Mode; updatedAt: string }`
  - `projectExists(root, slug): Promise<boolean>`
  - `readProject(root, slug): Promise<Project>`
  - `writeProject(root, slug, project): Promise<void>`
  - `createProject(root, name, mode): Promise<{ slug: string; project: Project }>`
  - `deleteProject(root, slug): Promise<void>`

- [ ] **Step 1: Napisz testy**

`server/test/storage/projectStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { slugify, projectDir } from '../../src/storage/paths.js'
import {
  createProject, listProjects, readProject, writeProject, deleteProject,
} from '../../src/storage/projectStore.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-test-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('slugify', () => {
  it('sprowadza nazwę do bezpiecznej postaci', () => {
    expect(slugify('Piekarnia o świcie')).toBe('piekarnia-o-swicie')
    expect(slugify('  Test   123  ')).toBe('test-123')
    expect(slugify('Ćma/Żubr\\Łoś')).toBe('cma-zubr-los')
  })

  it('odrzuca nazwę, z której nic nie zostaje', () => {
    expect(() => slugify('///')).toThrow(/nazw/i)
  })

  it('nie pozwala wyjść poza katalog danych', () => {
    expect(slugify('../../etc/passwd')).toBe('etc-passwd')
  })
})

describe('createProject', () => {
  it('tworzy katalog, plik projektu i podkatalogi', async () => {
    const { slug, project } = await createProject(root, 'Piekarnia o świcie', 'T2VA')
    expect(slug).toBe('piekarnia-o-swicie')
    expect(project.name).toBe('Piekarnia o świcie')
    expect(project.mode).toBe('T2VA')
    expect(project.video.durationMs).toBe(8000)
    expect(project.shots).toHaveLength(1)
    expect(project.shots[0]!.index).toBe(0)
    expect(project.shots[0]!.startMs).toBe(0)

    const raw = await readFile(join(projectDir(root, slug), 'project.json'), 'utf8')
    expect(JSON.parse(raw).name).toBe('Piekarnia o świcie')
  })

  it('odrzuca drugi projekt o tej samej nazwie', async () => {
    await createProject(root, 'Duplikat', 'T2VA')
    await expect(createProject(root, 'Duplikat', 'T2VA')).rejects.toThrow(/istnieje/i)
  })
})

describe('listProjects', () => {
  it('zwraca pustą listę dla pustego katalogu', async () => {
    expect(await listProjects(root)).toEqual([])
  })

  it('wypisuje projekty od ostatnio zmienionego', async () => {
    // Odstepy sa konieczne: sortowanie opiera sie na czasie modyfikacji pliku,
    // ktorego rozdzielczosc na niektorych systemach plikow wynosi milisekundy.
    const wait = () => new Promise(resolve => setTimeout(resolve, 10))
    const first = await createProject(root, 'Pierwszy', 'T2VA')
    await wait()
    await createProject(root, 'Drugi', 'REF')
    await wait()
    await createProject(root, 'Trzeci', 'I2VA')
    await wait()
    await writeProject(root, first.slug, { ...first.project, name: 'Pierwszy' })

    const list = await listProjects(root)
    expect(list.map(p => p.slug)).toEqual(['pierwszy', 'trzeci', 'drugi'])
  })

  it('pomija katalogi bez pliku projektu zamiast się wywracać', async () => {
    await createProject(root, 'Poprawny', 'T2VA')
    await mkdir(join(root, 'smiec'), { recursive: true })
    expect((await listProjects(root)).map(p => p.slug)).toEqual(['poprawny'])
  })
})

describe('readProject', () => {
  it('waliduje wczytany plik schematem', async () => {
    const { slug } = await createProject(root, 'Uszkodzony', 'T2VA')
    await writeFile(join(projectDir(root, slug), 'project.json'), '{"schemaVersion":1}', 'utf8')
    await expect(readProject(root, slug)).rejects.toThrow()
  })

  it('zgłasza czytelny błąd dla nieistniejącego projektu', async () => {
    await expect(readProject(root, 'nie-ma')).rejects.toThrow(/nie istnieje/i)
  })
})

describe('writeProject', () => {
  it('nadpisuje projekt i odświeża czas modyfikacji pliku', async () => {
    const { slug, project } = await createProject(root, 'Zapis', 'T2VA')
    const before = (await listProjects(root))[0]!.updatedAt
    await new Promise(resolve => setTimeout(resolve, 10))
    await writeProject(root, slug, { ...project, name: 'Zapis 2' })
    const reloaded = await readProject(root, slug)
    expect(reloaded.name).toBe('Zapis 2')
    expect((await listProjects(root))[0]!.updatedAt >= before).toBe(true)
  })
})

describe('deleteProject', () => {
  it('usuwa projekt wraz z katalogiem', async () => {
    const { slug } = await createProject(root, 'Do usuniecia', 'T2VA')
    await deleteProject(root, slug)
    expect(await listProjects(root)).toEqual([])
  })

  it('zgłasza błąd dla nieistniejącego projektu', async () => {
    await expect(deleteProject(root, 'nie-ma')).rejects.toThrow(/nie istnieje/i)
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/server -- projectStore`
Expected: FAIL — brak modułów

- [ ] **Step 3: Zaimplementuj ścieżki**

`server/src/storage/paths.ts`:

```ts
import { isAbsolute, join, relative } from 'node:path'

const DIACRITICS: Record<string, string> = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
}

/**
 * Sprowadza nazwę projektu do bezpiecznej nazwy katalogu.
 * Wynik nigdy nie zawiera separatorów ścieżki ani kropek wiodących, więc
 * nie da się nim wyjść poza katalog danych.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, ch => DIACRITICS[ch] ?? ch)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!slug) throw new Error(`Z nazwy "${name}" nie da się zbudować nazwy katalogu`)
  return slug
}

export const projectDir = (root: string, slug: string): string => join(root, slug)

/**
 * Druga linia obrony. Trasy walidują kształt sluga, ale katalog danych jest
 * zbyt cenny, żeby polegać na jednym sprawdzeniu — `deleteProject` kasuje
 * rekurencyjnie, więc slug `..` skasowałby katalog nadrzędny.
 */
export function assertInsideRoot(root: string, candidate: string): void {
  const rel = relative(root, candidate)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Ścieżka "${candidate}" wychodzi poza katalog danych`)
  }
}
export const projectFile = (root: string, slug: string): string =>
  join(projectDir(root, slug), 'project.json')
export const assetsDir = (root: string, slug: string): string =>
  join(projectDir(root, slug), 'assets')
export const exportsDir = (root: string, slug: string): string =>
  join(projectDir(root, slug), 'exports')
```

- [ ] **Step 4: Zaimplementuj fabrykę nowego projektu**

`server/src/storage/newProject.ts`:

```ts
import type { Mode, Project } from '@mmh3/shared'

/**
 * Świeży projekt z jednym pustym ujęciem. Ujęcie pierwsze zawsze zaczyna się
 * w zerze i nie dostaje timestampu — wymaga tego guide.
 */
export function newProject(name: string, mode: Mode, id: string): Project {
  return {
    schemaVersion: 1,
    id,
    name,
    mode,
    video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
    style: '',
    assets: [],
    labels: [],
    speakers: [],
    shots: [{
      id: 'shot-1',
      index: 0,
      startMs: 0,
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
    }],
    audio: { overallSoundscape: '', nonDiegeticMusic: 'N/A' },
    ref: { taskTypes: [], summaryText: '', retention: [] },
  }
}
```

Typ `Project` nie niesie znaczników czasu i **nie wolno mu ich dodawać** — `shared/` jest w tym planie zamknięty. Czas ostatniej zmiany bierzemy z czasu modyfikacji pliku `project.json`, co `listProjects` już robi.

- [ ] **Step 5: Zaimplementuj magazyn**

`server/src/storage/projectStore.ts`:

```ts
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseProject, type Mode, type Project } from '@mmh3/shared'
import { assetsDir, exportsDir, projectDir, projectFile, slugify } from './paths.js'
import { newProject } from './newProject.js'

export interface ProjectSummary {
  slug: string
  name: string
  mode: Mode
  updatedAt: string
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function createProject(
  root: string,
  name: string,
  mode: Mode,
): Promise<{ slug: string; project: Project }> {
  const slug = slugify(name)
  if (await exists(projectDir(root, slug))) {
    throw new Error(`Projekt o nazwie "${name}" już istnieje`)
  }
  await mkdir(assetsDir(root, slug), { recursive: true })
  await mkdir(exportsDir(root, slug), { recursive: true })
  const project = newProject(name, mode, slug)
  await writeProject(root, slug, project)
  return { slug, project }
}

export async function writeProject(
  root: string,
  slug: string,
  project: Project,
): Promise<void> {
  await mkdir(projectDir(root, slug), { recursive: true })
  await writeFile(projectFile(root, slug), `${JSON.stringify(project, null, 2)}\n`, 'utf8')
}

export async function projectExists(root: string, slug: string): Promise<boolean> {
  return exists(projectFile(root, slug))
}

export async function readProject(root: string, slug: string): Promise<Project> {
  const path = projectFile(root, slug)
  if (!await exists(path)) throw new Error(`Projekt "${slug}" nie istnieje`)
  return parseProject(JSON.parse(await readFile(path, 'utf8')))
}

export async function listProjects(root: string): Promise<ProjectSummary[]> {
  if (!await exists(root)) return []
  const entries = await readdir(root, { withFileTypes: true })
  const summaries: ProjectSummary[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = projectFile(root, entry.name)
    if (!await exists(path)) continue
    try {
      const project = parseProject(JSON.parse(await readFile(path, 'utf8')))
      const info = await stat(path)
      summaries.push({
        slug: entry.name,
        name: project.name,
        mode: project.mode,
        updatedAt: info.mtime.toISOString(),
      })
    } catch {
      // Uszkodzony plik nie może wywrócić listy pozostałych projektów.
      continue
    }
  }

  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function deleteProject(root: string, slug: string): Promise<void> {
  const dir = projectDir(root, slug)
  if (!await exists(dir)) throw new Error(`Projekt "${slug}" nie istnieje`)
  await rm(dir, { recursive: true, force: true })
}
```

- [ ] **Step 6: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/server -- projectStore`
Expected: PASS, 12 testów

Jeśli test sortowania listy okaże się chwiejny przez rozdzielczość czasu modyfikacji, **nie usuwaj go** — dołóż w teście krótkie oczekiwanie między zapisami, tak jak robi to test `writeProject`.

- [ ] **Step 7: Commit**

```bash
cd ~/mmh3-studio
git add server
git commit -m "feat: magazyn projektow na folderach z walidacja schematem"
```

---

### Task 4: REST projektów

**Files:**
- Create: `server/src/routes/projects.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/routes/projects.test.ts`

**Interfaces:**
- Consumes: `createProject`, `listProjects`, `readProject`, `writeProject`, `deleteProject`, `ProjectSummary`
- Produces:
  - `GET    /api/projects` → `ProjectSummary[]`
  - `POST   /api/projects` `{ name, mode }` → `201 { slug, project }`
  - `GET    /api/projects/:slug` → `{ project, prompt, tokens, diagnostics }`
  - `PUT    /api/projects/:slug` `{ project }` → `{ prompt, tokens, diagnostics }`
  - `DELETE /api/projects/:slug` → `204`
  - `registerProjectRoutes(app: FastifyInstance): void`

Odpowiedź `GET`/`PUT` zawiera od razu skompilowany prompt i diagnostykę, bo `buildPrompt` jest czystą i tanią funkcją, a jedno okrążenie sieciowe mniej upraszcza frontend.

- [ ] **Step 1: Napisz testy**

`server/test/routes/projects.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'

let root: string
let app: FastifyInstance

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-api-'))
  app = await buildApp({ dataRoot: root })
})

afterEach(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true })
})

const create = (name: string, mode = 'T2VA') =>
  app.inject({ method: 'POST', url: '/api/projects', payload: { name, mode } })

describe('POST /api/projects', () => {
  it('tworzy projekt i zwraca 201', async () => {
    const res = await create('Piekarnia')
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ slug: 'piekarnia' })
    expect(res.json().project.mode).toBe('T2VA')
  })

  it('odrzuca nieznany tryb', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects', payload: { name: 'X', mode: 'X2VA' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('odrzuca pustą nazwę', async () => {
    const res = await create('   ')
    expect(res.statusCode).toBe(400)
  })

  it('odrzuca duplikat nazwy', async () => {
    await create('Duplikat')
    expect((await create('Duplikat')).statusCode).toBe(409)
  })
})

describe('GET /api/projects', () => {
  it('zwraca listę podsumowań', async () => {
    await create('Pierwszy')
    await create('Drugi', 'REF')
    const res = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(res.statusCode).toBe(200)
    expect(res.json().map((p: { slug: string }) => p.slug).sort()).toEqual(['drugi', 'pierwszy'])
  })
})

describe('GET /api/projects/:slug', () => {
  it('zwraca projekt razem z promptem i diagnostyką', async () => {
    await create('Piekarnia')
    const res = await app.inject({ method: 'GET', url: '/api/projects/piekarnia' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.project.name).toBe('Piekarnia')
    expect(body.prompt).toContain('integrated_multimodal_description:')
    expect(Array.isArray(body.diagnostics)).toBe(true)
    expect(Array.isArray(body.tokens)).toBe(true)
  })

  it('nowy pusty projekt zgłasza brak stylu jako błąd', async () => {
    await create('Pusty')
    const res = await app.inject({ method: 'GET', url: '/api/projects/pusty' })
    expect(res.json().diagnostics.map((d: { ruleId: string }) => d.ruleId))
      .toContain('STYLE_REQUIRED')
  })

  it('zwraca 404 dla nieznanego projektu', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/projects/nie-ma' })).statusCode).toBe(404)
  })
})

describe('PUT /api/projects/:slug', () => {
  it('zapisuje zmieniony projekt i zwraca świeży prompt', async () => {
    const created = (await create('Piekarnia')).json()
    const project = { ...created.project, style: 'Live-action, cinematic' }
    const res = await app.inject({
      method: 'PUT', url: '/api/projects/piekarnia', payload: { project },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().prompt).toContain('Live-action, cinematic')

    const reloaded = await app.inject({ method: 'GET', url: '/api/projects/piekarnia' })
    expect(reloaded.json().project.style).toBe('Live-action, cinematic')
  })

  it('odrzuca projekt niezgodny ze schematem', async () => {
    await create('Piekarnia')
    const res = await app.inject({
      method: 'PUT', url: '/api/projects/piekarnia', payload: { project: { schemaVersion: 1 } },
    })
    expect(res.statusCode).toBe(400)
  })

  it('zwraca 404, gdy projekt nie istnieje', async () => {
    const created = (await create('Istnieje')).json()
    const res = await app.inject({
      method: 'PUT', url: '/api/projects/nie-ma', payload: { project: created.project },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /api/projects/:slug', () => {
  it('usuwa projekt', async () => {
    await create('Do usuniecia')
    expect((await app.inject({ method: 'DELETE', url: '/api/projects/do-usuniecia' })).statusCode)
      .toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/projects' })).json()).toEqual([])
  })

  it('zwraca 404 dla nieznanego projektu', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/projects/nie-ma' })).statusCode)
      .toBe(404)
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/server -- routes/projects`
Expected: FAIL — brak tras

- [ ] **Step 3: Zaimplementuj trasy**

`server/src/routes/projects.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { buildPrompt, ProjectSchema } from '@mmh3/shared'
import {
  createProject, deleteProject, listProjects, projectExists, readProject, writeProject,
} from '../storage/projectStore.js'

const CreateBody = z.object({
  name: z.string().trim().min(1),
  mode: z.enum(['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF']),
})

const UpdateBody = z.object({ project: ProjectSchema })
/** Wyłącznie kształt, jaki produkuje slugify — nic z separatorem ani kropką. */
const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'Niepoprawny identyfikator projektu')

const SlugParams = z.object({ slug: SlugSchema })

const isMissing = (err: unknown): boolean =>
  err instanceof Error && /nie istnieje/i.test(err.message)

const isDuplicate = (err: unknown): boolean =>
  err instanceof Error && /już istnieje/i.test(err.message)

/** Tylko nieczytelna treść pliku jest winą danych; reszta to awaria serwera. */
const isCorrupt = (err: unknown): boolean =>
  err instanceof SyntaxError || (err instanceof Error && err.name === 'ZodError')

export function registerProjectRoutes(app: FastifyInstance): void {
  app.get('/api/projects', async () => listProjects(app.dataRoot))

  app.post('/api/projects', async (request, reply) => {
    const parsed = CreateBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Niepoprawne dane projektu', details: parsed.error.issues })
    }
    try {
      const created = await createProject(app.dataRoot, parsed.data.name, parsed.data.mode)
      return reply.status(201).send(created)
    } catch (err) {
      if (isDuplicate(err)) return reply.status(409).send({ error: (err as Error).message })
      throw err
    }
  })

  app.get('/api/projects/:slug', async (request, reply) => {
    const { slug } = SlugParams.parse(request.params)
    try {
      const project = await readProject(app.dataRoot, slug)
      return { project, ...buildPrompt(project) }
    } catch (err) {
      if (isMissing(err)) return reply.status(404).send({ error: (err as Error).message })
      if (isCorrupt(err)) {
        return reply.status(400).send({ error: `Projekt "${slug}" jest uszkodzony` })
      }
      // Awaria infrastruktury nie jest wina klienta — niech zostanie piatka.
      throw err
    }
  })

  app.put('/api/projects/:slug', async (request, reply) => {
    const { slug } = SlugParams.parse(request.params)
    const parsed = UpdateBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Projekt niezgodny ze schematem', details: parsed.error.issues })
    }
    // Sprawdzamy obecność pliku, a nie jego treść: poprawny zapis ma prawo
    // nadpisać uszkodzony projekt, bo to jedyna operacja zdolna go naprawić.
    if (!await projectExists(app.dataRoot, slug)) {
      return reply.status(404).send({ error: `Projekt "${slug}" nie istnieje` })
    }
    const project = parsed.data.project
    await writeProject(app.dataRoot, slug, project)
    return buildPrompt(project)
  })

  app.delete('/api/projects/:slug', async (request, reply) => {
    const { slug } = SlugParams.parse(request.params)
    try {
      await deleteProject(app.dataRoot, slug)
      return reply.status(204).send()
    } catch (err) {
      if (isMissing(err)) return reply.status(404).send({ error: (err as Error).message })
      throw err
    }
  })
}
```

- [ ] **Step 4: Podłącz trasy w aplikacji**

W `server/src/app.ts` dopisz import i rejestrację przed `setNotFoundHandler`:

```ts
import { registerProjectRoutes } from './routes/projects.js'
```

```ts
  registerProjectRoutes(app)
```

- [ ] **Step 5: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/server && npm run typecheck`
Expected: PASS, 14 nowych testów

Jeśli test „nowy pusty projekt zgłasza brak stylu" nie przejdzie, sprawdź, czy zadanie 1 faktycznie przemianowało `REF_STYLE_BEFORE_SHOT1` na `STYLE_REQUIRED` i zdjęło z niej warunek trybu — reguła ma obowiązywać we wszystkich trybach.

- [ ] **Step 6: Commit**

```bash
cd ~/mmh3-studio
git add server
git commit -m "feat: REST projektow z kompilacja promptu w odpowiedzi"
```

---

### Task 5: Assety

**Files:**
- Create: `server/src/storage/assetStore.ts`
- Create: `server/src/routes/assets.ts`
- Modify: `server/src/app.ts`
- Modify: `server/package.json` (zależności `@fastify/multipart`, `sharp`)
- Test: `server/test/storage/assetStore.test.ts`
- Test: `server/test/routes/assets.test.ts`

**Interfaces:**
- Consumes: `assetsDir`, `readProject`, `writeProject`
- Produces:
  - `assetKindFromMime(mime: string): AssetKind | null` gdzie `AssetKind = 'image' | 'video' | 'audio'`
  - `saveAsset(root, slug, file: { fileName: string; mime: string; data: Buffer }): Promise<Asset>`
  - `removeAsset(root, slug, assetId): Promise<void>`
  - `POST   /api/projects/:slug/assets` (multipart) → `201 { asset, project }`
  - `DELETE /api/projects/:slug/assets/:assetId` → `200 { project }`
  - `GET    /api/projects/:slug/assets/:assetId/raw` → bajty pliku

Miniatury są generowane najlepszym wysiłkiem: gdy `sharp` zawiedzie albo plik nie jest obrazem, asset i tak się zapisuje, tylko bez miniatury. Brak miniatury nigdy nie może przerwać wgrywania.

- [ ] **Step 1: Napisz testy magazynu assetów**

`server/test/storage/assetStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assetKindFromMime, saveAsset, removeAsset } from '../../src/storage/assetStore.js'
import { createProject } from '../../src/storage/projectStore.js'
import { assetsDir } from '../../src/storage/paths.js'

let root: string
let slug: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-asset-'))
  slug = (await createProject(root, 'Assety', 'REF')).slug
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

// Najmniejszy poprawny PNG 1x1, zapisany na stałe zamiast generowany,
// żeby test nie zależał od biblioteki, którą właśnie sprawdza.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

describe('assetKindFromMime', () => {
  it('rozpoznaje trzy dozwolone rodziny typów', () => {
    expect(assetKindFromMime('image/png')).toBe('image')
    expect(assetKindFromMime('video/mp4')).toBe('video')
    expect(assetKindFromMime('audio/wav')).toBe('audio')
  })

  it('odrzuca typ spoza trzech rodzin', () => {
    expect(assetKindFromMime('application/pdf')).toBeNull()
    expect(assetKindFromMime('')).toBeNull()
  })
})

describe('saveAsset', () => {
  it('zapisuje plik i zwraca metadane', async () => {
    const asset = await saveAsset(root, slug, {
      fileName: 'kadr.png', mime: 'image/png', data: PNG_1X1,
    })
    expect(asset.kind).toBe('image')
    expect(asset.fileName).toBe('kadr.png')
    expect(asset.id).toMatch(/^asset-/)
    const files = await readdir(assetsDir(root, slug))
    expect(files).toContain(`${asset.id}.img`)
  })

  it('nadaje unikalne identyfikatory plikom o tej samej nazwie', async () => {
    const a = await saveAsset(root, slug, { fileName: 'x.png', mime: 'image/png', data: PNG_1X1 })
    const b = await saveAsset(root, slug, { fileName: 'x.png', mime: 'image/png', data: PNG_1X1 })
    expect(a.id).not.toBe(b.id)
  })

  it('odrzuca niedozwolony typ pliku', async () => {
    await expect(saveAsset(root, slug, {
      fileName: 'z.pdf', mime: 'application/pdf', data: Buffer.from('x'),
    })).rejects.toThrow(/typ/i)
  })

  it('zapisuje asset nawet gdy nie da się zrobić miniatury', async () => {
    const asset = await saveAsset(root, slug, {
      fileName: 'uszkodzony.png', mime: 'image/png', data: Buffer.from('to nie jest obraz'),
    })
    expect(asset.kind).toBe('image')
    const files = await readdir(assetsDir(root, slug))
    expect(files).toContain(`${asset.id}.png`)
  })
})

describe('removeAsset', () => {
  it('usuwa plik z dysku', async () => {
    const asset = await saveAsset(root, slug, {
      fileName: 'kadr.png', mime: 'image/png', data: PNG_1X1,
    })
    await removeAsset(root, slug, asset.id)
    const files = await readdir(assetsDir(root, slug))
    expect(files.some(f => f.startsWith(asset.id))).toBe(false)
  })

  it('nie wywraca się na nieistniejącym assecie', async () => {
    await expect(removeAsset(root, slug, 'asset-nie-ma')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/server -- assetStore`
Expected: FAIL — brak modułu

- [ ] **Step 3: Dodaj zależności**

W `server/package.json` dopisz do `dependencies`:

```json
    "@fastify/multipart": "^9.0.1",
    "sharp": "^0.35.3"
```

Run: `cd ~/mmh3-studio && npm install`

- [ ] **Step 4: Zaimplementuj magazyn assetów**

`server/src/storage/assetStore.ts`:

```ts
import { readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Asset } from '@mmh3/shared'
import { assetsDir } from './paths.js'

export type AssetKind = Asset['kind']

const THUMBNAIL_WIDTH = 320

const EXTENSION_BY_KIND: Record<AssetKind, string> = {
  image: '.img', video: '.vid', audio: '.aud',
}

export function assetKindFromMime(mime: string): AssetKind | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return null
}

export interface IncomingFile {
  fileName: string
  mime: string
  data: Buffer
}

export async function saveAsset(
  root: string,
  slug: string,
  file: IncomingFile,
): Promise<Asset> {
  const kind = assetKindFromMime(file.mime)
  if (!kind) throw new Error(`Niedozwolony typ pliku: ${file.mime || '(brak)'}`)

  const id = `asset-${randomUUID()}`
  // Rozszerzenie bierzemy z rozpoznanego rodzaju, nie z nazwy podanej przez
  // klienta — inaczej treść na dysku dostaje rozszerzenie wybrane przez niego.
  const stored = `${id}${EXTENSION_BY_KIND[kind]}`
  const dir = assetsDir(root, slug)
  await writeFile(join(dir, stored), file.data)

  if (kind === 'image') await writeThumbnail(dir, id, file.data)

  return { id, kind, path: join('assets', stored), fileName: file.fileName }
}

/**
 * Miniatura jest wygodą, nie warunkiem. Uszkodzony plik albo brak działającego
 * `sharp` nie może przerwać wgrywania assetu.
 */
async function writeThumbnail(dir: string, id: string, data: Buffer): Promise<void> {
  try {
    const { default: sharp } = await import('sharp')
    const thumb = await sharp(data).resize({ width: THUMBNAIL_WIDTH }).webp().toBuffer()
    await writeFile(join(dir, `${id}.thumb.webp`), thumb)
  } catch {
    return
  }
}

export async function removeAsset(root: string, slug: string, assetId: string): Promise<void> {
  const dir = assetsDir(root, slug)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.startsWith(assetId)) continue
    await rm(join(dir, entry), { force: true })
  }
}
```

- [ ] **Step 5: Napisz testy tras assetów**

`server/test/routes/assets.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'

let root: string
let app: FastifyInstance

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const multipart = (fileName: string, mime: string, data: Buffer) => {
  const boundary = '----mmh3test'
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: ${mime}\r\n\r\n`,
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return {
    payload: Buffer.concat([head, data, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-assets-'))
  app = await buildApp({ dataRoot: root })
  await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Assety', mode: 'REF' } })
})

afterEach(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true })
})

describe('POST /api/projects/:slug/assets', () => {
  it('wgrywa obraz i dopisuje go do projektu', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects/assety/assets',
      ...multipart('kadr.png', 'image/png', PNG_1X1),
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().asset.kind).toBe('image')
    expect(res.json().project.assets).toHaveLength(1)
  })

  it('odrzuca niedozwolony typ pliku', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects/assety/assets',
      ...multipart('z.pdf', 'application/pdf', Buffer.from('x')),
    })
    expect(res.statusCode).toBe(400)
  })

  it('zwraca 404 dla nieznanego projektu', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects/nie-ma/assets',
      ...multipart('kadr.png', 'image/png', PNG_1X1),
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /api/projects/:slug/assets/:assetId/raw', () => {
  it('oddaje zapisane bajty', async () => {
    const upload = await app.inject({
      method: 'POST', url: '/api/projects/assety/assets',
      ...multipart('kadr.png', 'image/png', PNG_1X1),
    })
    const id = upload.json().asset.id
    const res = await app.inject({ method: 'GET', url: `/api/projects/assety/assets/${id}/raw` })
    expect(res.statusCode).toBe(200)
    expect(res.rawPayload.equals(PNG_1X1)).toBe(true)
  })

  it('zwraca 404 dla nieznanego assetu', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/assety/assets/asset-x/raw' })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /api/projects/:slug/assets/:assetId', () => {
  it('usuwa asset z projektu i z dysku', async () => {
    const upload = await app.inject({
      method: 'POST', url: '/api/projects/assety/assets',
      ...multipart('kadr.png', 'image/png', PNG_1X1),
    })
    const id = upload.json().asset.id
    const res = await app.inject({ method: 'DELETE', url: `/api/projects/assety/assets/${id}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().project.assets).toEqual([])
  })
})
```

- [ ] **Step 6: Zaimplementuj trasy assetów**

`server/src/routes/assets.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { z } from 'zod'
import { projectDir } from '../storage/paths.js'
import { readProject, writeProject } from '../storage/projectStore.js'
import { removeAsset, saveAsset } from '../storage/assetStore.js'

const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'Niepoprawny identyfikator projektu')

const Params = z.object({ slug: SlugSchema })
const AssetParams = z.object({ slug: SlugSchema, assetId: z.string().min(1) })

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024

export async function registerAssetRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } })

  app.post('/api/projects/:slug/assets', async (request, reply) => {
    const { slug } = Params.parse(request.params)

    let project
    try {
      project = await readProject(app.dataRoot, slug)
    } catch {
      return reply.status(404).send({ error: `Projekt "${slug}" nie istnieje` })
    }

    const file = await request.file()
    if (!file) return reply.status(400).send({ error: 'Brak pliku w żądaniu' })

    try {
      const asset = await saveAsset(app.dataRoot, slug, {
        fileName: file.filename,
        mime: file.mimetype,
        data: await file.toBuffer(),
      })
      const updated = { ...project, assets: [...project.assets, asset] }
      await writeProject(app.dataRoot, slug, updated)
      return reply.status(201).send({ asset, project: updated })
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.get('/api/projects/:slug/assets/:assetId/raw', async (request, reply) => {
    const { slug, assetId } = AssetParams.parse(request.params)
    let project
    try {
      project = await readProject(app.dataRoot, slug)
    } catch {
      return reply.status(404).send({ error: `Projekt "${slug}" nie istnieje` })
    }
    const asset = project.assets.find(a => a.id === assetId)
    if (!asset) return reply.status(404).send({ error: `Asset "${assetId}" nie istnieje` })
    try {
      return reply.send(await readFile(join(projectDir(app.dataRoot, slug), asset.path)))
    } catch {
      return reply.status(404).send({ error: `Plik assetu "${assetId}" zniknął z dysku` })
    }
  })

  app.delete('/api/projects/:slug/assets/:assetId', async (request, reply) => {
    const { slug, assetId } = AssetParams.parse(request.params)
    let project
    try {
      project = await readProject(app.dataRoot, slug)
    } catch {
      return reply.status(404).send({ error: `Projekt "${slug}" nie istnieje` })
    }
    await removeAsset(app.dataRoot, slug, assetId)
    const updated = { ...project, assets: project.assets.filter(a => a.id !== assetId) }
    await writeProject(app.dataRoot, slug, updated)
    return { project: updated }
  })
}
```

W `server/src/app.ts` dopisz import i rejestrację wtyczki obok pozostałych — `buildApp` jest asynchroniczne od zadania 2, więc jego sygnatura się nie zmienia:

```ts
import { registerAssetRoutes } from './routes/assets.js'
```

```ts
  await registerAssetRoutes(app)
```

- [ ] **Step 7: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/server && npm run typecheck`
Expected: PASS — testy magazynu i tras assetów zielone, wcześniejsze nadal zielone

- [ ] **Step 8: Commit**

```bash
cd ~/mmh3-studio
git add server package-lock.json
git commit -m "feat: wgrywanie assetow z miniaturami najlepszym wysilkiem"
```

---

### Task 6: Eksport, w tym workflow ComfyUI

**Files:**
- Create: `server/src/export/comfyWorkflow.ts`
- Create: `server/src/routes/export.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/export/comfyWorkflow.test.ts`
- Test: `server/test/routes/export.test.ts`

**Interfaces:**
- Consumes: `readProject`, `buildPrompt`
- Produces:
  - `injectPrompt(workflow: unknown, nodeId: string, field: string, prompt: string): Record<string, unknown>`
  - `GET  /api/projects/:slug/export/prompt` → `text/plain`
  - `GET  /api/projects/:slug/export/project` → `application/json`
  - `POST /api/projects/:slug/export/comfy` `{ workflow, nodeId, field }` → workflow z wstawionym promptem

Format API ComfyUI trzyma parametry węzła pod kluczem `inputs`. Obsługujemy oba warianty: gdy węzeł ma `inputs`, piszemy tam; gdy nie ma, piszemy wprost do węzła.

- [ ] **Step 1: Napisz testy podmiany**

`server/test/export/comfyWorkflow.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { injectPrompt } from '../../src/export/comfyWorkflow.js'

const workflow = {
  '3': { class_type: 'CLIPTextEncode', inputs: { text: 'stary prompt', clip: ['4', 0] } },
  '4': { class_type: 'CheckpointLoader', inputs: { ckpt_name: 'model.safetensors' } },
}

describe('injectPrompt', () => {
  it('podmienia pole w inputs wskazanego węzła', () => {
    const out = injectPrompt(workflow, '3', 'text', 'nowy prompt')
    expect((out['3'] as any).inputs.text).toBe('nowy prompt')
  })

  it('nie rusza pozostałych węzłów ani pól', () => {
    const out = injectPrompt(workflow, '3', 'text', 'nowy prompt')
    expect((out['3'] as any).inputs.clip).toEqual(['4', 0])
    expect(out['4']).toEqual(workflow['4'])
  })

  it('nie modyfikuje wejściowego obiektu', () => {
    injectPrompt(workflow, '3', 'text', 'nowy prompt')
    expect(workflow['3'].inputs.text).toBe('stary prompt')
  })

  it('pisze wprost do węzła, gdy nie ma sekcji inputs', () => {
    const flat = { '7': { text: 'stary' } }
    expect((injectPrompt(flat, '7', 'text', 'nowy')['7'] as any).text).toBe('nowy')
  })

  it('zgłasza błąd dla nieznanego węzła', () => {
    expect(() => injectPrompt(workflow, '99', 'text', 'x')).toThrow(/węz/i)
  })

  it('zgłasza błąd dla nieznanego pola', () => {
    expect(() => injectPrompt(workflow, '3', 'nie_ma', 'x')).toThrow(/pol/i)
  })

  it('odrzuca workflow, który nie jest obiektem', () => {
    expect(() => injectPrompt([], '3', 'text', 'x')).toThrow(/workflow/i)
    expect(() => injectPrompt(null, '3', 'text', 'x')).toThrow(/workflow/i)
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/server -- comfyWorkflow`
Expected: FAIL — brak modułu

- [ ] **Step 3: Zaimplementuj podmianę**

`server/src/export/comfyWorkflow.ts`:

```ts
type Node = Record<string, unknown>

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Wstawia prompt do wskazanego pola węzła workflow ComfyUI.
 * Zwraca nowy obiekt — wejściowy zostaje nietknięty, żeby zapisany na dysku
 * szablon nie zmieniał się przy eksporcie.
 */
export function injectPrompt(
  workflow: unknown,
  nodeId: string,
  field: string,
  prompt: string,
): Record<string, unknown> {
  if (!isPlainObject(workflow)) {
    throw new Error('Workflow musi być obiektem JSON z węzłami pod kluczami')
  }

  const node = workflow[nodeId]
  if (!isPlainObject(node)) {
    throw new Error(`Workflow nie zawiera węzła o identyfikatorze "${nodeId}"`)
  }

  const target: Node = isPlainObject(node.inputs) ? node.inputs : node
  // hasOwnProperty, nie `in` — `in` przechodzi po lancuchu prototypow, wiec
  // pole o nazwie toString albo valueOf przechodziloby te kontrole na wezle,
  // ktory takiego pola nie ma.
  if (!Object.prototype.hasOwnProperty.call(target, field)) {
    throw new Error(`Węzeł "${nodeId}" nie ma pola "${field}"`)
  }

  const patchedTarget = { ...target, [field]: prompt }
  const patchedNode = isPlainObject(node.inputs)
    ? { ...node, inputs: patchedTarget }
    : patchedTarget

  return { ...workflow, [nodeId]: patchedNode }
}
```

- [ ] **Step 4: Napisz testy tras eksportu**

`server/test/routes/export.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'

let root: string
let app: FastifyInstance

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-export-'))
  app = await buildApp({ dataRoot: root })
  const created = await app.inject({
    method: 'POST', url: '/api/projects', payload: { name: 'Eksport', mode: 'T2VA' },
  })
  const project = { ...created.json().project, style: 'Live-action, cinematic' }
  await app.inject({ method: 'PUT', url: '/api/projects/eksport', payload: { project } })
})

afterEach(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true })
})

describe('GET /api/projects/:slug/export/prompt', () => {
  it('oddaje prompt jako zwykły tekst', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/eksport/export/prompt' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.body).toContain('integrated_multimodal_description:')
  })

  it('zwraca 404 dla nieznanego projektu', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/projects/nie-ma/export/prompt' }))
      .statusCode).toBe(404)
  })
})

describe('GET /api/projects/:slug/export/project', () => {
  it('oddaje projekt jako JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/eksport/export/project' })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('Eksport')
  })
})

describe('POST /api/projects/:slug/export/comfy', () => {
  const workflow = { '3': { class_type: 'CLIPTextEncode', inputs: { text: 'stary' } } }

  it('zwraca workflow z wstawionym promptem', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects/eksport/export/comfy',
      payload: { workflow, nodeId: '3', field: 'text' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()['3'].inputs.text).toContain('integrated_multimodal_description:')
  })

  it('zwraca 400 z czytelnym komunikatem dla złego węzła', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/projects/eksport/export/comfy',
      payload: { workflow, nodeId: '99', field: 'text' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/99/)
  })
})
```

- [ ] **Step 5: Zaimplementuj trasy eksportu**

`server/src/routes/export.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { buildPrompt } from '@mmh3/shared'
import { readProject } from '../storage/projectStore.js'
import { injectPrompt } from '../export/comfyWorkflow.js'

const Params = z.object({ slug: z.string().min(1) })

const ComfyBody = z.object({
  workflow: z.unknown(),
  nodeId: z.string().min(1),
  field: z.string().min(1),
})

export function registerExportRoutes(app: FastifyInstance): void {
  const load = async (slug: string) => readProject(app.dataRoot, slug)

  app.get('/api/projects/:slug/export/prompt', async (request, reply) => {
    const { slug } = Params.parse(request.params)
    try {
      const { text } = buildPrompt(await load(slug))
      return reply.type('text/plain; charset=utf-8').send(text)
    } catch {
      return reply.status(404).send({ error: `Projekt "${slug}" nie istnieje` })
    }
  })

  app.get('/api/projects/:slug/export/project', async (request, reply) => {
    const { slug } = Params.parse(request.params)
    try {
      return await load(slug)
    } catch {
      return reply.status(404).send({ error: `Projekt "${slug}" nie istnieje` })
    }
  })

  app.post('/api/projects/:slug/export/comfy', async (request, reply) => {
    const { slug } = Params.parse(request.params)
    const parsed = ComfyBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Brakuje workflow, identyfikatora węzła albo pola' })
    }
    let text: string
    try {
      text = buildPrompt(await load(slug)).text
    } catch {
      return reply.status(404).send({ error: `Projekt "${slug}" nie istnieje` })
    }
    try {
      return injectPrompt(parsed.data.workflow, parsed.data.nodeId, parsed.data.field, text)
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })
}
```

W `server/src/app.ts` dopisz import i wywołanie `registerExportRoutes(app)` obok pozostałych rejestracji.

- [ ] **Step 6: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test && npm run typecheck`
Expected: PASS — wszystko zielone, w tym pięć testów złotych w `shared`

- [ ] **Step 7: Commit**

```bash
cd ~/mmh3-studio
git add server
git commit -m "feat: eksport promptu, projektu i workflow ComfyUI"
```

---

### Task 7: Szkielet frontendu

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/tailwind.config.js`
- Create: `web/postcss.config.js`
- Create: `web/src/index.css`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Modify: `package.json` (workspace `web`, skrypty `dev`)
- Test: `web/test/App.test.tsx`

**Interfaces:**
- Consumes: nic
- Produces:
  - działający `npm run dev:web` na porcie 5173 z proxy `/api` → `http://127.0.0.1:8899`
  - komponent `App` renderujący nagłówek aplikacji

Uwaga do specyfikacji: sekcja 10 nazywa katalog frontendu `src/`. Nazywamy go `web/`, bo jest workspace'em npm obok `shared/` i `server/`, a `src/` w korzeniu repozytorium sugerowałby, że to jedyny kod. Zaktualizuj tę linię specyfikacji w kroku commitu.

- [ ] **Step 1: Napisz test**

`web/test/App.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '../src/App.js'

describe('App', () => {
  it('renderuje nazwę aplikacji', () => {
    render(<App />)
    expect(screen.getByRole('banner')).toHaveTextContent('MMH3 Prompt Studio')
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web`
Expected: FAIL — brak workspace'u `web`

- [ ] **Step 3: Utwórz pakiet frontendu**

`web/package.json`:

```json
{
  "name": "@mmh3/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mmh3/shared": "*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zustand": "^4.5.5"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^6.0.5",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.6.3",
    "vite": "^8.2.0",
    "vitest": "^4.1.10"
  }
}
```

`web/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

`web/vite.config.ts`:

```ts
// defineConfig z 'vitest/config', a nie z 'vite' — od Vite 8 wariant z 'vite'
// nie przyjmuje typowo bloku `test`.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8899', changeOrigin: true },
    },
  },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
  },
})
```

`web/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

`web/index.html`:

```html
<!doctype html>
<html lang="pl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MMH3 Prompt Studio</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/tailwind.config.js`:

```js
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

`web/postcss.config.js`:

```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
}
```

`web/src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: dark;
}

body {
  @apply bg-neutral-950 text-neutral-100 antialiased;
}
```

`web/src/App.tsx`:

```tsx
export function App() {
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
        <span className="font-semibold tracking-tight">MMH3 Prompt Studio</span>
      </header>
      <main className="flex-1 overflow-hidden" />
    </div>
  )
}
```

`web/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Brak elementu #root w dokumencie')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 4: Podłącz workspace**

W `package.json` w katalogu głównym:

```json
  "workspaces": ["shared", "server", "web"],
  "scripts": {
    "test": "npm test --workspace @mmh3/shared && npm test --workspace @mmh3/server && npm test --workspace @mmh3/web",
    "typecheck": "npm run typecheck --workspace @mmh3/shared && npm run typecheck --workspace @mmh3/server && npm run typecheck --workspace @mmh3/web",
    "dev:api": "npm run dev --workspace @mmh3/server",
    "dev:web": "npm run dev --workspace @mmh3/web"
  }
```

- [ ] **Step 5: Zainstaluj i uruchom testy**

Run: `cd ~/mmh3-studio && npm install && npm test && npm run typecheck`
Expected: PASS — wszystko zielone, w tym pięć testów złotych

- [ ] **Step 6: Sprawdź, że serwer deweloperski wstaje**

Run:

```bash
cd ~/mmh3-studio
timeout 20 npm run dev:web > /tmp/vite.log 2>&1 &
sleep 8
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5173/
grep -c "5173" /tmp/vite.log
```

Expected: `200` oraz co najmniej jedno wystąpienie portu w logu. Zabij proces po sprawdzeniu i podaj wynik w raporcie.

- [ ] **Step 7: Zaktualizuj specyfikację i zrób commit**

W `docs/superpowers/specs/2026-08-04-mmh3-prompt-studio-design.md`, w sekcji 10, zamień `src/       frontend` na `web/       frontend`.

```bash
cd ~/mmh3-studio
git add package.json package-lock.json web docs
git commit -m "feat: szkielet frontendu Vite z Reactem, Tailwindem i proxy do API"
```

---

### Task 8: Warstwa dwujęzyczna

**Files:**
- Create: `web/src/i18n/dict.ts`
- Create: `web/src/i18n/useT.ts`
- Test: `web/test/i18n.test.tsx`

**Interfaces:**
- Consumes: nic
- Produces:
  - `type Lang = 'pl' | 'en'`
  - `DICT: Record<Lang, Record<TKey, string>>` gdzie `TKey` wywodzi się z kluczy słownika polskiego
  - `useLang(): { lang: Lang; setLang(lang: Lang): void }` — magazyn Zustanda z zapisem w `localStorage`
  - `useT(): (key: TKey, vars?: Record<string, string | number>) => string`

Typ `TKey` pochodzi ze słownika polskiego, więc brak tłumaczenia angielskiego jest błędem kompilacji, a nie cichym brakiem w interfejsie.

- [ ] **Step 1: Napisz testy**

`web/test/i18n.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { DICT } from '../src/i18n/dict.js'
import { useT, useLang } from '../src/i18n/useT.js'

beforeEach(() => {
  localStorage.clear()
  useLang.setState({ lang: 'pl' })
})

describe('słownik', () => {
  it('ma komplet kluczy w obu językach', () => {
    expect(Object.keys(DICT.en).sort()).toEqual(Object.keys(DICT.pl).sort())
  })

  it('nie zostawia pustych tłumaczeń', () => {
    for (const lang of ['pl', 'en'] as const) {
      for (const [key, value] of Object.entries(DICT[lang])) {
        expect(value.trim(), `${lang}.${key}`).not.toBe('')
      }
    }
  })
})

describe('useT', () => {
  it('tłumaczy na język bieżący', () => {
    const { result } = renderHook(() => useT())
    expect(result.current('app.title')).toBe('MMH3 Prompt Studio')
    expect(result.current('projects.new')).toBe('Nowy projekt')
  })

  it('przełącza język', () => {
    const { result: t } = renderHook(() => useT())
    const { result: lang } = renderHook(() => useLang())
    act(() => lang.current.setLang('en'))
    expect(t.current('projects.new')).toBe('New project')
  })

  it('podstawia zmienne', () => {
    const { result } = renderHook(() => useT())
    expect(result.current('validation.count', { count: 3 })).toContain('3')
  })

  it('zwraca klucz, gdy tłumaczenie nie istnieje', () => {
    const { result } = renderHook(() => useT())
    expect(result.current('nie.ma.takiego' as never)).toBe('nie.ma.takiego')
  })

  it('zapamiętuje wybór języka między sesjami', () => {
    const { result } = renderHook(() => useLang())
    act(() => result.current.setLang('en'))
    expect(localStorage.getItem('mmh3.lang')).toBe('en')
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- i18n`
Expected: FAIL — brak modułów

- [ ] **Step 3: Zaimplementuj słownik**

`web/src/i18n/dict.ts`:

```ts
export type Lang = 'pl' | 'en'

const pl = {
  'app.title': 'MMH3 Prompt Studio',
  'app.language': 'Język',

  'projects.title': 'Projekty',
  'projects.new': 'Nowy projekt',
  'projects.name': 'Nazwa projektu',
  'projects.create': 'Utwórz',
  'projects.empty': 'Nie masz jeszcze żadnego projektu.',
  'projects.open': 'Otwórz',
  'projects.delete': 'Usuń',
  'projects.deleteConfirm': 'Usunąć projekt „{name}" bez możliwości cofnięcia?',

  'mode.pick': 'Wybierz tryb generowania',
  'mode.whatYouGive': 'Co dostarczasz',
  'mode.anchor': 'Gdzie model zostaje zakotwiczony',
  'mode.whenToUse': 'Kiedy tego użyć',
  'mode.note': 'Reguła szczególna',

  'editor.prompt': 'Prompt',
  'editor.validation': 'Walidacja',
  'editor.inspector': 'Inspektor',
  'editor.shots': 'Ujęcia',
  'editor.assets': 'Assety',
  'editor.labels': 'Etykiety',
  'editor.speakers': 'Mówcy',
  'editor.makeLabel': 'Utwórz etykietę',
  'editor.addSpeaker': 'Dodaj mówcę',
  'editor.undo': 'Cofnij',
  'editor.redo': 'Ponów',
  'editor.copy': 'Kopiuj',
  'editor.copied': 'Skopiowano',

  'validation.ready': 'Gotowy do eksportu',
  'validation.count': 'Problemy: {count}',
  'validation.none': 'Walidator nie zgłasza uwag.',
  'validation.error': 'Błąd',
  'validation.warning': 'Ostrzeżenie',
  'validation.hint': 'Wskazówka',
  'validation.source': 'Źródło',

  'shot.add': 'Dodaj ujęcie',
  'shot.remove': 'Usuń ujęcie',
  'shot.number': 'Ujęcie {number}',
  'shot.startMs': 'Czas cięcia',
  'shot.msValue': '{ms} ms',
  'shot.composition': 'Kompozycja',
  'shot.cutPhrase': 'Fraza cięcia',
  'shot.cutType': 'Rodzaj przejścia',
  'shot.anchors': 'Kotwice klatek',

  'project.style': 'Styl wizualny',
  'project.duration': 'Długość wideo',
  'project.aspect': 'Proporcje',
  'project.soundscape': 'Tło dźwiękowe',
  'project.music': 'Muzyka niediegetyczna',

  'export.title': 'Eksport',
  'export.prompt': 'Prompt (.txt)',
  'export.project': 'Projekt (.json)',
  'export.comfy': 'Workflow ComfyUI',
  'export.comfyNode': 'Identyfikator węzła',
  'export.comfyField': 'Pole węzła',
  'export.comfyUpload': 'Wgraj workflow',
  'export.blocked': 'Eksport zablokowany — walidator zgłasza błędy.',

  'common.cancel': 'Anuluj',
  'common.save': 'Zapisz',
  'common.close': 'Zamknij',
  'common.loading': 'Wczytywanie…',
  'common.error': 'Coś poszło nie tak: {message}',
} as const

export type TKey = keyof typeof pl

const en: Record<TKey, string> = {
  'app.title': 'MMH3 Prompt Studio',
  'app.language': 'Language',

  'projects.title': 'Projects',
  'projects.new': 'New project',
  'projects.name': 'Project name',
  'projects.create': 'Create',
  'projects.empty': 'You have no projects yet.',
  'projects.open': 'Open',
  'projects.delete': 'Delete',
  'projects.deleteConfirm': 'Delete project "{name}" permanently?',

  'mode.pick': 'Choose a generation mode',
  'mode.whatYouGive': 'What you supply',
  'mode.anchor': 'Where the model is anchored',
  'mode.whenToUse': 'When to use it',
  'mode.note': 'Special rule',

  'editor.prompt': 'Prompt',
  'editor.validation': 'Validation',
  'editor.inspector': 'Inspector',
  'editor.shots': 'Shots',
  'editor.assets': 'Assets',
  'editor.labels': 'Labels',
  'editor.speakers': 'Speakers',
  'editor.makeLabel': 'Create label',
  'editor.addSpeaker': 'Add speaker',
  'editor.undo': 'Undo',
  'editor.redo': 'Redo',
  'editor.copy': 'Copy',
  'editor.copied': 'Copied',

  'validation.ready': 'Ready to export',
  'validation.count': 'Issues: {count}',
  'validation.none': 'The validator has nothing to report.',
  'validation.error': 'Error',
  'validation.warning': 'Warning',
  'validation.hint': 'Hint',
  'validation.source': 'Source',

  'shot.add': 'Add shot',
  'shot.remove': 'Remove shot',
  'shot.number': 'Shot {number}',
  'shot.startMs': 'Cut time',
  'shot.msValue': '{ms} ms',
  'shot.composition': 'Composition',
  'shot.cutPhrase': 'Cut phrase',
  'shot.cutType': 'Transition type',
  'shot.anchors': 'Frame anchors',

  'project.style': 'Visual style',
  'project.duration': 'Video duration',
  'project.aspect': 'Aspect ratio',
  'project.soundscape': 'Overall soundscape',
  'project.music': 'Non-diegetic music',

  'export.title': 'Export',
  'export.prompt': 'Prompt (.txt)',
  'export.project': 'Project (.json)',
  'export.comfy': 'ComfyUI workflow',
  'export.comfyNode': 'Node id',
  'export.comfyField': 'Node field',
  'export.comfyUpload': 'Upload workflow',
  'export.blocked': 'Export blocked — the validator reports errors.',

  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.close': 'Close',
  'common.loading': 'Loading…',
  'common.error': 'Something went wrong: {message}',
}

export const DICT: Record<Lang, Record<TKey, string>> = { pl, en }
```

- [ ] **Step 4: Zaimplementuj hook**

`web/src/i18n/useT.ts`:

```ts
import { create } from 'zustand'
import { DICT, type Lang, type TKey } from './dict.js'

const STORAGE_KEY = 'mmh3.lang'

const initialLang = (): Lang => {
  const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
  return stored === 'en' || stored === 'pl' ? stored : 'pl'
}

interface LangState {
  lang: Lang
  setLang: (lang: Lang) => void
}

export const useLang = create<LangState>(set => ({
  lang: initialLang(),
  setLang: lang => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, lang)
    set({ lang })
  },
}))

export type Translate = (key: TKey, vars?: Record<string, string | number>) => string

/** Tłumaczenie z podstawieniem zmiennych w nawiasach klamrowych. */
export function useT(): Translate {
  const lang = useLang(state => state.lang)
  return (key, vars) => {
    const template = DICT[lang][key]
    if (template === undefined) return key
    if (!vars) return template
    return Object.entries(vars).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      template,
    )
  }
}
```

- [ ] **Step 5: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web && npm run typecheck`
Expected: PASS, 7 testów

- [ ] **Step 6: Commit**

```bash
cd ~/mmh3-studio
git add web
git commit -m "feat: typowana warstwa dwujezyczna PL i EN"
```

---

### Task 9: Klient API i magazyn projektu z cofaniem

**Files:**
- Create: `web/src/api/client.ts`
- Create: `web/src/store/projectStore.ts`
- Create: `web/src/store/selectionStore.ts`
- Test: `web/test/store/projectStore.test.ts`
- Test: `web/test/api/client.test.ts`

**Interfaces:**
- Consumes: `buildPrompt`, `isExportReady`, typy `Project`, `Token`, `Diagnostic`, `ObjectRef` z `@mmh3/shared`
- Produces:
  - `api.listProjects()`, `api.createProject(name, mode)`, `api.getProject(slug)`, `api.saveProject(slug, project)`, `api.deleteProject(slug)`
  - `useProject` — magazyn: `{ slug, project, prompt, tokens, diagnostics, past, future, load, apply, undo, redo, canUndo, canRedo, dirty }`
  - `useSelection` — magazyn: `{ selected: ObjectRef | null, select(ref), clear() }`

Prompt liczy się lokalnie przez `buildPrompt` przy każdej zmianie, bo to czysta funkcja i nie ma powodu, żeby czekać na sieć. Backend dostaje projekt dopiero przy zapisie.

- [ ] **Step 1: Napisz testy magazynu**

`web/test/store/projectStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { Project } from '@mmh3/shared'
import { useProject } from '../../src/store/projectStore.js'

const base: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: '', assets: [], labels: [], speakers: [],
  shots: [{
    id: 'shot-1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
    composition: '', body: [], cameraMoves: [], dialogue: [], screenText: [],
    diegeticSfx: [], labelRefs: [], anchors: [],
  }],
  audio: { overallSoundscape: '', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

beforeEach(() => {
  useProject.setState({
    slug: null, project: null, prompt: '', tokens: [], diagnostics: [],
    past: [], future: [], dirty: false,
  })
})

describe('load', () => {
  it('ustawia projekt i od razu kompiluje prompt', () => {
    useProject.getState().load('test', base)
    const state = useProject.getState()
    expect(state.slug).toBe('test')
    expect(state.prompt).toContain('integrated_multimodal_description:')
    expect(state.dirty).toBe(false)
  })

  it('czyści historię cofania', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'Live-action' }))
    useProject.getState().load('test', base)
    expect(useProject.getState().past).toEqual([])
  })
})

describe('apply', () => {
  it('przelicza prompt i oznacza projekt jako zmieniony', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'Live-action, cinematic' }))
    const state = useProject.getState()
    expect(state.prompt).toContain('Live-action, cinematic')
    expect(state.dirty).toBe(true)
  })

  it('odkłada poprzedni stan na stos cofania', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'A' }))
    useProject.getState().apply(p => ({ ...p, style: 'B' }))
    expect(useProject.getState().past).toHaveLength(2)
  })

  it('nie wywraca się na modelu, którego nie da się skompilować', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({
      ...p,
      shots: p.shots.map(s => ({ ...s, body: [{ kind: 'camera' as const, moveId: 'nie-ma' }] })),
    }))
    const state = useProject.getState()
    expect(state.prompt).toBe('')
    expect(state.diagnostics.map(d => d.ruleId)).toContain('COMPILE_FAILED')
  })
})

describe('undo i redo', () => {
  it('cofa i ponawia zmianę', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'Live-action' }))
    useProject.getState().undo()
    expect(useProject.getState().project!.style).toBe('')
    useProject.getState().redo()
    expect(useProject.getState().project!.style).toBe('Live-action')
  })

  it('przelicza prompt przy cofnięciu', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'Live-action' }))
    useProject.getState().undo()
    expect(useProject.getState().prompt).not.toContain('Live-action')
  })

  it('nowa zmiana kasuje możliwość ponowienia', () => {
    useProject.getState().load('test', base)
    useProject.getState().apply(p => ({ ...p, style: 'A' }))
    useProject.getState().undo()
    useProject.getState().apply(p => ({ ...p, style: 'B' }))
    expect(useProject.getState().future).toEqual([])
  })

  it('cofnięcie bez historii nic nie psuje', () => {
    useProject.getState().load('test', base)
    useProject.getState().undo()
    expect(useProject.getState().project!.style).toBe('')
    expect(useProject.getState().canUndo()).toBe(false)
  })

  it('raportuje dostępność cofania i ponawiania', () => {
    useProject.getState().load('test', base)
    expect(useProject.getState().canUndo()).toBe(false)
    useProject.getState().apply(p => ({ ...p, style: 'A' }))
    expect(useProject.getState().canUndo()).toBe(true)
    expect(useProject.getState().canRedo()).toBe(false)
    useProject.getState().undo()
    expect(useProject.getState().canRedo()).toBe(true)
  })
})
```

- [ ] **Step 2: Napisz testy klienta**

`web/test/api/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api, ApiError } from '../../src/api/client.js'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api', () => {
  it('pobiera listę projektów', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ slug: 'a', name: 'A', mode: 'T2VA', updatedAt: 'x' }]))
    expect(await api.listProjects()).toHaveLength(1)
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/projects')
  })

  it('tworzy projekt metodą POST', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ slug: 'a', project: {} }, 201))
    await api.createProject('A', 'T2VA')
    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('/api/projects')
    expect(init!.method).toBe('POST')
    expect(JSON.parse(String(init!.body))).toEqual({ name: 'A', mode: 'T2VA' })
  })

  it('zamienia odpowiedź błędu na ApiError z komunikatem serwera', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'Projekt już istnieje' }, 409))
    await expect(api.createProject('A', 'T2VA')).rejects.toThrow(/już istnieje/)
    await expect(api.createProject('A', 'T2VA')).rejects.toBeInstanceOf(ApiError)
  })

  it('zachowuje kod statusu w błędzie', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'Nie ma' }, 404))
    await expect(api.getProject('x')).rejects.toMatchObject({ status: 404 })
  })

  it('radzi sobie z odpowiedzią błędu, która nie jest JSON-em', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('awaria', { status: 500 }))
    await expect(api.listProjects()).rejects.toThrow(/500/)
  })
})
```

- [ ] **Step 3: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web`
Expected: FAIL — brak modułów

- [ ] **Step 4: Zaimplementuj klienta**

`web/src/api/client.ts`:

```ts
import type { Diagnostic, Mode, Project, Token } from '@mmh3/shared'

export interface ProjectSummary {
  slug: string
  name: string
  mode: Mode
  updatedAt: string
}

export interface ProjectResponse {
  project: Project
  prompt: string
  tokens: Token[]
  diagnostics: Diagnostic[]
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  })

  if (!response.ok) {
    let message = `Serwer odpowiedział kodem ${response.status}`
    try {
      const body = await response.json() as { error?: string }
      if (body.error) message = body.error
    } catch {
      // Odpowiedź bez JSON-a — zostaje komunikat z kodem statusu.
    }
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) return undefined as T
  return await response.json() as T
}

export const api = {
  listProjects: () => request<ProjectSummary[]>('/api/projects'),

  createProject: (name: string, mode: Mode) =>
    request<{ slug: string; project: Project }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name, mode }),
    }),

  getProject: (slug: string) => request<ProjectResponse>(`/api/projects/${slug}`),

  saveProject: (slug: string, project: Project) =>
    request<Omit<ProjectResponse, 'project'>>(`/api/projects/${slug}`, {
      method: 'PUT',
      body: JSON.stringify({ project }),
    }),

  deleteProject: (slug: string) =>
    request<void>(`/api/projects/${slug}`, { method: 'DELETE' }),
}
```

- [ ] **Step 5: Zaimplementuj magazyny**

`web/src/store/projectStore.ts`:

```ts
import { create } from 'zustand'
import { buildPrompt, type Diagnostic, type Project, type Token } from '@mmh3/shared'

const HISTORY_LIMIT = 200

interface Compiled {
  prompt: string
  tokens: Token[]
  diagnostics: Diagnostic[]
}

interface ProjectState extends Compiled {
  slug: string | null
  project: Project | null
  past: Project[]
  future: Project[]
  dirty: boolean
  load: (slug: string, project: Project) => void
  apply: (mutate: (project: Project) => Project) => void
  undo: () => void
  redo: () => void
  markSaved: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

/**
 * Kompilacja jest czysta i tania, więc liczymy ją lokalnie przy każdej zmianie.
 * `buildPrompt` jest funkcją totalną — model w stanie pośrednim edycji zwraca
 * pusty tekst i diagnostykę COMPILE_FAILED zamiast rzucać wyjątkiem.
 */
const compile = (project: Project): Compiled => {
  const { text, tokens, diagnostics } = buildPrompt(project)
  return { prompt: text, tokens, diagnostics }
}

export const useProject = create<ProjectState>((set, get) => ({
  slug: null,
  project: null,
  prompt: '',
  tokens: [],
  diagnostics: [],
  past: [],
  future: [],
  dirty: false,

  load: (slug, project) =>
    set({ slug, project, past: [], future: [], dirty: false, ...compile(project) }),

  apply: mutate => {
    const { project, past } = get()
    if (!project) return
    const next = mutate(project)
    set({
      project: next,
      past: [...past, project].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
      ...compile(next),
    })
  },

  undo: () => {
    const { past, project, future } = get()
    const previous = past[past.length - 1]
    if (!previous || !project) return
    set({
      project: previous,
      past: past.slice(0, -1),
      future: [project, ...future],
      dirty: true,
      ...compile(previous),
    })
  },

  redo: () => {
    const { future, project, past } = get()
    const next = future[0]
    if (!next || !project) return
    set({
      project: next,
      past: [...past, project],
      future: future.slice(1),
      dirty: true,
      ...compile(next),
    })
  },

  markSaved: () => set({ dirty: false }),
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}))
```

`web/src/store/selectionStore.ts`:

```ts
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
```

- [ ] **Step 6: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web && npm run typecheck`
Expected: PASS, 15 nowych testów

Jeśli Vite nie potrafi rozwiązać `@mmh3/shared` w teście, sprawdź, czy `npm install` utworzył dowiązanie workspace'u w `node_modules/@mmh3/shared`. Nie dodawaj aliasu w `vite.config.ts` — dowiązanie workspace'u jest właściwym mechanizmem.

- [ ] **Step 7: Commit**

```bash
cd ~/mmh3-studio
git add web
git commit -m "feat: klient API i magazyn projektu z cofaniem"
```

---

### Task 10: Ekran projektów i wybór trybu

**Files:**
- Create: `web/src/i18n/modes.ts`
- Create: `web/src/screens/ProjectList.tsx`
- Create: `web/src/screens/ModePicker.tsx`
- Modify: `web/src/App.tsx`
- Test: `web/test/screens/modePicker.test.tsx`
- Test: `web/test/screens/projectList.test.tsx`

**Interfaces:**
- Consumes: `api`, `useT`, `useLang`, `useProject`
- Produces:
  - `MODE_INFO: Record<Mode, Record<Lang, { title: string; give: string; anchor: string; when: string; note: string }>`
  - `<ProjectList onOpen={(slug) => void} />`
  - `<ModePicker onPick={(mode: Mode) => void} />`

Ekran wyboru trybu jest pełnoekranowy i pokazuje wszystkie pięć trybów obok siebie — to jest miejsce, w którym użytkownik dowiaduje się, który tryb do czego służy, więc opisy są pełnymi zdaniami, a nie etykietami.

- [ ] **Step 1: Napisz testy**

`web/test/screens/modePicker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModePicker } from '../../src/screens/ModePicker.js'
import { MODE_INFO } from '../../src/i18n/modes.js'
import { useLang } from '../../src/i18n/useT.js'

beforeEach(() => useLang.setState({ lang: 'pl' }))

describe('MODE_INFO', () => {
  it('opisuje wszystkie pięć trybów w obu językach', () => {
    for (const mode of ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF'] as const) {
      for (const lang of ['pl', 'en'] as const) {
        const info = MODE_INFO[mode][lang]
        expect(info.title.trim(), `${mode}.${lang}.title`).not.toBe('')
        expect(info.give.trim(), `${mode}.${lang}.give`).not.toBe('')
        expect(info.anchor.trim(), `${mode}.${lang}.anchor`).not.toBe('')
        expect(info.when.trim(), `${mode}.${lang}.when`).not.toBe('')
        expect(info.note.trim(), `${mode}.${lang}.note`).not.toBe('')
      }
    }
  })
})

describe('ModePicker', () => {
  it('pokazuje wszystkie tryby z opisami', () => {
    render(<ModePicker onPick={vi.fn()} />)
    for (const mode of ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF']) {
      // Kotwica jest konieczna: "FL2VA" zawiera "L2VA" jako podciąg, więc
      // niezakotwiczone wyrażenie trafiłoby w dwa przyciski naraz. Nazwa
      // dostępna przycisku zaczyna się od kodu trybu.
      expect(screen.getByRole('button', { name: new RegExp(`^${mode}`) })).toBeInTheDocument()
    }
    expect(screen.getByText(/jedyny tryb bez linii alignmentu/i)).toBeInTheDocument()
  })

  it('zgłasza wybrany tryb', async () => {
    const onPick = vi.fn()
    render(<ModePicker onPick={onPick} />)
    await userEvent.click(screen.getByRole('button', { name: /^FL2VA/ }))
    expect(onPick).toHaveBeenCalledWith('FL2VA')
  })

  it('przełącza opisy na angielski razem z językiem interfejsu', () => {
    useLang.setState({ lang: 'en' })
    render(<ModePicker onPick={vi.fn()} />)
    expect(screen.getByText(/the only mode without an alignment line/i)).toBeInTheDocument()
  })
})
```

`web/test/screens/projectList.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectList } from '../../src/screens/ProjectList.js'
import { api } from '../../src/api/client.js'
import { useLang } from '../../src/i18n/useT.js'

beforeEach(() => useLang.setState({ lang: 'pl' }))
afterEach(() => vi.restoreAllMocks())

describe('ProjectList', () => {
  it('pokazuje komunikat, gdy nie ma projektów', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValue([])
    render(<ProjectList onOpen={vi.fn()} />)
    expect(await screen.findByText(/nie masz jeszcze żadnego projektu/i)).toBeInTheDocument()
  })

  it('wypisuje projekty i otwiera wybrany', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValue([
      { slug: 'piekarnia', name: 'Piekarnia', mode: 'T2VA', updatedAt: '2026-08-04T10:00:00Z' },
    ])
    const onOpen = vi.fn()
    render(<ProjectList onOpen={onOpen} />)
    await userEvent.click(await screen.findByRole('button', { name: /Piekarnia/ }))
    expect(onOpen).toHaveBeenCalledWith('piekarnia')
  })

  it('pokazuje komunikat błędu, gdy API zawiedzie', async () => {
    vi.spyOn(api, 'listProjects').mockRejectedValue(new Error('brak połączenia'))
    render(<ProjectList onOpen={vi.fn()} />)
    expect(await screen.findByText(/brak połączenia/)).toBeInTheDocument()
  })

  it('tworzy projekt po podaniu nazwy i trybu', async () => {
    vi.spyOn(api, 'listProjects').mockResolvedValue([])
    const create = vi.spyOn(api, 'createProject').mockResolvedValue({
      slug: 'nowy', project: {} as never,
    })
    const onOpen = vi.fn()
    render(<ProjectList onOpen={onOpen} />)

    await userEvent.click(await screen.findByRole('button', { name: /nowy projekt/i }))
    await userEvent.type(screen.getByLabelText(/nazwa projektu/i), 'Nowy')
    await userEvent.click(screen.getByRole('button', { name: /I2VA/ }))
    await userEvent.click(screen.getByRole('button', { name: /^utwórz$/i }))

    await waitFor(() => expect(create).toHaveBeenCalledWith('Nowy', 'I2VA'))
    expect(onOpen).toHaveBeenCalledWith('nowy')
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- screens`
Expected: FAIL — brak modułów

- [ ] **Step 3: Zaimplementuj opisy trybów**

`web/src/i18n/modes.ts`:

```ts
import type { Mode } from '@mmh3/shared'
import type { Lang } from './dict.js'

export interface ModeInfo {
  title: string
  give: string
  anchor: string
  when: string
  note: string
}

export const MODE_ORDER: Mode[] = ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF']

export const MODE_INFO: Record<Mode, Record<Lang, ModeInfo>> = {
  T2VA: {
    pl: {
      title: 'Tekst → wideo',
      give: 'Sam tekst. Żadnych plików referencyjnych.',
      anchor: 'Brak kotwicy — cała oś czasu powstaje z opisu.',
      when: 'Masz pełną swobodę i budujesz ujęcia od zera.',
      note: 'Jedyny tryb bez linii alignmentu na początku promptu.',
    },
    en: {
      title: 'Text → video',
      give: 'Text alone. No reference files.',
      anchor: 'No anchor — the whole timeline is built from the description.',
      when: 'You have a free hand and are building the shots from scratch.',
      note: 'The only mode without an alignment line at the top of the prompt.',
    },
  },
  I2VA: {
    pl: {
      title: 'Pierwsza klatka → wideo',
      give: 'Jeden obraz, który staje się kadrem otwarcia.',
      anchor: '<Picture 1> to dokładnie klatka 0.00 sekundy w pierwszym ujęciu.',
      when: 'Masz gotowy kadr otwarcia i chcesz rozwinąć go do przodu.',
      note: 'Tożsamość postaci, ubiór, kolory i relacje przestrzenne muszą zostać zachowane.',
    },
    en: {
      title: 'First frame → video',
      give: 'One image that becomes the opening frame.',
      anchor: '<Picture 1> is exactly the 0.00-second frame of the first shot.',
      when: 'You have an opening frame and want to develop it forward.',
      note: 'Character identity, clothing, colours and spatial relationships must be preserved.',
    },
  },
  FL2VA: {
    pl: {
      title: 'Pierwsza i ostatnia klatka → wideo',
      give: 'Dwa obrazy: początek i koniec.',
      anchor: 'Picture 1 na 0.00 sekundy, Picture 2 na końcu wideo.',
      when: 'Znasz oba końce i chodzi o drogę między nimi.',
      note: 'Guide preferuje tutaj pojedyncze ujęcie, żeby model mógł interpolować płynnie.',
    },
    en: {
      title: 'First and last frame → video',
      give: 'Two images: the start and the end.',
      anchor: 'Picture 1 at 0.00 seconds, Picture 2 at the end of the video.',
      when: 'You know both ends and the point is the path between them.',
      note: 'The guide prefers a single shot here so the model can interpolate smoothly.',
    },
  },
  L2VA: {
    pl: {
      title: 'Ostatnia klatka → wideo',
      give: 'Jeden obraz, który staje się kadrem końcowym.',
      anchor: '<Picture 1> należy do ostatniego ujęcia, nie do pierwszego.',
      when: 'Znasz pointę i dobudowujesz to, co ją poprzedziło.',
      note: 'Opis musi stopniowo zbiegać się do kadru referencyjnego w ostatnim ujęciu.',
    },
    en: {
      title: 'Last frame → video',
      give: 'One image that becomes the closing frame.',
      anchor: '<Picture 1> belongs to the last shot, not the first.',
      when: 'You know the punchline and are building up to it.',
      note: 'The description must converge on the reference frame in the final shot.',
    },
  },
  REF: {
    pl: {
      title: 'Pełne referencje',
      give: 'Do dziewięciu obrazów, trzech klipów wideo i trzech audio.',
      anchor: 'Etykiety <Subject>, <Picture>, <Video> i <Audio> wiążą materiał z treścią.',
      when: 'Zależy Ci na spójności postaci, montażu, kontynuacji albo barwie głosu.',
      note: 'Sześć sekcji zamiast trzech, a opis szczegółowy liczy 350–500 słów.',
    },
    en: {
      title: 'Full reference',
      give: 'Up to nine images, three video clips and three audio clips.',
      anchor: '<Subject>, <Picture>, <Video> and <Audio> labels bind the material to the content.',
      when: 'You need character consistency, editing, continuation or voice timbre.',
      note: 'Six sections instead of three, and the detailed description runs 350–500 words.',
    },
  },
}
```

- [ ] **Step 4: Zaimplementuj wybór trybu**

`web/src/screens/ModePicker.tsx`:

```tsx
import type { Mode } from '@mmh3/shared'
import { MODE_INFO, MODE_ORDER } from '../i18n/modes.js'
import { useLang, useT } from '../i18n/useT.js'

interface Props {
  onPick: (mode: Mode) => void
}

export function ModePicker({ onPick }: Props) {
  const t = useT()
  const lang = useLang(state => state.lang)

  return (
    <section className="p-6">
      <h2 className="mb-4 text-lg font-semibold">{t('mode.pick')}</h2>
      <div className="grid gap-3 lg:grid-cols-5">
        {MODE_ORDER.map(mode => {
          const info = MODE_INFO[mode][lang]
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onPick(mode)}
              className="flex flex-col gap-2 rounded border border-neutral-800 bg-neutral-900 p-4 text-left hover:border-neutral-600"
            >
              <span className="font-mono text-xs text-neutral-400">{mode}</span>
              <span className="font-medium">{info.title}</span>
              <Row label={t('mode.whatYouGive')} value={info.give} />
              <Row label={t('mode.anchor')} value={info.anchor} />
              <Row label={t('mode.whenToUse')} value={info.when} />
              <Row label={t('mode.note')} value={info.note} />
            </button>
          )
        })}
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-sm">
      <span className="block text-xs uppercase tracking-wide text-neutral-500">{label}</span>
      <span className="text-neutral-300">{value}</span>
    </span>
  )
}
```

- [ ] **Step 5: Zaimplementuj listę projektów**

`web/src/screens/ProjectList.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { Mode } from '@mmh3/shared'
import { api, type ProjectSummary } from '../api/client.js'
import { useT } from '../i18n/useT.js'
import { ModePicker } from './ModePicker.js'

interface Props {
  onOpen: (slug: string) => void
}

export function ProjectList({ onOpen }: Props) {
  const t = useT()
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [mode, setMode] = useState<Mode | null>(null)

  useEffect(() => {
    api.listProjects()
      .then(setProjects)
      .catch((err: Error) => setError(err.message))
  }, [])

  const create = async () => {
    if (!name.trim() || !mode) return
    try {
      const { slug } = await api.createProject(name.trim(), mode)
      onOpen(slug)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (error) return <p className="p-6 text-red-400">{error}</p>
  if (!projects) return <p className="p-6 text-neutral-400">{t('common.loading')}</p>

  return (
    <section className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('projects.title')}</h2>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded border border-neutral-700 px-3 py-1 text-sm hover:border-neutral-500"
        >
          {t('projects.new')}
        </button>
      </div>

      {projects.length === 0 && !creating && (
        <p className="text-neutral-400">{t('projects.empty')}</p>
      )}

      <ul className="mb-6 flex flex-col gap-2">
        {projects.map(project => (
          <li key={project.slug}>
            <button
              type="button"
              onClick={() => onOpen(project.slug)}
              className="flex w-full items-center justify-between rounded border border-neutral-800 px-3 py-2 text-left hover:border-neutral-600"
            >
              <span>{project.name}</span>
              <span className="font-mono text-xs text-neutral-500">{project.mode}</span>
            </button>
          </li>
        ))}
      </ul>

      {creating && (
        <div className="rounded border border-neutral-800 p-4">
          <label className="mb-3 block text-sm">
            <span className="mb-1 block text-neutral-400">{t('projects.name')}</span>
            <input
              value={name}
              onChange={event => setName(event.target.value)}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
            />
          </label>
          <ModePicker onPick={setMode} />
          <button
            type="button"
            onClick={create}
            disabled={!name.trim() || !mode}
            className="mt-3 rounded border border-neutral-700 px-3 py-1 text-sm disabled:opacity-40"
          >
            {t('projects.create')}
          </button>
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 6: Podłącz w App**

`web/src/App.tsx`:

```tsx
import { useState } from 'react'
import { ProjectList } from './screens/ProjectList.js'
import { useLang, useT } from './i18n/useT.js'

export function App() {
  const t = useT()
  const { lang, setLang } = useLang()
  const [slug, setSlug] = useState<string | null>(null)

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
        <span className="font-semibold tracking-tight">{t('app.title')}</span>
        <span className="ml-auto flex gap-1 text-xs">
          {(['pl', 'en'] as const).map(option => (
            <button
              key={option}
              type="button"
              onClick={() => setLang(option)}
              aria-pressed={lang === option}
              className={`rounded px-2 py-1 ${lang === option ? 'bg-neutral-700' : 'hover:bg-neutral-800'}`}
            >
              {option.toUpperCase()}
            </button>
          ))}
        </span>
      </header>
      <main className="flex-1 overflow-auto">
        {slug === null
          ? <ProjectList onOpen={setSlug} />
          : <p className="p-6 font-mono text-sm text-neutral-400">{slug}</p>}
      </main>
    </div>
  )
}
```

Test z zadania 7 sprawdza nagłówek przez `getByRole('banner')` i nadal przechodzi.

- [ ] **Step 7: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web && npm run typecheck`
Expected: PASS, 8 nowych testów

- [ ] **Step 8: Commit**

```bash
cd ~/mmh3-studio
git add web
git commit -m "feat: lista projektow i pelnoekranowy wybor trybu z opisami"
```

---

### Task 11: Powłoka edytora, panel promptu i panel walidacji

**Files:**
- Create: `web/src/screens/Editor.tsx`
- Create: `web/src/panels/PromptPanel.tsx`
- Create: `web/src/panels/ValidationPanel.tsx`
- Modify: `web/src/App.tsx`
- Test: `web/test/panels/promptPanel.test.tsx`
- Test: `web/test/panels/validationPanel.test.tsx`

**Interfaces:**
- Consumes: `useProject`, `useSelection`, `useT`, `api`
- Produces:
  - `<Editor slug={string} onClose={() => void} />` — wczytuje projekt i układa panele
  - `<PromptPanel />` — prompt na żywo, klikalne tokeny
  - `<ValidationPanel />` — lista diagnostyk, klik zaznacza obiekt

Kliknięcie tokenu w promptcie zaznacza obiekt, a kliknięcie diagnostyki robi to samo — dzięki temu obie listy prowadzą do tego samego miejsca w modelu.

- [ ] **Step 1: Napisz testy panelu promptu**

`web/test/panels/promptPanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PromptPanel } from '../../src/panels/PromptPanel.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useLang } from '../../src/i18n/useT.js'

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useSelection.setState({ selected: null })
  useProject.setState({
    slug: 'test', project: null, past: [], future: [], dirty: false,
    prompt: 'integrated_multimodal_description: [Shot 1] Live-action, cinematic, a shot.',
    tokens: [{ start: 35, end: 43, ref: { kind: 'shot', id: 'shot-1' } }],
    diagnostics: [],
  })
})

describe('PromptPanel', () => {
  it('pokazuje skompilowany prompt', () => {
    render(<PromptPanel />)
    expect(screen.getByText(/integrated_multimodal_description/)).toBeInTheDocument()
  })

  it('zaznacza obiekt po kliknięciu w token', async () => {
    render(<PromptPanel />)
    await userEvent.click(screen.getByRole('button', { name: '[Shot 1]' }))
    expect(useSelection.getState().selected).toEqual({ kind: 'shot', id: 'shot-1' })
  })

  it('wyróżnia token odpowiadający zaznaczeniu', () => {
    useSelection.setState({ selected: { kind: 'shot', id: 'shot-1' } })
    render(<PromptPanel />)
    expect(screen.getByRole('button', { name: '[Shot 1]' })).toHaveAttribute('aria-current', 'true')
  })

  it('radzi sobie z pustym promptem', () => {
    useProject.setState({ prompt: '', tokens: [] })
    render(<PromptPanel />)
    expect(screen.getByRole('region', { name: /prompt/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Napisz testy panelu walidacji**

`web/test/panels/validationPanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ValidationPanel } from '../../src/panels/ValidationPanel.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useLang } from '../../src/i18n/useT.js'

const diagnostic = (over: Partial<Parameters<typeof Object>[0]> = {}) => ({
  ruleId: 'STYLE_REQUIRED',
  severity: 'error' as const,
  message: 'Każdy tryb wymaga podania stylu wizualnego.',
  messageEn: 'Every mode requires a visual style.',
  ref: { kind: 'project' as const, id: 'p' },
  guideRef: 'guide_base §4.1',
  ...over,
})

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useSelection.setState({ selected: null })
  useProject.setState({ diagnostics: [], prompt: '', tokens: [] })
})

describe('ValidationPanel', () => {
  it('ogłasza gotowość, gdy nie ma uwag', () => {
    render(<ValidationPanel />)
    expect(screen.getByText(/gotowy do eksportu/i)).toBeInTheDocument()
  })

  it('wypisuje diagnostykę w języku interfejsu', () => {
    useProject.setState({ diagnostics: [diagnostic()] })
    render(<ValidationPanel />)
    expect(screen.getByText(/wymaga podania stylu/i)).toBeInTheDocument()
    useLang.setState({ lang: 'en' })
    render(<ValidationPanel />)
    expect(screen.getAllByText(/requires a visual style/i).length).toBeGreaterThan(0)
  })

  it('pokazuje cytat ze źródła', () => {
    useProject.setState({ diagnostics: [diagnostic()] })
    render(<ValidationPanel />)
    expect(screen.getByText(/guide_base §4.1/)).toBeInTheDocument()
  })

  it('zaznacza obiekt po kliknięciu w diagnostykę', async () => {
    useProject.setState({ diagnostics: [diagnostic({ ref: { kind: 'shot', id: 'shot-2' } })] })
    render(<ValidationPanel />)
    await userEvent.click(screen.getByRole('button', { name: /wymaga podania stylu/i }))
    expect(useSelection.getState().selected).toEqual({ kind: 'shot', id: 'shot-2' })
  })

  it('nie ogłasza gotowości, gdy jest choć jeden błąd', () => {
    useProject.setState({ diagnostics: [diagnostic()] })
    render(<ValidationPanel />)
    expect(screen.queryByText(/gotowy do eksportu/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- panels`
Expected: FAIL — brak modułów

- [ ] **Step 4: Zaimplementuj panel promptu**

`web/src/panels/PromptPanel.tsx`:

```tsx
import type { ReactNode } from 'react'
import type { ObjectRef } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { useSelection } from '../store/selectionStore.js'
import { useT } from '../i18n/useT.js'

const sameRef = (a: ObjectRef | null, b: ObjectRef): boolean =>
  a !== null && a.kind === b.kind && a.id === b.id

export function PromptPanel() {
  const t = useT()
  const prompt = useProject(state => state.prompt)
  const tokens = useProject(state => state.tokens)
  const selected = useSelection(state => state.selected)
  const select = useSelection(state => state.select)

  const ordered = [...tokens].sort((a, b) => a.start - b.start)
  const pieces: ReactNode[] = []
  let cursor = 0

  ordered.forEach((token, index) => {
    if (token.start < cursor) return
    if (token.start > cursor) {
      pieces.push(<span key={`t${index}`}>{prompt.slice(cursor, token.start)}</span>)
    }
    const label = prompt.slice(token.start, token.end)
    pieces.push(
      <button
        key={`k${index}`}
        type="button"
        onClick={() => select(token.ref)}
        aria-current={sameRef(selected, token.ref) ? 'true' : undefined}
        className={`rounded px-0.5 ${
          sameRef(selected, token.ref) ? 'bg-sky-700 text-white' : 'hover:bg-neutral-700'
        }`}
      >
        {label}
      </button>,
    )
    cursor = token.end
  })

  if (cursor < prompt.length) pieces.push(<span key="rest">{prompt.slice(cursor)}</span>)

  return (
    <section aria-label={t('editor.prompt')} className="h-full overflow-auto p-3">
      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
        {pieces}
      </pre>
    </section>
  )
}
```

- [ ] **Step 5: Zaimplementuj panel walidacji**

`web/src/panels/ValidationPanel.tsx`:

```tsx
import { isExportReady, type Severity } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { useSelection } from '../store/selectionStore.js'
import { useLang, useT } from '../i18n/useT.js'

const SEVERITY_STYLE: Record<Severity, string> = {
  error: 'border-red-800 text-red-300',
  warning: 'border-amber-800 text-amber-300',
  hint: 'border-neutral-700 text-neutral-400',
}

export function ValidationPanel() {
  const t = useT()
  const lang = useLang(state => state.lang)
  const diagnostics = useProject(state => state.diagnostics)
  const select = useSelection(state => state.select)

  return (
    <section aria-label={t('editor.validation')} className="h-full overflow-auto p-3">
      <p className="mb-2 text-xs uppercase tracking-wide text-neutral-500">
        {isExportReady(diagnostics)
          ? t('validation.ready')
          : t('validation.count', { count: diagnostics.length })}
      </p>

      {diagnostics.length === 0 && (
        <p className="text-sm text-neutral-400">{t('validation.none')}</p>
      )}

      <ul className="flex flex-col gap-1">
        {diagnostics.map((diagnostic, index) => (
          <li key={`${diagnostic.ruleId}-${index}`}>
            <button
              type="button"
              onClick={() => select(diagnostic.ref)}
              className={`w-full rounded border-l-2 px-2 py-1 text-left text-sm hover:bg-neutral-900 ${SEVERITY_STYLE[diagnostic.severity]}`}
            >
              <span className="block">{lang === 'pl' ? diagnostic.message : diagnostic.messageEn}</span>
              <span className="mt-0.5 block font-mono text-[10px] text-neutral-500">
                {diagnostic.ruleId} · {t('validation.source')}: {diagnostic.guideRef}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 6: Zaimplementuj powłokę edytora**

`web/src/screens/Editor.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { api } from '../api/client.js'
import { useProject } from '../store/projectStore.js'
import { useT } from '../i18n/useT.js'
import { PromptPanel } from '../panels/PromptPanel.js'
import { ValidationPanel } from '../panels/ValidationPanel.js'

interface Props {
  slug: string
  onClose: () => void
}

export function Editor({ slug, onClose }: Props) {
  const t = useT()
  const load = useProject(state => state.load)
  const project = useProject(state => state.project)
  const undo = useProject(state => state.undo)
  const redo = useProject(state => state.redo)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getProject(slug)
      .then(response => load(slug, response.project))
      .catch((err: Error) => setError(err.message))
  }, [slug, load])

  if (error) return <p className="p-6 text-red-400">{error}</p>
  if (!project) return <p className="p-6 text-neutral-400">{t('common.loading')}</p>

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-1 text-sm">
        <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-100">
          ← {t('projects.title')}
        </button>
        <span className="font-medium">{project.name}</span>
        <span className="font-mono text-xs text-neutral-500">{project.mode}</span>
        <span className="ml-auto flex gap-1">
          <button type="button" onClick={undo} className="rounded px-2 py-0.5 hover:bg-neutral-800">
            {t('editor.undo')}
          </button>
          <button type="button" onClick={redo} className="rounded px-2 py-0.5 hover:bg-neutral-800">
            {t('editor.redo')}
          </button>
        </span>
      </div>
      <div className="grid flex-1 grid-cols-2 overflow-hidden divide-x divide-neutral-800">
        <PromptPanel />
        <ValidationPanel />
      </div>
    </div>
  )
}
```

W `web/src/App.tsx` zamień gałąź renderującą surowy slug na `<Editor slug={slug} onClose={() => setSlug(null)} />` i dopisz import.

- [ ] **Step 7: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web && npm run typecheck`
Expected: PASS, 9 nowych testów

- [ ] **Step 8: Commit**

```bash
cd ~/mmh3-studio
git add web
git commit -m "feat: powloka edytora z panelem promptu i klikalna walidacja"
```

---

### Task 12: Lista ujęć i inspektor

**Files:**
- Create: `web/src/panels/ShotList.tsx`
- Create: `web/src/panels/Inspector.tsx`
- Modify: `web/src/screens/Editor.tsx`
- Test: `web/test/panels/shotList.test.tsx`
- Test: `web/test/panels/inspector.test.tsx`

**Interfaces:**
- Consumes: `useProject`, `useSelection`, `useT`
- Produces:
  - `<ShotList />` — dodawanie, usuwanie i zaznaczanie ujęć
  - `<Inspector />` — pola projektu albo zaznaczonego ujęcia

Lista ujęć jest tymczasowa: Plan 3 zastąpi ją osią czasu. Inspektor zostaje i tylko dostanie więcej rodzajów zaznaczenia.

- [ ] **Step 1: Napisz testy**

`web/test/panels/shotList.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@mmh3/shared'
import { ShotList } from '../../src/panels/ShotList.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useLang } from '../../src/i18n/useT.js'

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic', assets: [], labels: [], speakers: [],
  shots: [{
    id: 'shot-1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
    composition: '', body: [{ kind: 'text', text: 'a shot.' }], cameraMoves: [], dialogue: [],
    screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
  }],
  audio: { overallSoundscape: 'Rain.', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useSelection.setState({ selected: null })
  useProject.getState().load('test', project)
})

describe('ShotList', () => {
  it('wypisuje ujęcia', () => {
    render(<ShotList />)
    expect(screen.getByRole('button', { name: /ujęcie 1/i })).toBeInTheDocument()
  })

  it('dodaje ujęcie z czasem cięcia w środku pozostałego zakresu', async () => {
    render(<ShotList />)
    await userEvent.click(screen.getByRole('button', { name: /dodaj ujęcie/i }))
    const shots = useProject.getState().project!.shots
    expect(shots).toHaveLength(2)
    expect(shots[1]!.index).toBe(1)
    expect(shots[1]!.startMs).toBeGreaterThan(0)
    expect(shots[1]!.startMs).toBeLessThan(8000)
  })

  it('zaznacza ujęcie po kliknięciu', async () => {
    render(<ShotList />)
    await userEvent.click(screen.getByRole('button', { name: /ujęcie 1/i }))
    expect(useSelection.getState().selected).toEqual({ kind: 'shot', id: 'shot-1' })
  })

  it('usuwa ujęcie i przenumerowuje pozostałe', async () => {
    render(<ShotList />)
    await userEvent.click(screen.getByRole('button', { name: /dodaj ujęcie/i }))
    await userEvent.click(screen.getAllByRole('button', { name: /usuń ujęcie/i })[0]!)
    const shots = useProject.getState().project!.shots
    expect(shots).toHaveLength(1)
    expect(shots[0]!.index).toBe(0)
    expect(shots[0]!.startMs).toBe(0)
  })

  it('nie pozwala usunąć ostatniego ujęcia', async () => {
    render(<ShotList />)
    const remove = screen.getByRole('button', { name: /usuń ujęcie/i })
    expect(remove).toBeDisabled()
  })
})
```

`web/test/panels/inspector.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@mmh3/shared'
import { Inspector, toMs } from '../../src/panels/Inspector.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { useLang } from '../../src/i18n/useT.js'

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: '', assets: [], labels: [], speakers: [],
  shots: [{
    id: 'shot-1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
    composition: '', body: [], cameraMoves: [], dialogue: [],
    screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
  }],
  audio: { overallSoundscape: '', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useSelection.setState({ selected: null })
  useProject.getState().load('test', project)
})

describe('Inspector', () => {
  it('bez zaznaczenia pokazuje pola projektu', () => {
    render(<Inspector />)
    expect(screen.getByLabelText(/styl wizualny/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/długość wideo/i)).toBeInTheDocument()
  })

  it('zmiana stylu przelicza prompt', async () => {
    render(<Inspector />)
    await userEvent.type(screen.getByLabelText(/styl wizualny/i), 'Live-action')
    expect(useProject.getState().prompt).toContain('Live-action')
  })

  it('po zaznaczeniu ujęcia pokazuje jego pola', () => {
    useSelection.setState({ selected: { kind: 'shot', id: 'shot-1' } })
    render(<Inspector />)
    expect(screen.getByLabelText(/kompozycja/i)).toBeInTheDocument()
  })

  it('zmiana czasu cięcia trafia do modelu', async () => {
    useProject.getState().apply(p => ({
      ...p,
      shots: [...p.shots, { ...p.shots[0]!, id: 'shot-2', index: 1, startMs: 4000 }],
    }))
    useSelection.setState({ selected: { kind: 'shot', id: 'shot-2' } })
    render(<Inspector />)
    const field = screen.getByLabelText(/czas cięcia/i)
    await userEvent.clear(field)
    await userEvent.type(field, '5000')
    expect(useProject.getState().project!.shots[1]!.startMs).toBe(5000)
  })

  it('toMs odrzuca wartość nieliczbową i zachowuje poprzednią', () => {
    expect(toMs('abc', 8000)).toBe(8000)
    expect(toMs('Infinity', 8000)).toBe(8000)
    expect(toMs('', 8000)).toBe(0)
    expect(toMs('5000', 8000)).toBe(5000)
  })

  it('pokazuje komunikat, gdy zaznaczony obiekt zniknął', () => {
    useSelection.setState({ selected: { kind: 'shot', id: 'nie-ma' } })
    render(<Inspector />)
    expect(screen.getByRole('region', { name: /inspektor/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- shotList inspector`
Expected: FAIL — brak modułów

- [ ] **Step 3: Zaimplementuj listę ujęć**

`web/src/panels/ShotList.tsx`:

```tsx
import { snapToFrame, type Shot } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { useSelection } from '../store/selectionStore.js'
import { useT } from '../i18n/useT.js'

/** Nowe ujęcie ląduje w połowie odcinka między ostatnim cięciem a końcem wideo. */
const nextStartMs = (shots: Shot[], durationMs: number): number => {
  const last = shots.reduce((max, shot) => Math.max(max, shot.startMs), 0)
  return snapToFrame(last + Math.floor((durationMs - last) / 2))
}

export function ShotList() {
  const t = useT()
  const project = useProject(state => state.project)
  const apply = useProject(state => state.apply)
  const selected = useSelection(state => state.selected)
  const select = useSelection(state => state.select)

  if (!project) return null

  const addShot = () => apply(current => {
    const startMs = nextStartMs(current.shots, current.video.durationMs)
    const shot: Shot = {
      id: `shot-${current.shots.length + 1}-${startMs}`,
      index: current.shots.length,
      startMs,
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
    return { ...current, shots: [...current.shots, shot] }
  })

  const removeShot = (id: string) => apply(current => ({
    ...current,
    shots: current.shots
      .filter(shot => shot.id !== id)
      .sort((a, b) => a.index - b.index)
      .map((shot, index) => ({ ...shot, index, startMs: index === 0 ? 0 : shot.startMs })),
  }))

  return (
    <section aria-label={t('editor.shots')} className="h-full overflow-auto p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-neutral-500">{t('editor.shots')}</span>
        <button
          type="button"
          onClick={addShot}
          className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:border-neutral-500"
        >
          {t('shot.add')}
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {[...project.shots].sort((a, b) => a.index - b.index).map(shot => (
          <li key={shot.id} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => select({ kind: 'shot', id: shot.id })}
              aria-current={selected?.kind === 'shot' && selected.id === shot.id ? 'true' : undefined}
              className={`flex-1 rounded border px-2 py-1 text-left text-sm ${
                selected?.kind === 'shot' && selected.id === shot.id
                  ? 'border-sky-700 bg-neutral-900'
                  : 'border-neutral-800 hover:border-neutral-600'
              }`}
            >
              {t('shot.number', { number: shot.index + 1 })}
              <span className="ml-2 font-mono text-xs text-neutral-500">
                {t('shot.msValue', { ms: shot.startMs })}
              </span>
            </button>
            <button
              type="button"
              onClick={() => removeShot(shot.id)}
              disabled={project.shots.length <= 1}
              aria-label={t('shot.remove')}
              className="rounded px-2 py-1 text-xs text-neutral-500 hover:text-red-400 disabled:opacity-30"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 4: Zaimplementuj inspektor**

`web/src/panels/Inspector.tsx`:

```tsx
import type { ReactNode } from 'react'
import type { Project, Shot } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { useSelection } from '../store/selectionStore.js'
import { useT, type Translate } from '../i18n/useT.js'

export function Inspector() {
  const t = useT()
  const project = useProject(state => state.project)
  const apply = useProject(state => state.apply)
  const selected = useSelection(state => state.selected)

  if (!project) return null

  const shot = selected?.kind === 'shot'
    ? project.shots.find(candidate => candidate.id === selected.id)
    : undefined

  return (
    <section aria-label={t('editor.inspector')} className="h-full overflow-auto p-3">
      {shot
        ? <ShotFields t={t} shot={shot} apply={apply} />
        : <ProjectFields t={t} project={project} apply={apply} />}
    </section>
  )
}

type Apply = (mutate: (project: Project) => Project) => void

/**
 * Puste pole daje zero i walidator to zgłosi — taka jest pętla zwrotna.
 * NaN natomiast przechodzi przez typy i po cichu wyłącza część reguł
 * czasowych, bo każde porównanie z NaN jest fałszem, więc go nie wpuszczamy.
 *
 * Przez samo pole `type="number"` NaN nie przyjdzie — HTML sanityzuje wpis
 * nieliczbowy do pustego ciągu, zanim onChange go zobaczy. To zabezpieczenie
 * na inne drogi do modelu: import projektu, łatkę od modelu językowego,
 * zmianę programową. Dlatego testujemy je wprost, a nie przez DOM.
 */
export const toMs = (raw: string, previous: number): number => {
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : previous
}

function ProjectFields({ t, project, apply }: { t: Translate; project: Project; apply: Apply }) {
  return (
    <div className="flex flex-col gap-3">
      <Field label={t('project.style')}>
        <input
          value={project.style}
          onChange={event => apply(current => ({ ...current, style: event.target.value }))}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
        />
      </Field>
      <Field label={t('project.duration')}>
        <input
          type="number"
          value={project.video.durationMs}
          onChange={event => apply(current => ({
            ...current,
            video: { ...current.video, durationMs: toMs(event.target.value, current.video.durationMs) },
          }))}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
        />
      </Field>
      <Field label={t('project.soundscape')}>
        <textarea
          value={project.audio.overallSoundscape}
          onChange={event => apply(current => ({
            ...current,
            audio: { ...current.audio, overallSoundscape: event.target.value },
          }))}
          rows={3}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
        />
      </Field>
      <Field label={t('project.music')}>
        <textarea
          value={project.audio.nonDiegeticMusic}
          onChange={event => apply(current => ({
            ...current,
            audio: { ...current.audio, nonDiegeticMusic: event.target.value },
          }))}
          rows={2}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
        />
      </Field>
    </div>
  )
}

function ShotFields({ t, shot, apply }: { t: Translate; shot: Shot; apply: Apply }) {
  const patch = (change: Partial<Shot>) => apply(current => ({
    ...current,
    shots: current.shots.map(candidate =>
      candidate.id === shot.id ? { ...candidate, ...change } : candidate),
  }))

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs uppercase tracking-wide text-neutral-500">
        {t('shot.number', { number: shot.index + 1 })}
      </p>
      <Field label={t('shot.composition')}>
        <input
          value={shot.composition}
          onChange={event => patch({ composition: event.target.value })}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
        />
      </Field>
      {shot.index > 0 && (
        <Field label={t('shot.startMs')}>
          <input
            type="number"
            value={shot.startMs}
            onChange={event => patch({ startMs: toMs(event.target.value, shot.startMs) })}
            className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          />
        </Field>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs uppercase tracking-wide text-neutral-500">{label}</span>
      {children}
    </label>
  )
}
```

- [ ] **Step 5: Wstaw panele do edytora**

W `web/src/screens/Editor.tsx` zamień siatkę dwóch kolumn na cztery:

```tsx
      <div className="grid flex-1 grid-cols-[220px_1fr_1fr_280px] overflow-hidden divide-x divide-neutral-800">
        <ShotList />
        <PromptPanel />
        <ValidationPanel />
        <Inspector />
      </div>
```

Dopisz importy `ShotList` i `Inspector`.

- [ ] **Step 6: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web && npm run typecheck`
Expected: PASS, 10 nowych testów

- [ ] **Step 7: Commit**

```bash
cd ~/mmh3-studio
git add web
git commit -m "feat: lista ujec i inspektor kontekstowy"
```

---

### Task 13: Bin assetów, etykiety i mówcy

**Files:**
- Create: `web/src/panels/AssetBin.tsx`
- Create: `web/src/api/uploadAsset.ts`
- Modify: `web/src/screens/Editor.tsx`
- Test: `web/test/panels/assetBin.test.tsx`

**Interfaces:**
- Consumes: `useProject`, `useSelection`, `useT`
- Produces:
  - `uploadAsset(slug: string, file: File): Promise<{ asset: Asset; project: Project }>`
  - `<AssetBin slug={string} />` — assety, etykiety `<Subject N>` / `<Picture N>` / `<Video N>` / `<Audio N>`, mówcy

Etykieta powstaje z assetu jednym kliknięciem i sama dostaje kolejny wolny numer w swojej kategorii — numeracja jest niezależna dla każdej z czterech rodzin, tak jak wymaga guide.

- [ ] **Step 1: Napisz testy**

`web/test/panels/assetBin.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@mmh3/shared'
import { AssetBin } from '../../src/panels/AssetBin.js'
import { useProject } from '../../src/store/projectStore.js'
import { useLang } from '../../src/i18n/useT.js'

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'REF',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Sitcom', assets: [
    { id: 'asset-1', kind: 'image', path: 'assets/asset-1.png', fileName: 'kadr.png' },
    { id: 'asset-2', kind: 'audio', path: 'assets/asset-2.wav', fileName: 'glos.wav' },
  ],
  labels: [], speakers: [],
  shots: [{
    id: 'shot-1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
    composition: '', body: [], cameraMoves: [], dialogue: [],
    screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
  }],
  audio: { overallSoundscape: 'Room tone.', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useProject.getState().load('test', project)
})

describe('AssetBin', () => {
  it('wypisuje assety z nazwami plików', () => {
    render(<AssetBin slug="test" />)
    expect(screen.getByText('kadr.png')).toBeInTheDocument()
    expect(screen.getByText('glos.wav')).toBeInTheDocument()
  })

  it('tworzy etykietę obrazu z kolejnym numerem', async () => {
    render(<AssetBin slug="test" />)
    await userEvent.click(screen.getAllByRole('button', { name: /utwórz etykietę/i })[0]!)
    const labels = useProject.getState().project!.labels
    expect(labels).toHaveLength(1)
    expect(labels[0]!.kind).toBe('picture')
    expect(labels[0]!.index).toBe(1)
  })

  it('numeruje etykiety niezależnie w każdej kategorii', async () => {
    render(<AssetBin slug="test" />)
    const buttons = screen.getAllByRole('button', { name: /utwórz etykietę/i })
    await userEvent.click(buttons[0]!)
    await userEvent.click(buttons[1]!)
    const labels = useProject.getState().project!.labels
    expect(labels.find(l => l.kind === 'picture')!.index).toBe(1)
    expect(labels.find(l => l.kind === 'audio')!.index).toBe(1)
  })

  it('dodaje mówcę z kolejnym kodem', async () => {
    render(<AssetBin slug="test" />)
    await userEvent.click(screen.getByRole('button', { name: /dodaj mówcę/i }))
    await userEvent.click(screen.getByRole('button', { name: /dodaj mówcę/i }))
    const speakers = useProject.getState().project!.speakers
    expect(speakers.map(s => s.code)).toEqual(['S1', 'S2'])
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- assetBin`
Expected: FAIL — brak modułu

- [ ] **Step 3: Zaimplementuj wgrywanie**

`web/src/api/uploadAsset.ts`:

```ts
import type { Asset, Project } from '@mmh3/shared'
import { ApiError } from './client.js'

export async function uploadAsset(
  slug: string,
  file: File,
): Promise<{ asset: Asset; project: Project }> {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`/api/projects/${slug}/assets`, { method: 'POST', body: form })
  if (!response.ok) {
    let message = `Serwer odpowiedział kodem ${response.status}`
    try {
      const body = await response.json() as { error?: string }
      if (body.error) message = body.error
    } catch {
      // Odpowiedź bez JSON-a — zostaje komunikat z kodem statusu.
    }
    throw new ApiError(message, response.status)
  }
  return await response.json() as { asset: Asset; project: Project }
}
```

- [ ] **Step 4: Zaimplementuj panel**

`web/src/panels/AssetBin.tsx`:

```tsx
import { useRef, useState } from 'react'
import { describeSpeaker, type Asset, type Label, type LabelKind, type Speaker } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { useT } from '../i18n/useT.js'
import { uploadAsset } from '../api/uploadAsset.js'

const LABEL_KIND_BY_ASSET: Record<Asset['kind'], LabelKind> = {
  image: 'picture',
  video: 'video',
  audio: 'audio',
}

const LABEL_NAME: Record<LabelKind, string> = {
  subject: 'Subject', picture: 'Picture', video: 'Video', audio: 'Audio',
}

export function AssetBin({ slug }: { slug: string }) {
  const t = useT()
  const project = useProject(state => state.project)
  const apply = useProject(state => state.apply)
  const load = useProject(state => state.load)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  if (!project) return null

  const pickFile = async (file: File) => {
    try {
      const { project: updated } = await uploadAsset(slug, file)
      load(slug, updated)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const addLabel = (asset: Asset) => apply(current => {
    const kind = LABEL_KIND_BY_ASSET[asset.kind]
    const nextIndex = current.labels.filter(label => label.kind === kind).length + 1
    const label: Label = {
      id: `label-${kind}-${nextIndex}`,
      kind,
      index: nextIndex,
      assetIds: [asset.id],
      definition: '',
      role: '',
      standalone: true,
    }
    return { ...current, labels: [...current.labels, label] }
  })

  const addSpeaker = () => apply(current => {
    const code = `S${current.speakers.length + 1}`
    const speaker: Speaker = {
      id: `speaker-${code}`,
      code,
      characterType: '', age: '', gender: '', pitch: '', timbre: '', rate: '', accent: '',
      onScreen: true, fullDescriptor: '', shortDescriptor: '',
    }
    return { ...current, speakers: [...current.speakers, speaker] }
  })

  const regenerate = (speaker: Speaker) => apply(current => ({
    ...current,
    speakers: current.speakers.map(candidate => {
      if (candidate.id !== speaker.id) return candidate
      const described = describeSpeaker(candidate)
      return { ...candidate, fullDescriptor: described.full, shortDescriptor: described.short }
    }),
  }))

  return (
    <section aria-label={t('editor.assets')} className="flex h-full flex-col gap-4 overflow-auto p-3">
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-neutral-500">{t('editor.assets')}</span>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:border-neutral-500"
          >
            +
          </button>
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0]
              if (file) void pickFile(file)
            }}
          />
        </div>
        <ul className="flex flex-col gap-1">
          {project.assets.map(asset => (
            <li key={asset.id} className="flex items-center gap-2 text-sm">
              <span className="font-mono text-[10px] text-neutral-500">{asset.kind}</span>
              <span className="flex-1 truncate">{asset.fileName}</span>
              <button
                type="button"
                onClick={() => addLabel(asset)}
                aria-label={t('editor.makeLabel')}
                className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] hover:border-neutral-500"
              >
                {'<>'}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <span className="mb-2 block text-xs uppercase tracking-wide text-neutral-500">
          {t('editor.labels')}
        </span>
        <ul className="flex flex-col gap-1 font-mono text-xs">
          {project.labels.map(label => (
            <li key={label.id}>{`<${LABEL_NAME[label.kind]} ${label.index}>`}</li>
          ))}
        </ul>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-neutral-500">{t('editor.speakers')}</span>
          <button
            type="button"
            onClick={addSpeaker}
            className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:border-neutral-500"
          >
            {t('editor.addSpeaker')}
          </button>
        </div>
        <ul className="flex flex-col gap-1 text-sm">
          {project.speakers.map(speaker => (
            <li key={speaker.id} className="flex items-center gap-2">
              <span className="font-mono text-xs">({speaker.code})</span>
              <span className="flex-1 truncate text-neutral-400">
                {speaker.fullDescriptor || '—'}
              </span>
              <button
                type="button"
                onClick={() => regenerate(speaker)}
                className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] hover:border-neutral-500"
              >
                ↻
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Wstaw panel do edytora**

W `web/src/screens/Editor.tsx` zamień siatkę na pięć kolumn i dopisz import:

```tsx
      <div className="grid flex-1 grid-cols-[200px_200px_1fr_1fr_280px] overflow-hidden divide-x divide-neutral-800">
        <AssetBin slug={slug} />
        <ShotList />
        <PromptPanel />
        <ValidationPanel />
        <Inspector />
      </div>
```

- [ ] **Step 6: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web && npm run typecheck`
Expected: PASS, 4 nowe testy

- [ ] **Step 7: Commit**

```bash
cd ~/mmh3-studio
git add web
git commit -m "feat: bin assetow z etykietami referencyjnymi i mowcami"
```

---

### Task 14: Autozapis i eksport w interfejsie

**Files:**
- Create: `web/src/store/useAutosave.ts`
- Create: `web/src/panels/ExportPanel.tsx`
- Modify: `web/src/screens/Editor.tsx`
- Modify: `web/src/i18n/dict.ts`
- Test: `web/test/store/useAutosave.test.tsx`
- Test: `web/test/panels/exportPanel.test.tsx`

**Interfaces:**
- Consumes: `useProject`, `api`, `isExportReady`
- Produces:
  - `useAutosave(slug: string, delayMs?: number): { saving: boolean; error: string | null }`
  - `<ExportPanel slug={string} />`

Autozapis wysyła projekt dopiero po chwili bezczynności, żeby wpisywanie tekstu nie zamieniło się w strumień żądań. Eksport promptu i projektu to zwykłe odnośniki do backendu; workflow ComfyUI wymaga wskazania węzła i pola, więc ma własny formularz.

- [ ] **Step 1: Napisz testy autozapisu**

`web/test/store/useAutosave.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { Project } from '@mmh3/shared'
import { useAutosave } from '../../src/store/useAutosave.js'
import { useProject } from '../../src/store/projectStore.js'
import { api } from '../../src/api/client.js'

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: '', assets: [], labels: [], speakers: [],
  shots: [{
    id: 'shot-1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
    composition: '', body: [], cameraMoves: [], dialogue: [],
    screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
  }],
  audio: { overallSoundscape: '', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

beforeEach(() => {
  useProject.getState().load('test', project)
})

afterEach(() => vi.restoreAllMocks())

describe('useAutosave', () => {
  it('nie zapisuje projektu, którego nikt nie zmienił', async () => {
    const save = vi.spyOn(api, 'saveProject').mockResolvedValue({ prompt: '', tokens: [], diagnostics: [] })
    renderHook(() => useAutosave('test', 5))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(save).not.toHaveBeenCalled()
  })

  it('zapisuje po chwili bezczynności', async () => {
    const save = vi.spyOn(api, 'saveProject').mockResolvedValue({ prompt: '', tokens: [], diagnostics: [] })
    renderHook(() => useAutosave('test', 5))
    act(() => useProject.getState().apply(p => ({ ...p, style: 'Live-action' })))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0]![1].style).toBe('Live-action')
  })

  it('zbija serię szybkich zmian w jeden zapis', async () => {
    const save = vi.spyOn(api, 'saveProject').mockResolvedValue({ prompt: '', tokens: [], diagnostics: [] })
    renderHook(() => useAutosave('test', 20))
    act(() => {
      useProject.getState().apply(p => ({ ...p, style: 'A' }))
      useProject.getState().apply(p => ({ ...p, style: 'AB' }))
      useProject.getState().apply(p => ({ ...p, style: 'ABC' }))
    })
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0]![1].style).toBe('ABC')
  })

  it('zdejmuje znacznik zmiany po udanym zapisie', async () => {
    vi.spyOn(api, 'saveProject').mockResolvedValue({ prompt: '', tokens: [], diagnostics: [] })
    renderHook(() => useAutosave('test', 5))
    act(() => useProject.getState().apply(p => ({ ...p, style: 'X' })))
    await waitFor(() => expect(useProject.getState().dirty).toBe(false))
  })

  it('nie uznaje za zapisaną edycji wykonanej w trakcie zapisu', async () => {
    let release: () => void = () => {}
    vi.spyOn(api, 'saveProject').mockImplementation(
      () => new Promise(resolve => { release = () => resolve({ prompt: '', tokens: [], diagnostics: [] }) }),
    )
    renderHook(() => useAutosave('test', 5))
    act(() => useProject.getState().apply(p => ({ ...p, style: 'pierwsza' })))
    await waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1))
    act(() => useProject.getState().apply(p => ({ ...p, style: 'druga' })))
    act(() => release())
    await waitFor(() => expect(useProject.getState().project!.style).toBe('druga'))
    expect(useProject.getState().dirty).toBe(true)
  })

  it('pokazuje błąd i zostawia znacznik zmiany, gdy zapis padnie', async () => {
    vi.spyOn(api, 'saveProject').mockRejectedValue(new Error('dysk pełny'))
    const { result } = renderHook(() => useAutosave('test', 5))
    act(() => useProject.getState().apply(p => ({ ...p, style: 'X' })))
    await waitFor(() => expect(result.current.error).toMatch(/dysk pełny/))
    expect(useProject.getState().dirty).toBe(true)
  })
})
```

- [ ] **Step 2: Napisz testy panelu eksportu**

`web/test/panels/exportPanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExportPanel } from '../../src/panels/ExportPanel.js'
import { useProject } from '../../src/store/projectStore.js'
import { useLang } from '../../src/i18n/useT.js'

const diagnostic = {
  ruleId: 'STYLE_REQUIRED', severity: 'error' as const,
  message: 'Brak stylu.', messageEn: 'No style.',
  ref: { kind: 'project' as const, id: 'p' }, guideRef: 'guide_base §4.1',
}

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useProject.setState({ diagnostics: [], prompt: 'x', tokens: [] })
})

describe('ExportPanel', () => {
  it('udostępnia odnośniki do promptu i projektu', () => {
    render(<ExportPanel slug="test" />)
    expect(screen.getByRole('link', { name: /prompt/i }))
      .toHaveAttribute('href', '/api/projects/test/export/prompt')
    expect(screen.getByRole('link', { name: /projekt/i }))
      .toHaveAttribute('href', '/api/projects/test/export/project')
  })

  it('ostrzega, gdy walidator zgłasza błąd', () => {
    useProject.setState({ diagnostics: [diagnostic] })
    render(<ExportPanel slug="test" />)
    expect(screen.getByText(/eksport zablokowany/i)).toBeInTheDocument()
  })

  it('nie ostrzega, gdy są tylko wskazówki', () => {
    useProject.setState({ diagnostics: [{ ...diagnostic, severity: 'hint' }] })
    render(<ExportPanel slug="test" />)
    expect(screen.queryByText(/eksport zablokowany/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test --workspace @mmh3/web -- useAutosave exportPanel`
Expected: FAIL — brak modułów

- [ ] **Step 4: Zaimplementuj autozapis**

`web/src/store/useAutosave.ts`:

```ts
import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client.js'
import { useProject } from './projectStore.js'

const DEFAULT_DELAY_MS = 800

/**
 * Wysyła projekt na serwer po chwili bezczynności. Bez opóźnienia każde
 * naciśnięcie klawisza w polu tekstowym byłoby osobnym żądaniem.
 */
export function useAutosave(slug: string, delayMs = DEFAULT_DELAY_MS) {
  const project = useProject(state => state.project)
  const dirty = useProject(state => state.dirty)
  const markSaved = useProject(state => state.markSaved)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!dirty || !project) return
    if (timer.current) clearTimeout(timer.current)

    timer.current = setTimeout(() => {
      setSaving(true)
      api.saveProject(slug, project)
        .then(() => {
          setError(null)
          // Znacznik zdejmujemy tylko, jeśli w trakcie zapisu nic się nie zmieniło.
          // Inaczej edycja wykonana w locie zostałaby uznana za zapisaną i po
          // przeładowaniu zniknęłaby bez ostrzeżenia.
          if (useProject.getState().project === project) markSaved()
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => setSaving(false))
    }, delayMs)

    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [slug, project, dirty, delayMs, markSaved])

  return { saving, error }
}
```

- [ ] **Step 5: Zaimplementuj panel eksportu**

`web/src/panels/ExportPanel.tsx`:

```tsx
import { useState } from 'react'
import { isExportReady } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { useT } from '../i18n/useT.js'

export function ExportPanel({ slug }: { slug: string }) {
  const t = useT()
  const diagnostics = useProject(state => state.diagnostics)
  const [nodeId, setNodeId] = useState('')
  const [field, setField] = useState('text')
  const [workflow, setWorkflow] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)

  const ready = isExportReady(diagnostics)

  const exportComfy = async () => {
    if (!workflow || !nodeId || !field) return
    try {
      const response = await fetch(`/api/projects/${slug}/export/comfy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workflow, nodeId, field }),
      })
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? `Serwer odpowiedział kodem ${response.status}`)
        return
      }
      setError(null)
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = `${slug}-workflow.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section aria-label={t('export.title')} className="flex flex-col gap-2 p-3 text-sm">
      <span className="text-xs uppercase tracking-wide text-neutral-500">{t('export.title')}</span>
      {!ready && <p className="text-xs text-red-400">{t('export.blocked')}</p>}

      <a href={`/api/projects/${slug}/export/prompt`} className="underline hover:text-sky-400">
        {t('export.prompt')}
      </a>
      <a href={`/api/projects/${slug}/export/project`} className="underline hover:text-sky-400">
        {t('export.project')}
      </a>

      <label className="mt-2 block text-xs">
        <span className="mb-1 block text-neutral-500">{t('export.comfyUpload')}</span>
        <input
          type="file"
          accept="application/json"
          onChange={async event => {
            const file = event.target.files?.[0]
            if (!file) return
            try {
              setWorkflow(JSON.parse(await file.text()))
              setError(null)
            } catch {
              setError('Plik nie jest poprawnym JSON-em')
            }
          }}
        />
      </label>

      <label className="block text-xs">
        <span className="mb-1 block text-neutral-500">{t('export.comfyNode')}</span>
        <input
          value={nodeId}
          onChange={event => setNodeId(event.target.value)}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
        />
      </label>

      <label className="block text-xs">
        <span className="mb-1 block text-neutral-500">{t('export.comfyField')}</span>
        <input
          value={field}
          onChange={event => setField(event.target.value)}
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
        />
      </label>

      <button
        type="button"
        onClick={exportComfy}
        disabled={!workflow || !nodeId || !field}
        className="rounded border border-neutral-700 px-2 py-1 text-xs disabled:opacity-40"
      >
        {t('export.comfy')}
      </button>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </section>
  )
}
```

- [ ] **Step 6: Podłącz w edytorze**

W `web/src/screens/Editor.tsx` wywołaj `useAutosave(slug)` obok pozostałych hooków i wstaw `<ExportPanel slug={slug} />` pod inspektorem — najprościej owijając prawą kolumnę:

```tsx
        <div className="flex flex-col divide-y divide-neutral-800 overflow-auto">
          <Inspector />
          <ExportPanel slug={slug} />
        </div>
```

Pokaż stan zapisu w pasku nagłówka edytora: gdy `saving` jest prawdą, wypisz `t('common.loading')`; gdy `error` nie jest pusty, wypisz go na czerwono.

- [ ] **Step 7: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test && npm run typecheck`
Expected: PASS — wszystko zielone, w tym pięć testów złotych

- [ ] **Step 8: Commit**

```bash
cd ~/mmh3-studio
git add web
git commit -m "feat: autozapis projektu i eksport wraz z workflow ComfyUI"
```

---

### Task 15: Test end-to-end całej ścieżki

**Files:**
- Create: `web/playwright.config.ts`
- Create: `web/e2e/happyPath.spec.ts`
- Modify: `web/package.json` (skrypt `e2e`, zależność `@playwright/test`)
- Modify: `package.json` (skrypt `e2e`)

**Interfaces:**
- Consumes: cała aplikacja
- Produces: `npm run e2e` — uruchamia backend i frontend, przechodzi ścieżkę od utworzenia projektu do eksportu

- [ ] **Step 1: Napisz test**

`web/e2e/happyPath.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('od utworzenia projektu do gotowego promptu', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: /nowy projekt/i }).click()
  await page.getByLabel(/nazwa projektu/i).fill(`E2E ${Date.now()}`)
  await page.getByRole('button', { name: /T2VA/ }).click()
  await page.getByRole('button', { name: /^utwórz$/i }).click()

  // Świeży projekt nie ma stylu, więc walidator musi to zgłosić.
  await expect(page.getByText(/wymaga podania stylu/i)).toBeVisible()

  await page.getByLabel(/styl wizualny/i).fill('Live-action, cinematic')
  await expect(page.getByText(/Live-action, cinematic/).first()).toBeVisible()

  await page.getByLabel(/tło dźwiękowe/i).fill('Rain taps the window.')
  await expect(page.getByText(/gotowy do eksportu/i)).toBeVisible()

  // Zmiana języka przełącza interfejs, ale nie prompt.
  await page.getByRole('button', { name: 'EN' }).click()
  await expect(page.getByText(/ready to export/i)).toBeVisible()
  await expect(page.getByText(/integrated_multimodal_description/)).toBeVisible()
})
```

- [ ] **Step 2: Skonfiguruj Playwrighta**

`web/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5173', headless: true },
  webServer: [
    {
      command: 'npm run start --workspace @mmh3/server',
      url: 'http://127.0.0.1:8899/api/health',
      reuseExistingServer: true,
      env: { MMH3_DATA_ROOT: '/tmp/mmh3-e2e' },
      cwd: '..',
    },
    {
      command: 'npm run dev --workspace @mmh3/web',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
      cwd: '..',
    },
  ],
})
```

W `web/package.json` dopisz do `devDependencies` `"@playwright/test": "^1.49.1"` i do `scripts` `"e2e": "playwright test"`. W `package.json` w katalogu głównym dopisz `"e2e": "npm run e2e --workspace @mmh3/web"`.

- [ ] **Step 3: Zainstaluj przeglądarkę i uruchom test**

Run:

```bash
cd ~/mmh3-studio
npm install
npx playwright install chromium --with-deps
rm -rf /tmp/mmh3-e2e
npm run e2e
```

Expected: 1 passed

Jeśli instalacja przeglądarki nie powiedzie się z powodu braku uprawnień do pakietów systemowych, spróbuj bez `--with-deps`. Jeśli i to zawiedzie, zgłoś to jako BLOCKED z pełnym komunikatem — **nie usuwaj testu ani nie oznaczaj go jako pominiętego**.

- [ ] **Step 4: Commit**

```bash
cd ~/mmh3-studio
git add package.json package-lock.json web
git commit -m "test: sciezka end-to-end od utworzenia projektu do eksportu"
```

---

## Definicja ukończenia

- `npm test` — wszystkie testy zielone we wszystkich trzech pakietach, w tym pięć testów złotych odtwarzających dokumentację dostawcy znak w znak
- `npm run typecheck` — czysty we wszystkich pakietach
- `npm run e2e` — ścieżka od utworzenia projektu do gotowego promptu przechodzi
- `npm run dev:api` i `npm run dev:web` podnoszą aplikację na portach 8899 i 5173
- Projekt da się utworzyć, wybrać mu tryb, wypełnić styl i dźwięk, zobaczyć prompt na żywo, klikać diagnostykę, wgrać asset, zrobić z niego etykietę i wyeksportować prompt oraz workflow ComfyUI
- `shared/` nie zmienił się poza zadaniem 1

## Świadomie poza zakresem tego planu

Specyfikacja wymienia trzy rzeczy, których ten plan nie realizuje. Żadna nie
blokuje działającej aplikacji, wszystkie mają swoje miejsce później:

- **Oś czasu.** `ShotList` jest tymczasową namiastką. Ścieżki, klipy, playhead,
  snapowanie do klatek i monitor storyboardu to całość Planu 3.
- **Ręczne migawki wersji projektu.** Jest autozapis, nie ma historii wersji na
  dysku. Dopisać razem z osią czasu, kiedy będzie co wersjonować.
- **Eksport pojedynczych sekcji osobno.** Eksportujemy cały prompt, projekt
  i workflow; wycinanie samego `overall_soundscape` poczeka na realną potrzebę.

Po zamknięciu tego planu powstaje **Plan 3 (montażownia)**, który zastąpi `ShotList` pełną osią czasu z klipami, ścieżkami, playheadem i monitorem storyboardu, oraz **Plan 4 (LLM)** z dwoma dostawcami modelu lokalnego.
