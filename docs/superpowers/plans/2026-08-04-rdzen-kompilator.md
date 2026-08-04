# MMH3 Prompt Studio — Plan 1: rdzeń (model, kompilator, walidator)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zbudować pakiet `shared/` — czysty TypeScript bez zależności od Reacta i Node'a — który zamienia model projektu na prompt MiniMax-H3 znak w znak zgodny z guide'ami oraz zwraca diagnostykę z 40 nazwanych reguł.

**Architecture:** Model domeny opisany typami i schematami Zod. Kompilator to czysta funkcja `compile(project)` z dwoma emiterami (bazowy i referencyjny), składająca prozę ujęcia z listy segmentów, dzięki czemu ruch kamery, opis mówcy i dialog mieszczą się w jednym zdaniu. Walidator to rejestr niezależnych reguł, każda zwracająca diagnostykę ze wskaźnikiem na obiekt modelu. Dowodem poprawności są testy złote: pięć przykładów przepisanych z dokumentacji MiniMaxAI musi się skompilować bajt w bajt.

**Tech Stack:** TypeScript 5, Vitest 3, Zod 3, tsx (CLI). Node 20. npm workspaces.

## Global Constraints

- Pakiet `shared/` nie importuje niczego z Reacta ani z `node:*` — wyjątkiem jest wyłącznie `shared/src/cli.ts`.
- FPS jest stałe i wynosi **24**. Długość wideo: **4000–15000 ms**.
- Timestamp ujęcia: format **`MM:SS.mmm`**. Czas w linii alignmentu: **`S.SS`**, dokładnie dwa miejsca po przecinku.
- `[Shot 1]` **nigdy** nie dostaje timestampu.
- Teksty źródłowe guide'ów leżą w `docs/guide_base.md` i `docs/guide_ref.md`. Przy rozbieżności między tym planem a guide'em wygrywa guide.
- Treść wewnątrz `<d>…</d>` jest **verbatim** — żaden kod nie tłumaczy jej, nie przycina ani nie zmienia interpunkcji.
- Każda diagnostyka ma komunikat po polsku (`message`) i po angielsku (`messageEn`) oraz odwołanie do sekcji guide'a (`guideRef`).
- Commity po polsku, w trybie rozkazującym, prefiks `feat:` / `test:` / `chore:`.
- Wszystkie identyfikatory obiektów są jawnie podawane w fixture'ach testowych — brak losowości w testach.

---

### Task 1: Szkielet workspace'u i narzędzi

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/vitest.config.ts`
- Create: `shared/src/index.ts`
- Test: `shared/test/smoke.test.ts`

**Interfaces:**
- Consumes: nic
- Produces: skrypt `npm test` w katalogu głównym uruchamiający Vitest w `shared/`; alias importów `@mmh3/shared`

- [ ] **Step 1: Napisz test dymny**

`shared/test/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { VERSION } from '../src/index.js'

describe('pakiet shared', () => {
  it('eksportuje wersję', () => {
    expect(VERSION).toBe('0.1.0')
  })
})
```

- [ ] **Step 2: Uruchom test i potwierdź, że nie przechodzi**

Run: `cd ~/mmh3-studio && npm test`
Expected: FAIL — brak `package.json` / brak modułu `../src/index.js`

- [ ] **Step 3: Utwórz pliki konfiguracyjne**

`package.json`:

```json
{
  "name": "mmh3-studio",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "workspaces": ["shared"],
  "scripts": {
    "test": "npm test --workspace @mmh3/shared",
    "typecheck": "npm run typecheck --workspace @mmh3/shared"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "noEmit": true
  }
}
```

`shared/package.json`:

```json
{
  "name": "@mmh3/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^3.0.5",
    "tsx": "^4.19.2"
  }
}
```

`shared/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "include": ["src", "test"]
}
```

`shared/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
```

`shared/src/index.ts`:

```ts
export const VERSION = '0.1.0'
```

- [ ] **Step 4: Zainstaluj zależności i uruchom test**

Run: `cd ~/mmh3-studio && npm install && npm test`
Expected: PASS, 1 test

- [ ] **Step 5: Commit**

```bash
cd ~/mmh3-studio
git add package.json package-lock.json tsconfig.base.json shared/
git commit -m "chore: szkielet workspace shared z Vitest i TypeScript"
```

---

### Task 2: Typy domeny i schematy Zod

**Files:**
- Create: `shared/src/model/types.ts`
- Create: `shared/src/model/schema.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/test/model/schema.test.ts`

**Interfaces:**
- Consumes: nic
- Produces: wszystkie typy domeny oraz `ProjectSchema` (Zod) i `parseProject(input: unknown): Project`

- [ ] **Step 1: Napisz testy schematu**

`shared/test/model/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseProject, ProjectSchema } from '../../src/model/schema.js'
import type { Project } from '../../src/model/types.js'

const minimal: Project = {
  schemaVersion: 1,
  id: 'p1',
  name: 'Test',
  mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic',
  assets: [],
  labels: [],
  speakers: [],
  shots: [],
  audio: { overallSoundscape: 'N/A', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

describe('ProjectSchema', () => {
  it('przyjmuje minimalny poprawny projekt', () => {
    expect(() => parseProject(minimal)).not.toThrow()
  })

  it('odrzuca nieznany tryb', () => {
    const bad = { ...minimal, mode: 'X2VA' }
    expect(ProjectSchema.safeParse(bad).success).toBe(false)
  })

  it('odrzuca fps inne niż 24', () => {
    const bad = { ...minimal, video: { ...minimal.video, fps: 30 } }
    expect(ProjectSchema.safeParse(bad).success).toBe(false)
  })

  it('odrzuca nieznany typ ruchu kamery', () => {
    const bad = {
      ...minimal,
      shots: [
        {
          id: 's1', index: 0, startMs: 0, cutType: 'cut',
          cutPhrase: 'the camera cuts to', composition: '', body: [],
          cameraMoves: [{ id: 'c1', type: 'barrel-roll', startMs: 0, endMs: 1000 }],
          dialogue: [], screenText: [], diegeticSfx: [], labelRefs: [], anchor: 'none',
        },
      ],
    }
    expect(ProjectSchema.safeParse(bad).success).toBe(false)
  })

  it('odrzuca segment wskazujący nieznany rodzaj', () => {
    const bad = {
      ...minimal,
      shots: [
        {
          id: 's1', index: 0, startMs: 0, cutType: 'cut',
          cutPhrase: 'the camera cuts to', composition: '',
          body: [{ kind: 'sparkle' }],
          cameraMoves: [], dialogue: [], screenText: [], diegeticSfx: [],
          labelRefs: [], anchor: 'none',
        },
      ],
    }
    expect(ProjectSchema.safeParse(bad).success).toBe(false)
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test`
Expected: FAIL — brak modułu `src/model/schema.js`

- [ ] **Step 3: Napisz typy domeny**

`shared/src/model/types.ts`:

```ts
export const FPS = 24 as const
export const MIN_DURATION_MS = 4000
export const MAX_DURATION_MS = 15000

export type Mode = 'T2VA' | 'I2VA' | 'FL2VA' | 'L2VA' | 'REF'
export type Aspect = '16:9' | '4:3' | '1:1' | '9:16'

export type CameraMotion =
  | 'zoom-in' | 'zoom-out'
  | 'push-in' | 'pull-out'
  | 'pan-left' | 'pan-right'
  | 'truck-left' | 'truck-right'
  | 'tilt-up' | 'tilt-down'
  | 'pedestal-up' | 'pedestal-down'
  | 'arc' | 'tracking' | 'static'
  | 'shake-slightly' | 'shake-strongly'
  | 'pov' | 'roll-cw' | 'roll-ccw'

export type Amplitude = 'small' | 'large'
export type Speed = 'slow' | 'fast'

export interface CameraMove {
  id: string
  type: CameraMotion
  amplitude?: Amplitude
  speed?: Speed
  /** Dopełnienie frazy, np. "toward the folded letter in her hands". */
  target?: string
  /** Pełne nadpisanie frazy, gdy proza wymaga innego brzmienia. */
  customPhrase?: string
  startMs: number
  endMs: number
}

export interface Speaker {
  id: string
  /** Renderowane ID bez nawiasów, np. "S1". */
  code: string
  characterType: string
  age: string
  gender: string
  pitch: string
  timbre: string
  rate: string
  accent: string
  onScreen: boolean
  /** Domyślny opis przy pierwszym wystąpieniu. */
  fullDescriptor: string
  /** Domyślny opis przy kolejnych wystąpieniach. */
  shortDescriptor: string
}

export interface DialogueEvent {
  id: string
  speakerIds: string[]
  /** Czasownik z określeniem sposobu podania, np. "says", "exclaims with light annoyance". */
  verb: string
  /** Znak oddzielający czasownik od bloku <d>. */
  punctuation: ':' | ','
  language: string
  /** Treść verbatim. Nigdy nie modyfikowana przez kod. */
  text: string
  voiceover: boolean
  /** Zdanie o zamkniętych ustach, wymagane po bloku <d> voiceoveru. */
  lipsClause?: string
  sceneTransBefore: boolean
  sceneTransAfter: boolean
  continuityPhrase?: string
  cutoff: boolean
  startMs: number
  endMs: number
}

export interface ScreenText {
  id: string
  text: string
}

export interface DiegeticSfx {
  id: string
  description: string
  startMs: number
  endMs: number
}

export type LabelKind = 'subject' | 'picture' | 'video' | 'audio'

export interface Label {
  id: string
  kind: LabelKind
  index: number
  assetIds: string[]
  definition: string
  role: string
  standalone: boolean
}

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'camera'; moveId: string }
  | { kind: 'speaker'; speakerId: string; descriptor?: string; form: 'full' | 'short' | 'idOnly' }
  | { kind: 'dialogue'; eventId: string }
  | { kind: 'label'; labelId: string; speakerId?: string; bracketed: boolean }
  | { kind: 'screenText'; id: string }

export type CutType = 'cut' | 'cross-dissolve' | 'fade' | 'wipe'

export type CutPhrase =
  | 'the camera cuts to'
  | 'the shot cuts to'
  | 'the shot transitions to'
  | 'the shot changes to'
  | 'the shot switches to'

export type Anchor = 'none' | 'picture-first' | 'picture-last' | 'keyframe'

export interface Shot {
  id: string
  index: number
  startMs: number
  cutType: CutType
  cutPhrase: CutPhrase
  composition: string
  body: Segment[]
  cameraMoves: CameraMove[]
  dialogue: DialogueEvent[]
  screenText: ScreenText[]
  diegeticSfx: DiegeticSfx[]
  labelRefs: string[]
  anchor: Anchor
}

export interface Asset {
  id: string
  kind: 'image' | 'video' | 'audio'
  path: string
  fileName: string
}

export type RefTaskType =
  | 'keyframe completion'
  | 'reference generation'
  | 'video editing'
  | 'video continuation'
  | 'audio reuse'
  | 'audio reference'

export type VisualMarker =
  | 'fully_preserved' | 'partially_preserved' | 'attribute_transfer' | 'weak_reference'

export type AudioMarker =
  | 'fully_copy' | 'partially_copy' | 'reference' | 'weak_reference'

export interface RetentionEntry {
  id: string
  labelId: string
  /** Treść nawiasu, np. "appears in [Shot 1], [Shot 3]". Pusty ciąg = bez nawiasu. */
  scope: string
  marker: VisualMarker | AudioMarker
  note: string
}

export interface Project {
  schemaVersion: 1
  id: string
  name: string
  mode: Mode
  video: { durationMs: number; fps: typeof FPS; aspect: Aspect; resolution: string }
  style: string
  assets: Asset[]
  labels: Label[]
  speakers: Speaker[]
  shots: Shot[]
  audio: { overallSoundscape: string; nonDiegeticMusic: string }
  ref: { taskTypes: RefTaskType[]; summaryText: string; retention: RetentionEntry[] }
}
```

- [ ] **Step 4: Napisz schematy Zod**

`shared/src/model/schema.ts`:

```ts
import { z } from 'zod'
import type { Project } from './types.js'

export const CameraMotionSchema = z.enum([
  'zoom-in', 'zoom-out', 'push-in', 'pull-out',
  'pan-left', 'pan-right', 'truck-left', 'truck-right',
  'tilt-up', 'tilt-down', 'pedestal-up', 'pedestal-down',
  'arc', 'tracking', 'static',
  'shake-slightly', 'shake-strongly',
  'pov', 'roll-cw', 'roll-ccw',
])

export const CameraMoveSchema = z.object({
  id: z.string(),
  type: CameraMotionSchema,
  amplitude: z.enum(['small', 'large']).optional(),
  speed: z.enum(['slow', 'fast']).optional(),
  target: z.string().optional(),
  customPhrase: z.string().optional(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
})

export const SpeakerSchema = z.object({
  id: z.string(),
  code: z.string(),
  characterType: z.string(),
  age: z.string(),
  gender: z.string(),
  pitch: z.string(),
  timbre: z.string(),
  rate: z.string(),
  accent: z.string(),
  onScreen: z.boolean(),
  fullDescriptor: z.string(),
  shortDescriptor: z.string(),
})

export const DialogueEventSchema = z.object({
  id: z.string(),
  speakerIds: z.array(z.string()).min(1),
  verb: z.string(),
  punctuation: z.enum([':', ',']),
  language: z.string(),
  text: z.string(),
  voiceover: z.boolean(),
  lipsClause: z.string().optional(),
  sceneTransBefore: z.boolean(),
  sceneTransAfter: z.boolean(),
  continuityPhrase: z.string().optional(),
  cutoff: z.boolean(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
})

export const SegmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('camera'), moveId: z.string() }),
  z.object({
    kind: z.literal('speaker'),
    speakerId: z.string(),
    descriptor: z.string().optional(),
    form: z.enum(['full', 'short', 'idOnly']),
  }),
  z.object({ kind: z.literal('dialogue'), eventId: z.string() }),
  z.object({
    kind: z.literal('label'),
    labelId: z.string(),
    speakerId: z.string().optional(),
    bracketed: z.boolean(),
  }),
  z.object({ kind: z.literal('screenText'), id: z.string() }),
])

export const ShotSchema = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  cutType: z.enum(['cut', 'cross-dissolve', 'fade', 'wipe']),
  cutPhrase: z.enum([
    'the camera cuts to',
    'the shot cuts to',
    'the shot transitions to',
    'the shot changes to',
    'the shot switches to',
  ]),
  composition: z.string(),
  body: z.array(SegmentSchema),
  cameraMoves: z.array(CameraMoveSchema),
  dialogue: z.array(DialogueEventSchema),
  screenText: z.array(z.object({ id: z.string(), text: z.string() })),
  diegeticSfx: z.array(z.object({
    id: z.string(),
    description: z.string(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
  })),
  labelRefs: z.array(z.string()),
  anchor: z.enum(['none', 'picture-first', 'picture-last', 'keyframe']),
})

export const LabelSchema = z.object({
  id: z.string(),
  kind: z.enum(['subject', 'picture', 'video', 'audio']),
  index: z.number().int().positive(),
  assetIds: z.array(z.string()),
  definition: z.string(),
  role: z.string(),
  standalone: z.boolean(),
})

export const RetentionEntrySchema = z.object({
  id: z.string(),
  labelId: z.string(),
  scope: z.string(),
  marker: z.enum([
    'fully_preserved', 'partially_preserved', 'attribute_transfer',
    'fully_copy', 'partially_copy', 'reference', 'weak_reference',
  ]),
  note: z.string(),
})

export const ProjectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  mode: z.enum(['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF']),
  video: z.object({
    durationMs: z.number().int().positive(),
    fps: z.literal(24),
    aspect: z.enum(['16:9', '4:3', '1:1', '9:16']),
    resolution: z.string(),
  }),
  style: z.string(),
  assets: z.array(z.object({
    id: z.string(),
    kind: z.enum(['image', 'video', 'audio']),
    path: z.string(),
    fileName: z.string(),
  })),
  labels: z.array(LabelSchema),
  speakers: z.array(SpeakerSchema),
  shots: z.array(ShotSchema),
  audio: z.object({
    overallSoundscape: z.string(),
    nonDiegeticMusic: z.string(),
  }),
  ref: z.object({
    taskTypes: z.array(z.enum([
      'keyframe completion', 'reference generation', 'video editing',
      'video continuation', 'audio reuse', 'audio reference',
    ])),
    summaryText: z.string(),
    retention: z.array(RetentionEntrySchema),
  }),
})

export function parseProject(input: unknown): Project {
  return ProjectSchema.parse(input) as Project
}
```

- [ ] **Step 5: Wyeksportuj i uruchom testy**

`shared/src/index.ts`:

```ts
export const VERSION = '0.1.0'
export * from './model/types.js'
export * from './model/schema.js'
```

Run: `cd ~/mmh3-studio && npm test && npm run typecheck`
Expected: PASS, 7 testów

- [ ] **Step 6: Commit**

```bash
cd ~/mmh3-studio
git add shared/src/model shared/src/index.ts shared/test/model
git commit -m "feat: typy domeny i schematy Zod dla projektu promptu"
```

---

### Task 3: Czas — klatki i formatowanie

**Files:**
- Create: `shared/src/time/frames.ts`
- Create: `shared/src/time/format.ts`
- Test: `shared/test/time/format.test.ts`

**Interfaces:**
- Consumes: `FPS` z `model/types.ts`
- Produces:
  - `MS_PER_FRAME: number`
  - `snapToFrame(ms: number): number`
  - `isFrameAligned(ms: number): boolean`
  - `formatShotTime(ms: number): string` — `MM:SS.mmm`
  - `formatAlignSeconds(ms: number): string` — `S.SS`

- [ ] **Step 1: Napisz testy**

`shared/test/time/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MS_PER_FRAME, snapToFrame, isFrameAligned } from '../../src/time/frames.js'
import { formatShotTime, formatAlignSeconds } from '../../src/time/format.js'

describe('klatki', () => {
  it('liczy długość klatki dla 24 fps', () => {
    expect(MS_PER_FRAME).toBeCloseTo(41.666, 2)
  })

  it('przyciąga do najbliższej klatki', () => {
    expect(snapToFrame(0)).toBe(0)
    expect(snapToFrame(40)).toBe(42)
    expect(snapToFrame(1000)).toBe(1000)
    expect(snapToFrame(3480)).toBe(3500)
  })

  it('rozpoznaje czas wyrównany do klatki', () => {
    expect(isFrameAligned(0)).toBe(true)
    expect(isFrameAligned(3500)).toBe(true)
    expect(isFrameAligned(3490)).toBe(false)
  })
})

describe('formatShotTime', () => {
  it('formatuje jako MM:SS.mmm', () => {
    expect(formatShotTime(0)).toBe('00:00.000')
    expect(formatShotTime(3500)).toBe('00:03.500')
    expect(formatShotTime(5000)).toBe('00:05.000')
    expect(formatShotTime(9000)).toBe('00:09.000')
    expect(formatShotTime(65432)).toBe('01:05.432')
  })

  it('zaokrągla ułamkowe milisekundy zamiast psuć format', () => {
    expect(formatShotTime(3500.7)).toBe('00:03.501')
    expect(formatShotTime(3500.2)).toBe('00:03.500')
  })
})

describe('formatAlignSeconds', () => {
  it('zawsze daje dwa miejsca po przecinku', () => {
    expect(formatAlignSeconds(0)).toBe('0.00')
    expect(formatAlignSeconds(6000)).toBe('6.00')
    expect(formatAlignSeconds(8000)).toBe('8.00')
    expect(formatAlignSeconds(7500)).toBe('7.50')
    expect(formatAlignSeconds(12340)).toBe('12.34')
  })

  it('zaokrągla wartości graniczne poprawnie', () => {
    expect(formatAlignSeconds(1005)).toBe('1.01')
    expect(formatAlignSeconds(8005)).toBe('8.01')
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test -- time`
Expected: FAIL — brak modułów

- [ ] **Step 3: Zaimplementuj**

`shared/src/time/frames.ts`:

```ts
import { FPS } from '../model/types.js'

export const MS_PER_FRAME = 1000 / FPS

/** Przyciąga czas do najbliższej granicy klatki przy 24 fps. */
export function snapToFrame(ms: number): number {
  return Math.round(Math.round(ms / MS_PER_FRAME) * MS_PER_FRAME)
}

export function isFrameAligned(ms: number): boolean {
  return snapToFrame(ms) === ms
}
```

`shared/src/time/format.ts`:

```ts
const pad = (n: number, width: number): string => String(n).padStart(width, '0')

/** Timestamp cięcia w formacie MM:SS.mmm wymaganym przez guide. */
export function formatShotTime(ms: number): string {
  // Ułamkowe milisekundy dałyby zepsuty timestamp typu "00:03.500.7".
  const total = Math.round(ms)
  const totalSeconds = Math.floor(total / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const millis = total % 1000
  return `${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}`
}

/**
 * Czas w linii alignmentu: sekundy z dokładnie dwoma miejscami po przecinku.
 * Zaokrąglamy w domenie całkowitej, bo (1005 / 1000).toFixed(2) daje "1.00"
 * zamiast "1.01" — 1.005 nie jest dokładnie reprezentowalne binarnie.
 */
export function formatAlignSeconds(ms: number): string {
  return (Math.round(ms / 10) / 100).toFixed(2)
}
```

- [ ] **Step 4: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test -- time`
Expected: PASS, 7 testów

Uwaga: `snapToFrame(3480)` daje 3500, bo klatka 84 wypada na 3500 ms — sprawdź to, jeśli test padnie, zamiast zmieniać oczekiwanie.

- [ ] **Step 5: Commit**

```bash
cd ~/mmh3-studio
git add shared/src/time shared/test/time
git commit -m "feat: przyciąganie do klatek i formatowanie czasu wedlug guide"
```

---

### Task 4: Słownik kamery i renderer frazy

**Files:**
- Create: `shared/src/vocab/camera.ts`
- Create: `shared/src/compile/renderCamera.ts`
- Test: `shared/test/compile/renderCamera.test.ts`

**Interfaces:**
- Consumes: `CameraMove`, `CameraMotion` z `model/types.ts`
- Produces:
  - `CAMERA_MOTIONS: readonly CameraMotionSpec[]` gdzie `CameraMotionSpec = { type: CameraMotion; label: string; verb: string; category: string }`
  - `cameraVerb(type: CameraMotion): string`
  - `renderCameraMove(move: CameraMove): string`

- [ ] **Step 1: Napisz testy**

`shared/test/compile/renderCamera.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderCameraMove } from '../../src/compile/renderCamera.js'
import { CAMERA_MOTIONS } from '../../src/vocab/camera.js'
import type { CameraMove } from '../../src/model/types.js'

const move = (over: Partial<CameraMove>): CameraMove => ({
  id: 'c1', type: 'push-in', startMs: 0, endMs: 1000, ...over,
})

describe('słownik kamery', () => {
  it('zawiera 20 wartości w 12 kategoriach', () => {
    expect(CAMERA_MOTIONS).toHaveLength(20)
    expect(new Set(CAMERA_MOTIONS.map(m => m.category)).size).toBe(12)
  })
})

describe('renderCameraMove', () => {
  it('składa typ, amplitudę i prędkość', () => {
    expect(renderCameraMove(move({ type: 'push-in', amplitude: 'small', speed: 'slow' })))
      .toBe('The camera pushes in with small amplitude at slow speed')
  })

  it('dokleja cel frazy', () => {
    expect(renderCameraMove(move({
      type: 'push-in', amplitude: 'small', speed: 'slow',
      target: 'toward the folded letter in her hands',
    }))).toBe('The camera pushes in with small amplitude at slow speed toward the folded letter in her hands')
  })

  it('pomija amplitudę i prędkość, gdy nie podano', () => {
    expect(renderCameraMove(move({ type: 'static', target: 'as the runner exits the frame' })))
      .toBe('The camera holds a static shot as the runner exits the frame')
  })

  it('renderuje pan right z dużą amplitudą i szybko', () => {
    expect(renderCameraMove(move({ type: 'pan-right', amplitude: 'large', speed: 'fast' })))
      .toBe('The camera pans right with large amplitude at fast speed')
  })

  it('renderuje truck right', () => {
    expect(renderCameraMove(move({ type: 'truck-right', amplitude: 'small', speed: 'slow' })))
      .toBe('The camera trucks right with small amplitude at slow speed')
  })

  it('renderuje pull out', () => {
    expect(renderCameraMove(move({ type: 'pull-out', amplitude: 'small', speed: 'slow' })))
      .toBe('The camera pulls out with small amplitude at slow speed')
  })

  it('customPhrase nadpisuje całość', () => {
    expect(renderCameraMove(move({ customPhrase: 'The lens drifts sideways' })))
      .toBe('The lens drifts sideways')
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test -- renderCamera`
Expected: FAIL — brak modułów

- [ ] **Step 3: Zaimplementuj słownik**

`shared/src/vocab/camera.ts`:

```ts
import type { CameraMotion } from '../model/types.js'

export interface CameraMotionSpec {
  type: CameraMotion
  /** Etykieta z tabeli guide'a. */
  label: string
  /** Forma czasownikowa wstawiana po "The camera ". */
  verb: string
  /** Kategoria z tabeli guide'a — 12 wierszy tabeli. */
  category: string
}

export const CAMERA_MOTIONS: readonly CameraMotionSpec[] = [
  { type: 'zoom-in',        label: 'Zoom In',        verb: 'zooms in',                 category: 'zoom' },
  { type: 'zoom-out',       label: 'Zoom Out',       verb: 'zooms out',                category: 'zoom' },
  { type: 'push-in',        label: 'Push In',        verb: 'pushes in',                category: 'dolly' },
  { type: 'pull-out',       label: 'Pull Out',       verb: 'pulls out',                category: 'dolly' },
  { type: 'pan-left',       label: 'Pan Left',       verb: 'pans left',                category: 'pan' },
  { type: 'pan-right',      label: 'Pan Right',      verb: 'pans right',               category: 'pan' },
  { type: 'truck-left',     label: 'Truck Left',     verb: 'trucks left',              category: 'truck' },
  { type: 'truck-right',    label: 'Truck Right',    verb: 'trucks right',             category: 'truck' },
  { type: 'tilt-up',        label: 'Tilt Up',        verb: 'tilts up',                 category: 'tilt' },
  { type: 'tilt-down',      label: 'Tilt Down',      verb: 'tilts down',               category: 'tilt' },
  { type: 'pedestal-up',    label: 'Pedestal Up',    verb: 'pedestals up',             category: 'pedestal' },
  { type: 'pedestal-down',  label: 'Pedestal Down',  verb: 'pedestals down',           category: 'pedestal' },
  { type: 'arc',            label: 'Arc Shot',       verb: 'arcs around the subject',  category: 'arc' },
  { type: 'tracking',       label: 'Tracking Shot',  verb: 'tracks the subject',       category: 'tracking' },
  { type: 'static',         label: 'Static Shot',    verb: 'holds a static shot',      category: 'static' },
  { type: 'shake-slightly', label: 'Shake Slightly', verb: 'shakes slightly',          category: 'shake' },
  { type: 'shake-strongly', label: 'Shake Strongly', verb: 'shakes strongly',          category: 'shake' },
  { type: 'pov',            label: 'POV',            verb: 'holds a POV shot',         category: 'pov' },
  { type: 'roll-cw',        label: 'Roll Clockwise', verb: 'rolls clockwise',          category: 'roll' },
  { type: 'roll-ccw',       label: 'Roll Counterclockwise', verb: 'rolls counterclockwise', category: 'roll' },
]

const VERB_BY_TYPE = new Map(CAMERA_MOTIONS.map(m => [m.type, m.verb]))

export function cameraVerb(type: CameraMotion): string {
  const verb = VERB_BY_TYPE.get(type)
  if (!verb) throw new Error(`Nieznany typ ruchu kamery: ${type}`)
  return verb
}
```

- [ ] **Step 4: Zaimplementuj renderer**

`shared/src/compile/renderCamera.ts`:

```ts
import type { CameraMove } from '../model/types.js'
import { cameraVerb } from '../vocab/camera.js'

/**
 * Fraza ruchu kamery jako naturalne zdanie angielskie.
 * Guide wymaga wplecenia ruchu w prozę, nie doklejania etykiet na końcu.
 */
export function renderCameraMove(move: CameraMove): string {
  if (move.customPhrase) return move.customPhrase
  const parts = ['The camera', cameraVerb(move.type)]
  if (move.amplitude) parts.push(`with ${move.amplitude} amplitude`)
  if (move.speed) parts.push(`at ${move.speed} speed`)
  if (move.target) parts.push(move.target)
  return parts.join(' ')
}
```

- [ ] **Step 5: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test -- renderCamera`
Expected: PASS, 8 testów

- [ ] **Step 6: Commit**

```bash
cd ~/mmh3-studio
git add shared/src/vocab/camera.ts shared/src/compile/renderCamera.ts shared/test/compile
git commit -m "feat: slownik ruchow kamery i renderer frazy"
```

---

### Task 5: Renderery mówcy, dialogu i etykiet

**Files:**
- Create: `shared/src/vocab/continuity.ts`
- Create: `shared/src/compile/renderSpeaker.ts`
- Create: `shared/src/compile/renderDialogue.ts`
- Create: `shared/src/compile/renderLabel.ts`
- Test: `shared/test/compile/renderSpeech.test.ts`

**Interfaces:**
- Consumes: `Speaker`, `DialogueEvent`, `Label`, `Segment` z `model/types.ts`
- Produces:
  - `CONTINUITY_PHRASES: readonly string[]`
  - `VOICEOVER_PHRASE = 'says in an off-screen voiceover'`
  - `renderSpeakerSegment(seg, speaker): string`
  - `renderDialogue(event: DialogueEvent): string`
  - `labelText(label: Label, bracketed: boolean): string`
  - `renderLabelSegment(seg, label): string`

- [ ] **Step 1: Napisz testy**

`shared/test/compile/renderSpeech.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderSpeakerSegment } from '../../src/compile/renderSpeaker.js'
import { renderDialogue } from '../../src/compile/renderDialogue.js'
import { labelText } from '../../src/compile/renderLabel.js'
import type { DialogueEvent, Label, Speaker } from '../../src/model/types.js'

const speaker: Speaker = {
  id: 'sp1', code: 'S1', characterType: 'baker', age: 'middle-aged', gender: 'male',
  pitch: 'low', timbre: 'raspy', rate: 'calm', accent: 'neutral', onScreen: true,
  fullDescriptor: 'the middle-aged baker with a calm, slightly raspy voice',
  shortDescriptor: 'the baker',
}

const dlg = (over: Partial<DialogueEvent>): DialogueEvent => ({
  id: 'd1', speakerIds: ['sp1'], verb: 'says', punctuation: ':',
  language: 'English', text: 'First batch of the morning.',
  voiceover: false, sceneTransBefore: false, sceneTransAfter: false,
  cutoff: false, startMs: 0, endMs: 2000, ...over,
})

describe('renderSpeakerSegment', () => {
  it('renderuje pełny opis z ID', () => {
    expect(renderSpeakerSegment({ kind: 'speaker', speakerId: 'sp1', form: 'full' }, [speaker]))
      .toBe('the middle-aged baker with a calm, slightly raspy voice (S1)')
  })

  it('renderuje skrócony opis z ID', () => {
    expect(renderSpeakerSegment({ kind: 'speaker', speakerId: 'sp1', form: 'short' }, [speaker]))
      .toBe('the baker (S1)')
  })

  it('renderuje samo ID', () => {
    expect(renderSpeakerSegment({ kind: 'speaker', speakerId: 'sp1', form: 'idOnly' }, [speaker]))
      .toBe('(S1)')
  })

  it('nadpisanie descriptor ma pierwszeństwo', () => {
    expect(renderSpeakerSegment(
      { kind: 'speaker', speakerId: 'sp1', form: 'full', descriptor: 'the young woman with a quiet, breathy voice' },
      [speaker],
    )).toBe('the young woman with a quiet, breathy voice (S1)')
  })
})

describe('renderDialogue', () => {
  it('renderuje zwykłą kwestię z dwukropkiem', () => {
    expect(renderDialogue(dlg({}))).toBe('says: <d>[English] First batch of the morning.</d>')
  })

  it('renderuje kwestię z przecinkiem', () => {
    expect(renderDialogue(dlg({ verb: 'shout together', punctuation: ',', text: 'Wait for us!' })))
      .toBe('shout together, <d>[English] Wait for us!</d>')
  })

  it('renderuje voiceover z dokładną frazą i klauzulą o ustach', () => {
    expect(renderDialogue(dlg({
      voiceover: true, text: 'I still remember that road.',
      lipsClause: 'while his lips remain completely closed.',
    }))).toBe('says in an off-screen voiceover: <d>[English] I still remember that road.</d> while his lips remain completely closed.')
  })

  it('dodaje znacznik cutoff', () => {
    expect(renderDialogue(dlg({ cutoff: true })))
      .toBe('says: <d>[English] First batch of the morning.</d> <cutoff>')
  })

  it('dodaje scenetrans po obu stronach i zdanie o ciągłości', () => {
    expect(renderDialogue(dlg({
      sceneTransBefore: true, sceneTransAfter: true,
      continuityPhrase: 'carries over from the previous shot',
    }))).toBe('<scenetrans> says: <d>[English] First batch of the morning.</d> <scenetrans> carries over from the previous shot')
  })

  it('nie modyfikuje treści verbatim', () => {
    const text = '营业中… "ok"?!'
    expect(renderDialogue(dlg({ language: 'Chinese', text }))).toContain(`<d>[Chinese] ${text}</d>`)
  })

  it('łączy wielu mówców przecinkiem w ID przez segment mówcy, nie tutaj', () => {
    expect(renderDialogue(dlg({ speakerIds: ['sp1', 'sp2'] })))
      .toBe('says: <d>[English] First batch of the morning.</d>')
  })
})

describe('labelText', () => {
  const label = (over: Partial<Label>): Label => ({
    id: 'l1', kind: 'picture', index: 1, assetIds: [], definition: '', role: '',
    standalone: true, ...over,
  })

  it('renderuje w nawiasach kątowych', () => {
    expect(labelText(label({}), true)).toBe('<Picture 1>')
    expect(labelText(label({ kind: 'subject', index: 3 }), true)).toBe('<Subject 3>')
    expect(labelText(label({ kind: 'video', index: 1 }), true)).toBe('<Video 1>')
    expect(labelText(label({ kind: 'audio', index: 2 }), true)).toBe('<Audio 2>')
  })

  it('renderuje bez nawiasów, gdy proza tego wymaga', () => {
    expect(labelText(label({}), false)).toBe('Picture 1')
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test -- renderSpeech`
Expected: FAIL — brak modułów

- [ ] **Step 3: Zaimplementuj**

`shared/src/vocab/continuity.ts`:

```ts
/** Dokładna fraza wymagana przez guide dla voiceoveru. */
export const VOICEOVER_PHRASE = 'says in an off-screen voiceover'

/** Dozwolone zdania o ciągłości dźwięku przez cięcie. */
export const CONTINUITY_PHRASES = [
  'continues seamlessly across the cut',
  'continues uninterrupted into the next shot',
  'carries over from the previous shot',
  'remains audible across the transition',
] as const
```

`shared/src/compile/renderSpeaker.ts`:

```ts
import type { Segment, Speaker } from '../model/types.js'

type SpeakerSegment = Extract<Segment, { kind: 'speaker' }>

export function renderSpeakerSegment(seg: SpeakerSegment, speakers: Speaker[]): string {
  const speaker = speakers.find(s => s.id === seg.speakerId)
  if (!speaker) throw new Error(`Brak mówcy o id ${seg.speakerId}`)
  const ids = `(${speaker.code})`
  if (seg.form === 'idOnly') return ids
  const descriptor = seg.descriptor
    ?? (seg.form === 'full' ? speaker.fullDescriptor : speaker.shortDescriptor)
  return `${descriptor} ${ids}`
}

/** Złożone ID dla grupy mówiącej jednocześnie: (S1,S2). */
export function renderSpeakerGroup(codes: string[]): string {
  return `(${codes.join(',')})`
}
```

`shared/src/compile/renderDialogue.ts`:

```ts
import type { DialogueEvent } from '../model/types.js'
import { VOICEOVER_PHRASE } from '../vocab/continuity.js'

/**
 * Blok dialogowy. Treść wewnątrz <d> jest verbatim i nigdy nie jest modyfikowana.
 * Umiejscowienie <scenetrans> i <cutoff> to konwencja aplikacji — guide podaje
 * wymóg ich użycia, ale nie precyzuje pozycji w zdaniu.
 */
export function renderDialogue(event: DialogueEvent): string {
  const head = event.voiceover ? VOICEOVER_PHRASE : event.verb
  const parts: string[] = []
  if (event.sceneTransBefore) parts.push('<scenetrans>')
  parts.push(`${head}${event.punctuation} <d>[${event.language}] ${event.text}</d>`)
  if (event.voiceover && event.lipsClause) parts.push(event.lipsClause)
  if (event.cutoff) parts.push('<cutoff>')
  if (event.sceneTransAfter) parts.push('<scenetrans>')
  if (event.continuityPhrase) parts.push(event.continuityPhrase)
  return parts.join(' ')
}
```

`shared/src/compile/renderLabel.ts`:

```ts
import type { Label, LabelKind, Segment, Speaker } from '../model/types.js'

const KIND_NAME: Record<LabelKind, string> = {
  subject: 'Subject',
  picture: 'Picture',
  video: 'Video',
  audio: 'Audio',
}

export function labelText(label: Label, bracketed: boolean): string {
  const core = `${KIND_NAME[label.kind]} ${label.index}`
  return bracketed ? `<${core}>` : core
}

type LabelSegment = Extract<Segment, { kind: 'label' }>

export function renderLabelSegment(
  seg: LabelSegment,
  labels: Label[],
  speakers: Speaker[],
): string {
  const label = labels.find(l => l.id === seg.labelId)
  if (!label) throw new Error(`Brak etykiety o id ${seg.labelId}`)
  const base = labelText(label, seg.bracketed)
  if (!seg.speakerId) return base
  const speaker = speakers.find(s => s.id === seg.speakerId)
  if (!speaker) throw new Error(`Brak mówcy o id ${seg.speakerId}`)
  return `${base} (${speaker.code})`
}
```

- [ ] **Step 4: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test -- renderSpeech`
Expected: PASS, 15 testów

- [ ] **Step 5: Commit**

```bash
cd ~/mmh3-studio
git add shared/src/vocab/continuity.ts shared/src/compile shared/test/compile/renderSpeech.test.ts
git commit -m "feat: renderery mowcy, dialogu i etykiet referencyjnych"
```

---

### Task 6: Renderer segmentów i ujęcia

**Files:**
- Create: `shared/src/compile/renderShot.ts`
- Test: `shared/test/compile/renderShot.test.ts`

**Interfaces:**
- Consumes: `renderCameraMove`, `renderSpeakerSegment`, `renderDialogue`, `renderLabelSegment`, `formatShotTime`
- Produces:
  - `renderSegments(shot: Shot, project: Project): string`
  - `renderShot(shot: Shot, project: Project, opts: { includeStyle: boolean }): string`

- [ ] **Step 1: Napisz testy**

`shared/test/compile/renderShot.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderShot } from '../../src/compile/renderShot.js'
import type { Project, Shot } from '../../src/model/types.js'

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'p', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic',
  assets: [], labels: [],
  speakers: [{
    id: 'sp1', code: 'S1', characterType: 'baker', age: 'middle-aged', gender: 'male',
    pitch: '', timbre: '', rate: '', accent: '', onScreen: true,
    fullDescriptor: 'the middle-aged baker with a calm, slightly raspy voice',
    shortDescriptor: 'the baker',
  }],
  shots: [],
  audio: { overallSoundscape: '', nonDiegeticMusic: '' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

const shot1: Shot = {
  id: 's1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
  composition: 'medium-wide',
  body: [
    { kind: 'text', text: 'a medium-wide shot frames a baker opening the shutters of a small street bakery before sunrise. ' },
    { kind: 'camera', moveId: 'c1' },
    { kind: 'text', text: ' as ' },
    { kind: 'speaker', speakerId: 'sp1', form: 'full' },
    { kind: 'text', text: ' places a fresh loaf on the wooden counter and ' },
    { kind: 'dialogue', eventId: 'd1' },
  ],
  cameraMoves: [{ id: 'c1', type: 'push-in', amplitude: 'small', speed: 'slow', startMs: 0, endMs: 4000 }],
  dialogue: [{
    id: 'd1', speakerIds: ['sp1'], verb: 'says', punctuation: ':', language: 'English',
    text: 'First batch of the morning.', voiceover: false,
    sceneTransBefore: false, sceneTransAfter: false, cutoff: false, startMs: 2000, endMs: 4000,
  }],
  screenText: [], diegeticSfx: [], labelRefs: [], anchor: 'none',
}

const shot2: Shot = {
  id: 's2', index: 1, startMs: 5000, cutType: 'cut', cutPhrase: 'the camera cuts to',
  composition: 'close-up',
  body: [{ kind: 'text', text: "a close-up of steam rising from the sliced bread while the baker's final words carry over from the previous shot." }],
  cameraMoves: [], dialogue: [], screenText: [], diegeticSfx: [], labelRefs: [], anchor: 'none',
}

describe('renderShot', () => {
  it('składa pierwsze ujęcie ze stylem i bez timestampu', () => {
    expect(renderShot(shot1, project, { includeStyle: true })).toBe(
      '[Shot 1] Live-action, cinematic, a medium-wide shot frames a baker opening the shutters of a small street bakery before sunrise. ' +
      'The camera pushes in with small amplitude at slow speed as the middle-aged baker with a calm, slightly raspy voice (S1) ' +
      'places a fresh loaf on the wooden counter and says: <d>[English] First batch of the morning.</d>',
    )
  })

  it('pomija styl, gdy tryb umieszcza go osobno', () => {
    expect(renderShot(shot1, project, { includeStyle: false }))
      .toContain('[Shot 1] a medium-wide shot frames')
  })

  it('składa kolejne ujęcie z timestampem i frazą cięcia', () => {
    expect(renderShot(shot2, project, { includeStyle: false })).toBe(
      "[Shot 2] At 00:05.000, the camera cuts to a close-up of steam rising from the sliced bread while the baker's final words carry over from the previous shot.",
    )
  })

  it('rzuca wyjątek przy segmencie wskazującym nieistniejący ruch', () => {
    const broken: Shot = { ...shot2, body: [{ kind: 'camera', moveId: 'brak' }] }
    expect(() => renderShot(broken, project, { includeStyle: false })).toThrow(/brak/)
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test -- renderShot`
Expected: FAIL — brak modułu

- [ ] **Step 3: Zaimplementuj**

`shared/src/compile/renderShot.ts`:

```ts
import type { Project, Shot } from '../model/types.js'
import { formatShotTime } from '../time/format.js'
import { renderCameraMove } from './renderCamera.js'
import { renderSpeakerSegment } from './renderSpeaker.js'
import { renderDialogue } from './renderDialogue.js'
import { renderLabelSegment } from './renderLabel.js'

export function renderSegments(shot: Shot, project: Project): string {
  return shot.body.map(seg => {
    switch (seg.kind) {
      case 'text':
        return seg.text
      case 'camera': {
        const move = shot.cameraMoves.find(m => m.id === seg.moveId)
        if (!move) throw new Error(`Segment kamery wskazuje nieistniejący ruch: ${seg.moveId}`)
        return renderCameraMove(move)
      }
      case 'speaker':
        return renderSpeakerSegment(seg, project.speakers)
      case 'dialogue': {
        const event = shot.dialogue.find(d => d.id === seg.eventId)
        if (!event) throw new Error(`Segment dialogu wskazuje nieistniejące zdarzenie: ${seg.eventId}`)
        return renderDialogue(event)
      }
      case 'label':
        return renderLabelSegment(seg, project.labels, project.speakers)
      case 'screenText': {
        const st = shot.screenText.find(t => t.id === seg.id)
        if (!st) throw new Error(`Segment tekstu ekranowego wskazuje nieistniejący wpis: ${seg.id}`)
        return `"${st.text}"`
      }
    }
  }).join('')
}

/**
 * Nagłówek ujęcia zgodny z guide: [Shot 1] nigdy nie dostaje timestampu,
 * kolejne ujęcia zaczynają się od czasu cięcia i frazy przejścia.
 */
export function renderShot(
  shot: Shot,
  project: Project,
  opts: { includeStyle: boolean },
): string {
  const number = shot.index + 1
  const head = shot.index === 0
    ? `[Shot ${number}] `
    : `[Shot ${number}] At ${formatShotTime(shot.startMs)}, ${shot.cutPhrase} `
  const stylePrefix = shot.index === 0 && opts.includeStyle && project.style
    ? `${project.style}, `
    : ''
  return `${head}${stylePrefix}${renderSegments(shot, project)}`
}
```

- [ ] **Step 4: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test -- renderShot`
Expected: PASS, 4 testy

- [ ] **Step 5: Commit**

```bash
cd ~/mmh3-studio
git add shared/src/compile/renderShot.ts shared/test/compile/renderShot.test.ts
git commit -m "feat: renderer segmentow i naglowka ujecia"
```

---

### Task 7: Linie alignmentu i emiter bazowy

**Files:**
- Create: `shared/src/compile/alignment.ts`
- Create: `shared/src/compile/emitBase.ts`
- Test: `shared/test/compile/emitBase.test.ts`

**Interfaces:**
- Consumes: `renderShot`, `formatAlignSeconds`
- Produces:
  - `alignmentLine(project: Project): string | null` — `null` dla T2VA
  - `emitBase(project: Project): string`

- [ ] **Step 1: Napisz testy**

`shared/test/compile/emitBase.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { alignmentLine } from '../../src/compile/alignment.js'
import { emitBase } from '../../src/compile/emitBase.js'
import type { Project } from '../../src/model/types.js'

const base: Project = {
  schemaVersion: 1, id: 'p', name: 'p', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic',
  assets: [], labels: [], speakers: [],
  shots: [{
    id: 's1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
    composition: '', body: [{ kind: 'text', text: 'a shot.' }],
    cameraMoves: [], dialogue: [], screenText: [], diegeticSfx: [], labelRefs: [], anchor: 'none',
  }],
  audio: { overallSoundscape: 'Rain.', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

describe('alignmentLine', () => {
  it('zwraca null dla T2VA', () => {
    expect(alignmentLine(base)).toBeNull()
  })

  it('buduje linię I2VA', () => {
    expect(alignmentLine({ ...base, mode: 'I2VA' })).toBe(
      'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.',
    )
  })

  it('buduje linię FL2VA z numerem ostatniego ujęcia i długością', () => {
    expect(alignmentLine({ ...base, mode: 'FL2VA' })).toBe(
      'How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the 8.00-second mark of the target video.',
    )
  })

  it('buduje linię L2VA', () => {
    expect(alignmentLine({ ...base, mode: 'L2VA', video: { ...base.video, durationMs: 6000 } })).toBe(
      'How the reference pictures align with the target video — <Picture 1> (from [Shot 1]) aligns with the 6.00-second mark of the target video.',
    )
  })

  it('używa numeru ostatniego ujęcia w FL2VA przy wielu ujęciach', () => {
    const p: Project = {
      ...base, mode: 'FL2VA',
      shots: [
        base.shots[0]!,
        { ...base.shots[0]!, id: 's2', index: 1, startMs: 4000 },
      ],
    }
    expect(alignmentLine(p)).toContain('Picture 2 (from Shot 2)')
  })
})

describe('emitBase', () => {
  it('składa T2VA bez linii instrukcji', () => {
    expect(emitBase(base)).toBe(
      'integrated_multimodal_description: [Shot 1] Live-action, cinematic, a shot.\n' +
      '\n' +
      'overall_soundscape: Rain.\n' +
      '\n' +
      'non_diegetic_music: N/A',
    )
  })

  it('wstawia linię instrukcji i pustą linię przed polami', () => {
    const out = emitBase({ ...base, mode: 'I2VA' })
    const lines = out.split('\n')
    expect(lines[0]).toContain('is fully referenced.')
    expect(lines[1]).toBe('')
    expect(lines[2]).toContain('integrated_multimodal_description:')
  })

  it('łączy ujęcia jedną spacją w jednym akapicie', () => {
    const p: Project = {
      ...base,
      shots: [
        base.shots[0]!,
        {
          ...base.shots[0]!, id: 's2', index: 1, startMs: 5000,
          body: [{ kind: 'text', text: 'another shot.' }],
        },
      ],
    }
    expect(emitBase(p)).toContain(
      'a shot. [Shot 2] At 00:05.000, the camera cuts to another shot.',
    )
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test -- emitBase`
Expected: FAIL — brak modułów

- [ ] **Step 3: Zaimplementuj linie alignmentu**

`shared/src/compile/alignment.ts`:

```ts
import type { Project } from '../model/types.js'
import { formatAlignSeconds } from '../time/format.js'

/**
 * Linia instrukcji wyrównania klatek. Szablony przepisane dosłownie
 * z guide_base.md §2.1 — zapis etykiet różni się między trybami
 * (FL2VA bez nawiasów kątowych, I2VA i L2VA z nawiasami).
 */
export function alignmentLine(project: Project): string | null {
  const lastShotNumber = Math.max(1, project.shots.length)
  const end = formatAlignSeconds(project.video.durationMs)

  switch (project.mode) {
    case 'T2VA':
    case 'REF':
      return null
    case 'I2VA':
      return 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'
    case 'FL2VA':
      return 'How the reference pictures align with the target video — '
        + 'Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; '
        + `Picture 2 (from Shot ${lastShotNumber}) aligns with the ${end}-second mark of the target video.`
    case 'L2VA':
      return 'How the reference pictures align with the target video — '
        + `<Picture 1> (from [Shot ${lastShotNumber}]) aligns with the ${end}-second mark of the target video.`
  }
}
```

Uwaga: znak po „target video" to półpauza U+2014 (—), nie dywiz. Skopiuj go z `docs/guide_base.md`.

- [ ] **Step 4: Zaimplementuj emiter bazowy**

`shared/src/compile/emitBase.ts`:

```ts
import type { Project } from '../model/types.js'
import { renderShot } from './renderShot.js'
import { alignmentLine } from './alignment.js'

/**
 * Emiter trybów T2VA / I2VA / FL2VA / L2VA.
 * Wszystkie ujęcia idą w jednym akapicie, oddzielone pojedynczą spacją.
 */
export function emitBase(project: Project): string {
  const blocks: string[] = []

  const instruction = alignmentLine(project)
  if (instruction) blocks.push(instruction)

  const shots = project.shots
    .slice()
    .sort((a, b) => a.index - b.index)
    .map(shot => renderShot(shot, project, { includeStyle: true }))
    .join(' ')

  blocks.push(`integrated_multimodal_description: ${shots}`)
  blocks.push(`overall_soundscape: ${project.audio.overallSoundscape}`)
  blocks.push(`non_diegetic_music: ${project.audio.nonDiegeticMusic}`)

  return blocks.join('\n\n')
}
```

- [ ] **Step 5: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test -- emitBase`
Expected: PASS, 8 testów

- [ ] **Step 6: Commit**

```bash
cd ~/mmh3-studio
git add shared/src/compile/alignment.ts shared/src/compile/emitBase.ts shared/test/compile/emitBase.test.ts
git commit -m "feat: linie alignmentu i emiter trybow bazowych"
```

---

### Task 8: Testy złote trybów bazowych

To zadanie jest dowodem zgodności kompilatora z dokumentacją. Cztery przypadki z `docs/guide_base.md` §5 muszą się skompilować **znak w znak**.

**Files:**
- Create: `shared/test/golden/expected/t2va.txt`
- Create: `shared/test/golden/expected/i2va.txt`
- Create: `shared/test/golden/expected/fl2va.txt`
- Create: `shared/test/golden/expected/l2va.txt`
- Create: `shared/test/golden/fixtures/base.ts`
- Test: `shared/test/golden/base.test.ts`

**Interfaces:**
- Consumes: `emitBase`, typy domeny
- Produces: `t2vaProject`, `i2vaProject`, `fl2vaProject`, `l2vaProject` — fixture'y wykorzystywane ponownie w testach walidatora

- [ ] **Step 1: Utwórz pliki oczekiwane**

Skopiuj bloki `text` z `docs/guide_base.md` §5 (Case 1–4) do plików, **bez** otaczających ograniczników ` ```text ` i bez końcowego znaku nowej linii.

`shared/test/golden/expected/t2va.txt`:

```
integrated_multimodal_description: [Shot 1] Live-action, cinematic, a medium-wide shot frames a baker opening the shutters of a small street bakery before sunrise. The camera pushes in with small amplitude at slow speed as the middle-aged baker with a calm, slightly raspy voice (S1) places a fresh loaf on the wooden counter and says: <d>[English] First batch of the morning.</d> [Shot 2] At 00:05.000, the camera cuts to a close-up of steam rising from the sliced bread while the baker's final words carry over from the previous shot.

overall_soundscape: Wooden shutters scrape open over a quiet street as trays clink softly inside the bakery. The doorbell rings once, followed by light footsteps and the crisp sound of bread being sliced.

non_diegetic_music: A soft acoustic-guitar pattern at a moderate tempo, joined by sparse upright-bass notes and a gentle fade at the end.
```

`shared/test/golden/expected/i2va.txt`:

```
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, the young woman shown in <Picture 1> remains beside the rain-covered train window, preserving her appearance, clothing, seat position, and the carriage layout. The camera trucks right with small amplitude at slow speed as she lifts her gaze from the folded letter toward the passing city lights. Her reflection moves across the glass while the quiet, breathy young woman (S1) says: <d>[English] I get off at the next station.</d> She folds the letter along its existing crease.

overall_soundscape: The train wheels produce a steady metallic rhythm beneath a low ventilation hum. Rain ticks against the window while paper rustles softly in her hands.

non_diegetic_music: Sustained cello notes at a slow tempo with widely spaced piano tones, gradually decreasing in volume.
```

`shared/test/golden/expected/fl2va.txt`:

```
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the 8.00-second mark of the target video.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, a rain-soaked cyclist begins in the position and framing established by Picture 1, holding a closed black umbrella beside a silver bicycle. The camera pulls out with small amplitude at slow speed as she releases the bicycle handle, raises the umbrella above her shoulder, and presses the runner upward until the canopy opens. Water rolls from the expanding fabric while she steps beneath it, rotates the handle into the final angle, and settles into the pose, spacing, and composition established by Picture 2 at the end of the shot.

overall_soundscape: Rain falls steadily on the pavement, followed by the metallic click of the umbrella runner and the soft snap of the canopy opening. Water drips from the bicycle frame as distant traffic passes.

non_diegetic_music: N/A
```

`shared/test/golden/expected/l2va.txt`:

```
How the reference pictures align with the target video — <Picture 1> (from [Shot 1]) aligns with the 6.00-second mark of the target video.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, a close shot begins with an intact drinking glass near the edge of a dark wooden table, while the same hand and sleeve visible in <Picture 1> approach from the right. The camera pushes in with small amplitude at slow speed as the fingertips strike the rim. The glass tips, falls, and hits the floor with a sharp impact; cracks spread through it as fragments slide outward. Toward the end, the moving pieces lose momentum and settle into the exact broken arrangement, hand position, camera angle, lighting, and final composition established by <Picture 1>.

overall_soundscape: Fingertips tap the glass before it scrapes across the tabletop, falls, and breaks with a sharp crash. Small fragments scatter and gradually stop sliding across the floor.

non_diegetic_music: A low electronic pulse at a slow tempo, ending immediately after the glass breaks.
```

- [ ] **Step 2: Napisz test złoty**

`shared/test/golden/base.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { emitBase } from '../../src/compile/emitBase.js'
import { t2vaProject, i2vaProject, fl2vaProject, l2vaProject } from './fixtures/base.js'

const here = dirname(fileURLToPath(import.meta.url))
const expected = (name: string) =>
  readFileSync(join(here, 'expected', `${name}.txt`), 'utf8').replace(/\n$/, '')

describe('testy złote — tryby bazowe', () => {
  it('T2VA odtwarza Case 1 znak w znak', () => {
    expect(emitBase(t2vaProject)).toBe(expected('t2va'))
  })

  it('I2VA odtwarza Case 2 znak w znak', () => {
    expect(emitBase(i2vaProject)).toBe(expected('i2va'))
  })

  it('FL2VA odtwarza Case 3 znak w znak', () => {
    expect(emitBase(fl2vaProject)).toBe(expected('fl2va'))
  })

  it('L2VA odtwarza Case 4 znak w znak', () => {
    expect(emitBase(l2vaProject)).toBe(expected('l2va'))
  })
})
```

- [ ] **Step 3: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test -- golden`
Expected: FAIL — brak `fixtures/base.js`

- [ ] **Step 4: Napisz fixture'y**

`shared/test/golden/fixtures/base.ts`:

```ts
import type { Label, Project, Shot, Speaker } from '../../../src/model/types.js'

const emptyProject = (over: Partial<Project>): Project => ({
  schemaVersion: 1, id: 'golden', name: 'golden', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic',
  assets: [], labels: [], speakers: [], shots: [],
  audio: { overallSoundscape: '', nonDiegeticMusic: '' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
  ...over,
})

const emptyShot = (over: Partial<Shot>): Shot => ({
  id: 's1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
  composition: '', body: [], cameraMoves: [], dialogue: [], screenText: [],
  diegeticSfx: [], labelRefs: [], anchor: 'none', ...over,
})

const picture1: Label = {
  id: 'pic1', kind: 'picture', index: 1, assetIds: [],
  definition: '', role: '', standalone: true,
}

// ─── Case 1: T2VA ────────────────────────────────────────────────────────────

const baker: Speaker = {
  id: 'sp1', code: 'S1', characterType: 'baker', age: 'middle-aged', gender: 'male',
  pitch: 'low', timbre: 'slightly raspy', rate: 'calm', accent: 'neutral', onScreen: true,
  fullDescriptor: 'the middle-aged baker with a calm, slightly raspy voice',
  shortDescriptor: 'the baker',
}

export const t2vaProject: Project = emptyProject({
  mode: 'T2VA',
  speakers: [baker],
  shots: [
    emptyShot({
      id: 's1', index: 0, startMs: 0, composition: 'medium-wide',
      cameraMoves: [{ id: 'c1', type: 'push-in', amplitude: 'small', speed: 'slow', startMs: 0, endMs: 5000 }],
      dialogue: [{
        id: 'd1', speakerIds: ['sp1'], verb: 'says', punctuation: ':', language: 'English',
        text: 'First batch of the morning.', voiceover: false,
        sceneTransBefore: false, sceneTransAfter: false, cutoff: false,
        startMs: 3000, endMs: 5000,
      }],
      body: [
        { kind: 'text', text: 'a medium-wide shot frames a baker opening the shutters of a small street bakery before sunrise. ' },
        { kind: 'camera', moveId: 'c1' },
        { kind: 'text', text: ' as ' },
        { kind: 'speaker', speakerId: 'sp1', form: 'full' },
        { kind: 'text', text: ' places a fresh loaf on the wooden counter and ' },
        { kind: 'dialogue', eventId: 'd1' },
      ],
    }),
    emptyShot({
      id: 's2', index: 1, startMs: 5000, composition: 'close-up',
      body: [{ kind: 'text', text: "a close-up of steam rising from the sliced bread while the baker's final words carry over from the previous shot." }],
    }),
  ],
  audio: {
    overallSoundscape: 'Wooden shutters scrape open over a quiet street as trays clink softly inside the bakery. The doorbell rings once, followed by light footsteps and the crisp sound of bread being sliced.',
    nonDiegeticMusic: 'A soft acoustic-guitar pattern at a moderate tempo, joined by sparse upright-bass notes and a gentle fade at the end.',
  },
})

// ─── Case 2: I2VA ────────────────────────────────────────────────────────────

const youngWoman: Speaker = {
  id: 'sp1', code: 'S1', characterType: 'young woman', age: 'young', gender: 'female',
  pitch: 'quiet', timbre: 'breathy', rate: 'measured', accent: 'neutral', onScreen: true,
  fullDescriptor: 'the quiet, breathy young woman',
  shortDescriptor: 'the young woman',
}

export const i2vaProject: Project = emptyProject({
  mode: 'I2VA',
  labels: [picture1],
  speakers: [youngWoman],
  shots: [
    emptyShot({
      cameraMoves: [{ id: 'c1', type: 'truck-right', amplitude: 'small', speed: 'slow', startMs: 0, endMs: 4000 }],
      dialogue: [{
        id: 'd1', speakerIds: ['sp1'], verb: 'says', punctuation: ':', language: 'English',
        text: 'I get off at the next station.', voiceover: false,
        sceneTransBefore: false, sceneTransAfter: false, cutoff: false,
        startMs: 4000, endMs: 6000,
      }],
      anchor: 'picture-first',
      body: [
        { kind: 'text', text: 'the young woman shown in ' },
        { kind: 'label', labelId: 'pic1', bracketed: true },
        { kind: 'text', text: ' remains beside the rain-covered train window, preserving her appearance, clothing, seat position, and the carriage layout. ' },
        { kind: 'camera', moveId: 'c1' },
        { kind: 'text', text: ' as she lifts her gaze from the folded letter toward the passing city lights. Her reflection moves across the glass while ' },
        { kind: 'speaker', speakerId: 'sp1', form: 'full' },
        { kind: 'text', text: ' ' },
        { kind: 'dialogue', eventId: 'd1' },
        { kind: 'text', text: ' She folds the letter along its existing crease.' },
      ],
    }),
  ],
  audio: {
    overallSoundscape: 'The train wheels produce a steady metallic rhythm beneath a low ventilation hum. Rain ticks against the window while paper rustles softly in her hands.',
    nonDiegeticMusic: 'Sustained cello notes at a slow tempo with widely spaced piano tones, gradually decreasing in volume.',
  },
})

// ─── Case 3: FL2VA ───────────────────────────────────────────────────────────

const picture2: Label = { ...picture1, id: 'pic2', index: 2 }

export const fl2vaProject: Project = emptyProject({
  mode: 'FL2VA',
  labels: [picture1, picture2],
  shots: [
    emptyShot({
      cameraMoves: [{ id: 'c1', type: 'pull-out', amplitude: 'small', speed: 'slow', startMs: 0, endMs: 8000 }],
      anchor: 'picture-first',
      body: [
        { kind: 'text', text: 'a rain-soaked cyclist begins in the position and framing established by ' },
        { kind: 'label', labelId: 'pic1', bracketed: false },
        { kind: 'text', text: ', holding a closed black umbrella beside a silver bicycle. ' },
        { kind: 'camera', moveId: 'c1' },
        { kind: 'text', text: ' as she releases the bicycle handle, raises the umbrella above her shoulder, and presses the runner upward until the canopy opens. Water rolls from the expanding fabric while she steps beneath it, rotates the handle into the final angle, and settles into the pose, spacing, and composition established by ' },
        { kind: 'label', labelId: 'pic2', bracketed: false },
        { kind: 'text', text: ' at the end of the shot.' },
      ],
    }),
  ],
  audio: {
    overallSoundscape: 'Rain falls steadily on the pavement, followed by the metallic click of the umbrella runner and the soft snap of the canopy opening. Water drips from the bicycle frame as distant traffic passes.',
    nonDiegeticMusic: 'N/A',
  },
})

// ─── Case 4: L2VA ────────────────────────────────────────────────────────────

export const l2vaProject: Project = emptyProject({
  mode: 'L2VA',
  video: { durationMs: 6000, fps: 24, aspect: '16:9', resolution: '768p' },
  labels: [picture1],
  shots: [
    emptyShot({
      cameraMoves: [{ id: 'c1', type: 'push-in', amplitude: 'small', speed: 'slow', startMs: 0, endMs: 6000 }],
      anchor: 'picture-last',
      body: [
        { kind: 'text', text: 'a close shot begins with an intact drinking glass near the edge of a dark wooden table, while the same hand and sleeve visible in ' },
        { kind: 'label', labelId: 'pic1', bracketed: true },
        { kind: 'text', text: ' approach from the right. ' },
        { kind: 'camera', moveId: 'c1' },
        { kind: 'text', text: ' as the fingertips strike the rim. The glass tips, falls, and hits the floor with a sharp impact; cracks spread through it as fragments slide outward. Toward the end, the moving pieces lose momentum and settle into the exact broken arrangement, hand position, camera angle, lighting, and final composition established by ' },
        { kind: 'label', labelId: 'pic1', bracketed: true },
        { kind: 'text', text: '.' },
      ],
    }),
  ],
  audio: {
    overallSoundscape: 'Fingertips tap the glass before it scrapes across the tabletop, falls, and breaks with a sharp crash. Small fragments scatter and gradually stop sliding across the floor.',
    nonDiegeticMusic: 'A low electronic pulse at a slow tempo, ending immediately after the glass breaks.',
  },
})
```

- [ ] **Step 5: Uruchom testy złote**

Run: `cd ~/mmh3-studio && npm test -- golden`
Expected: PASS, 4 testy

Jeśli test padnie, porównaj różnicę znak po znaku. **Nie zmieniaj plików `expected/`** — one są kopią dokumentacji. Naprawiaj fixture albo renderer.

- [ ] **Step 6: Commit**

```bash
cd ~/mmh3-studio
git add shared/test/golden
git commit -m "test: testy zlote czterech trybow bazowych z guide_base"
```

---

### Task 9: Emiter trybu pełnoreferencyjnego

**Files:**
- Create: `shared/src/vocab/refVocab.ts`
- Create: `shared/src/compile/emitRef.ts`
- Test: `shared/test/compile/emitRef.test.ts`

**Interfaces:**
- Consumes: `labelText`, `renderShot`, typy `Label`, `RetentionEntry`, `RefTaskType`
- Produces:
  - `REF_TASK_TYPES: readonly RefTaskType[]`
  - `VISUAL_MARKERS: readonly VisualMarker[]`, `AUDIO_MARKERS: readonly AudioMarker[]`
  - `renderSubjectDefinitions(project): string`
  - `renderSummary(project): string`
  - `renderRetention(project): string`
  - `renderDetailedDescription(project): string`
  - `emitRef(project: Project): string`

Zasada zapisu: pole `Label.definition` przechowuje **treść po etykiecie i spacji**, np. `is the coffee-shop environment in <Picture 1>, featuring…`. Emiter dokleja przed nią `<Subject 1>`. Dzięki temu walidator wie, do której etykiety należy linia.

- [ ] **Step 1: Napisz testy**

`shared/test/compile/emitRef.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  renderSubjectDefinitions, renderSummary, renderRetention, emitRef,
} from '../../src/compile/emitRef.js'
import type { Project } from '../../src/model/types.js'

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'p', mode: 'REF',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'The target video uses a realistic multi-camera sitcom style with warm indoor lighting.',
  assets: [],
  labels: [
    { id: 'sub1', kind: 'subject', index: 1, assetIds: [], role: '', standalone: true,
      definition: 'is the coffee-shop environment in <Picture 1>.' },
    { id: 'aud1', kind: 'audio', index: 1, assetIds: [], role: '', standalone: true,
      definition: 'is the voice-timbre reference for <Subject 3> (S1).' },
  ],
  speakers: [],
  shots: [{
    id: 's1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the shot cuts to',
    composition: '', body: [{ kind: 'text', text: 'A medium shot establishes the room.' }],
    cameraMoves: [], dialogue: [], screenText: [], diegeticSfx: [], labelRefs: [], anchor: 'none',
  }],
  audio: { overallSoundscape: 'Soft indoor room tone.', nonDiegeticMusic: 'N/A' },
  ref: {
    taskTypes: ['reference generation', 'audio reference'],
    summaryText: 'The target video shows a scene.',
    retention: [
      { id: 'r1', labelId: 'sub1', scope: 'appears in [Shot 1]', marker: 'fully_preserved',
        note: 'the brick wall is retained.' },
      { id: 'r2', labelId: 'aud1', scope: '', marker: 'reference',
        note: 'its vocal timbre guides the delivery.' },
    ],
  },
}

describe('renderSubjectDefinitions', () => {
  it('dokleja etykietę przed treścią definicji, każda w osobnej linii', () => {
    expect(renderSubjectDefinitions(project)).toBe(
      '<Subject 1> is the coffee-shop environment in <Picture 1>.\n' +
      '<Audio 1> is the voice-timbre reference for <Subject 3> (S1).',
    )
  })

  it('pomija etykiety niesamodzielne', () => {
    const p = { ...project, labels: [{ ...project.labels[0]!, standalone: false }] }
    expect(renderSubjectDefinitions(p)).toBe('')
  })
})

describe('renderSummary', () => {
  it('łączy typy zadania przez spację-plus-spację w nawiasie kwadratowym', () => {
    expect(renderSummary(project))
      .toBe('[reference generation + audio reference] The target video shows a scene.')
  })
})

describe('renderRetention', () => {
  it('renderuje wpis z zakresem i bez zakresu', () => {
    expect(renderRetention(project)).toBe(
      '<Subject 1> (appears in [Shot 1]): fully_preserved - the brick wall is retained.\n' +
      '<Audio 1>: reference - its vocal timbre guides the delivery.',
    )
  })
})

describe('emitRef', () => {
  it('składa sześć sekcji w kolejności, każda z nagłówkiem w osobnej linii', () => {
    const out = emitRef(project)
    const headers = out.split('\n').filter(l => /^[a-z_]+:$/.test(l))
    expect(headers).toEqual([
      'subject_definitions:', 'summary:', 'retention_analysis:',
      'detailed_description:', 'overall_soundscape:', 'non_diegetic_music:',
    ])
  })

  it('umieszcza zdanie o stylu przed pierwszym ujęciem', () => {
    expect(emitRef(project)).toContain(
      'detailed_description:\n' +
      'The target video uses a realistic multi-camera sitcom style with warm indoor lighting.\n' +
      '[Shot 1] A medium shot establishes the room.',
    )
  })

  it('nie powtarza stylu wewnątrz ujęcia', () => {
    expect(emitRef(project)).not.toContain('[Shot 1] The target video uses')
  })

  it('każde ujęcie zaczyna nową linię', () => {
    const p: Project = {
      ...project,
      shots: [
        project.shots[0]!,
        { ...project.shots[0]!, id: 's2', index: 1, startMs: 3000,
          body: [{ kind: 'text', text: 'a close-up.' }] },
      ],
    }
    expect(emitRef(p)).toContain(
      '[Shot 1] A medium shot establishes the room.\n[Shot 2] At 00:03.000, the shot cuts to a close-up.',
    )
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test -- emitRef`
Expected: FAIL — brak modułów

- [ ] **Step 3: Zaimplementuj słownik trybu REF**

`shared/src/vocab/refVocab.ts`:

```ts
import type { AudioMarker, RefTaskType, VisualMarker } from '../model/types.js'

export const REF_TASK_TYPES: readonly RefTaskType[] = [
  'keyframe completion',
  'reference generation',
  'video editing',
  'video continuation',
  'audio reuse',
  'audio reference',
]

export const VISUAL_MARKERS: readonly VisualMarker[] = [
  'fully_preserved', 'partially_preserved', 'attribute_transfer', 'weak_reference',
]

export const AUDIO_MARKERS: readonly AudioMarker[] = [
  'fully_copy', 'partially_copy', 'reference', 'weak_reference',
]

/** Zdanie otwierające summary dla zadań montażowych. */
export const VIDEO_EDIT_SUMMARY_OPENING = 'The target video is an edited version of <Video 1>.'
```

- [ ] **Step 4: Zaimplementuj emiter**

`shared/src/compile/emitRef.ts`:

```ts
import type { Project } from '../model/types.js'
import { labelText } from './renderLabel.js'
import { renderShot } from './renderShot.js'

export function renderSubjectDefinitions(project: Project): string {
  return project.labels
    .filter(l => l.standalone)
    .map(l => `${labelText(l, true)} ${l.definition}`)
    .join('\n')
}

export function renderSummary(project: Project): string {
  const prefix = `[${project.ref.taskTypes.join(' + ')}]`
  return `${prefix} ${project.ref.summaryText}`
}

export function renderRetention(project: Project): string {
  return project.ref.retention.map(entry => {
    const label = project.labels.find(l => l.id === entry.labelId)
    if (!label) throw new Error(`Wpis retention wskazuje nieistniejącą etykietę: ${entry.labelId}`)
    const scope = entry.scope ? ` (${entry.scope})` : ''
    return `${labelText(label, true)}${scope}: ${entry.marker} - ${entry.note}`
  }).join('\n')
}

/**
 * W trybie REF zdanie o stylu stoi w osobnej linii przed [Shot 1],
 * a każde ujęcie zaczyna nową linię.
 */
export function renderDetailedDescription(project: Project): string {
  const shots = project.shots
    .slice()
    .sort((a, b) => a.index - b.index)
    .map(shot => renderShot(shot, project, { includeStyle: false }))
  const lines = project.style ? [project.style, ...shots] : shots
  return lines.join('\n')
}

export function emitRef(project: Project): string {
  const sections: Array<[string, string]> = [
    ['subject_definitions', renderSubjectDefinitions(project)],
    ['summary', renderSummary(project)],
    ['retention_analysis', renderRetention(project)],
    ['detailed_description', renderDetailedDescription(project)],
    ['overall_soundscape', project.audio.overallSoundscape],
    ['non_diegetic_music', project.audio.nonDiegeticMusic],
  ]
  return sections.map(([name, body]) => `${name}:\n${body}`).join('\n\n')
}
```

- [ ] **Step 5: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test -- emitRef`
Expected: PASS, 8 testów

- [ ] **Step 6: Commit**

```bash
cd ~/mmh3-studio
git add shared/src/vocab/refVocab.ts shared/src/compile/emitRef.ts shared/test/compile/emitRef.test.ts
git commit -m "feat: emiter szesciu sekcji trybu pelnoreferencyjnego"
```

---

### Task 10: Test złoty trybu pełnoreferencyjnego

**Files:**
- Create: `shared/test/golden/expected/ref.txt`
- Create: `shared/test/golden/fixtures/ref.ts`
- Test: `shared/test/golden/ref.test.ts`

**Interfaces:**
- Consumes: `emitRef`
- Produces: `refProject` — fixture wykorzystywany ponownie w testach reguł REF

- [ ] **Step 1: Wytnij oczekiwany tekst z dokumentacji**

Run:

```bash
cd ~/mmh3-studio
sed -n '311,338p' docs/guide_ref.md > shared/test/golden/expected/ref.txt
head -1 shared/test/golden/expected/ref.txt
tail -1 shared/test/golden/expected/ref.txt
```

Expected: pierwsza linia `subject_definitions:`, ostatnia `N/A`. Jeśli nie — znajdź właściwy zakres poleceniem `grep -n 'subject_definitions:' docs/guide_ref.md` i wytnij od tej linii do linii poprzedzającej zamykający ogranicznik bloku kodu.

- [ ] **Step 2: Napisz test złoty**

`shared/test/golden/ref.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { emitRef } from '../../src/compile/emitRef.js'
import { refProject } from './fixtures/ref.js'

const here = dirname(fileURLToPath(import.meta.url))

describe('test złoty — tryb pełnoreferencyjny', () => {
  it('odtwarza pełny przykład z guide_ref §7 znak w znak', () => {
    const expected = readFileSync(join(here, 'expected', 'ref.txt'), 'utf8').replace(/\n$/, '')
    expect(emitRef(refProject)).toBe(expected)
  })
})
```

- [ ] **Step 3: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test -- golden/ref`
Expected: FAIL — brak `fixtures/ref.js`

- [ ] **Step 4: Napisz fixture**

`shared/test/golden/fixtures/ref.ts`:

```ts
import type { Label, Project, Shot, Speaker } from '../../../src/model/types.js'

const subject = (id: string, index: number, definition: string): Label =>
  ({ id, kind: 'subject', index, assetIds: [], definition, role: '', standalone: true })

const labels: Label[] = [
  subject('sub1', 1, 'is the coffee-shop environment in <Picture 1>, featuring an exposed brick wall, an orange tufted sofa with patterned pillows, a neon sign, and a wooden coffee table.'),
  subject('sub2', 2, 'is the fluffy white Samoyed in <Picture 2>, <Picture 3>, and <Picture 4>, with thick white fur, pointed ears, a dark nose, and a curved tail.'),
  subject('sub3', 3, 'is the young blonde woman in <Video 1>, with long blonde hair and a light-pink button-down shirt with rolled-up sleeves.'),
  subject('sub4', 4, 'is the young man in <Video 2>, with short wavy brown hair and a dark-grey hoodie with drawstrings.'),
  { id: 'aud1', kind: 'audio', index: 1, assetIds: [], standalone: true, role: '',
    definition: 'is the voice-timbre reference for <Subject 3> (S1), containing a spoken English vocal layer.' },
]

const speakers: Speaker[] = [
  { id: 'sp1', code: 'S1', characterType: 'young woman', age: 'young', gender: 'female',
    pitch: 'clear', timbre: 'youthful', rate: 'natural', accent: 'neutral', onScreen: true,
    fullDescriptor: 'the young blonde woman', shortDescriptor: 'the blonde woman' },
  { id: 'sp2', code: 'S2', characterType: 'young man', age: 'young', gender: 'male',
    pitch: 'casual', timbre: 'warm', rate: 'easy', accent: 'neutral', onScreen: true,
    fullDescriptor: 'the young man', shortDescriptor: 'the young man' },
]

const emptyShot = (over: Partial<Shot>): Shot => ({
  id: 'x', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the shot cuts to',
  composition: '', body: [], cameraMoves: [], dialogue: [], screenText: [],
  diegeticSfx: [], labelRefs: [], anchor: 'none', ...over,
})

const shot1: Shot = emptyShot({
  id: 's1', index: 0, startMs: 0, composition: 'medium',
  dialogue: [{
    id: 'd1', speakerIds: ['sp1'], verb: 'exclaims with light annoyance', punctuation: ',',
    language: 'English', text: 'Hey! Watch your dog!', voiceover: false,
    sceneTransBefore: false, sceneTransAfter: false, cutoff: false, startMs: 1500, endMs: 3000,
  }],
  body: [
    { kind: 'text', text: 'A medium shot establishes ' },
    { kind: 'label', labelId: 'sub1', bracketed: true },
    { kind: 'text', text: ', the coffee shop with its exposed brick wall, orange tufted sofa, patterned pillows, neon sign, and wooden coffee table. ' },
    { kind: 'label', labelId: 'sub3', speakerId: 'sp1', bracketed: true },
    { kind: 'text', text: ', the young woman with long blonde hair and a light-pink button-down shirt with rolled-up sleeves, sits on the sofa holding a chocolate-chip cookie. From the left, ' },
    { kind: 'label', labelId: 'sub4', bracketed: true },
    { kind: 'text', text: ', the young man with short wavy brown hair and a dark-grey hoodie with drawstrings, enters holding the leash of ' },
    { kind: 'label', labelId: 'sub2', bracketed: true },
    { kind: 'text', text: ', the thick-furred white Samoyed with pointed ears, a dark nose, and a curved tail. The dog lunges toward the cookie and pulls the leash taut. ' },
    { kind: 'label', labelId: 'sub3', speakerId: 'sp1', bracketed: true },
    { kind: 'text', text: ' jerks her hand back and, using the clear youthful voice timbre referenced from <Audio 1>, ' },
    { kind: 'dialogue', eventId: 'd1' },
    { kind: 'text', text: ' She closes her lips and guards the cookie while ' },
    { kind: 'label', labelId: 'sub4', bracketed: true },
    { kind: 'text', text: ' pulls the dog back.' },
  ],
})

const shot2: Shot = emptyShot({
  id: 's2', index: 1, startMs: 3000, composition: 'close-up',
  dialogue: [{
    id: 'd2', speakerIds: ['sp2'],
    verb: 'says in a casual young male voice with a playful tone and an easy conversational pace',
    punctuation: ',', language: 'English', text: 'He just likes cookies more than me.',
    voiceover: false, sceneTransBefore: false, sceneTransAfter: false, cutoff: false,
    startMs: 3200, endMs: 5000,
  }],
  body: [
    { kind: 'text', text: 'a close-up of ' },
    { kind: 'label', labelId: 'sub4', speakerId: 'sp2', bracketed: true },
    { kind: 'text', text: ', the young man in the dark-grey hoodie from Shot 1, sitting beside ' },
    { kind: 'label', labelId: 'sub3', bracketed: true },
    { kind: 'text', text: ' on the sofa and holding ' },
    { kind: 'label', labelId: 'sub2', bracketed: true },
    { kind: 'text', text: ' securely in his arms. ' },
    { kind: 'label', labelId: 'sub4', speakerId: 'sp2', bracketed: true },
    { kind: 'text', text: ' ' },
    { kind: 'dialogue', eventId: 'd2' },
    { kind: 'text', text: ' He closes his mouth into an apologetic smile and strokes the dog\'s thick white fur.' },
  ],
})

const shot3: Shot = emptyShot({
  id: 's3', index: 2, startMs: 5000, composition: 'close-up',
  dialogue: [{
    id: 'd3', speakerIds: ['sp1'],
    verb: 'replies in the same clear youthful voice referenced from <Audio 1> with an amused cadence',
    punctuation: ',', language: 'English', text: 'Well, he has good taste at least.',
    voiceover: false, sceneTransBefore: false, sceneTransAfter: false, cutoff: false,
    startMs: 5200, endMs: 7000,
  }],
  body: [
    { kind: 'text', text: 'a close-up of ' },
    { kind: 'label', labelId: 'sub3', speakerId: 'sp1', bracketed: true },
    { kind: 'text', text: ', the blonde woman in the light-pink shirt from Shot 1. Her annoyance softens as she looks toward the Samoyed. ' },
    { kind: 'label', labelId: 'sub3', speakerId: 'sp1', bracketed: true },
    { kind: 'text', text: ' ' },
    { kind: 'dialogue', eventId: 'd3' },
    { kind: 'text', text: ' She smiles and raises the cookie in a small toast-like gesture. A classic canned audience laugh begins immediately after the line and continues through the final frame.' },
  ],
})

export const refProject: Project = {
  schemaVersion: 1, id: 'golden-ref', name: 'golden-ref', mode: 'REF',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'The target video uses a realistic multi-camera sitcom style with warm indoor lighting.',
  assets: [], labels, speakers,
  shots: [shot1, shot2, shot3],
  audio: {
    overallSoundscape: 'Soft indoor coffee-shop room tone continues throughout the scene.',
    nonDiegeticMusic: 'N/A',
  },
  ref: {
    taskTypes: ['reference generation', 'audio reference'],
    summaryText: 'The target video shows <Subject 3> eating a cookie in <Subject 1>. <Subject 4> enters with <Subject 2>, which lunges toward the cookie. The three-shot exchange uses <Audio 1> as the voice-timbre reference for <Subject 3> and ends with a canned audience laugh.',
    retention: [
      { id: 'r1', labelId: 'sub1', scope: 'appears in [Shot 1], [Shot 2], [Shot 3]',
        marker: 'fully_preserved',
        note: 'the exposed brick wall, orange tufted sofa, patterned pillows, neon sign, and wooden coffee table are retained.' },
      { id: 'r2', labelId: 'sub2', scope: 'appears in [Shot 1], [Shot 2]',
        marker: 'fully_preserved',
        note: "the Samoyed's thick white fur, pointed ears, dark nose, and curved tail are retained." },
      { id: 'r3', labelId: 'sub3', scope: 'appears in [Shot 1], [Shot 2], [Shot 3]',
        marker: 'fully_preserved',
        note: "the blonde woman's identity, long hair, and light-pink shirt are retained." },
      { id: 'r4', labelId: 'sub4', scope: 'appears in [Shot 1], [Shot 2]',
        marker: 'fully_preserved',
        note: "the young man's short wavy brown hair and dark-grey hoodie are retained." },
      { id: 'r5', labelId: 'aud1', scope: '', marker: 'reference',
        note: 'its vocal timbre guides the dialogue delivery of <Subject 3> without copying the original signal.' },
    ],
  },
}
```

- [ ] **Step 5: Uruchom test złoty**

Run: `cd ~/mmh3-studio && npm test -- golden/ref`
Expected: PASS, 1 test

Przy różnicy porównaj wynik z plikiem `expected/ref.txt` znak po znaku — apostrofy w `dog's` i `Samoyed's` to zwykłe `'` (U+0027), nie apostrof typograficzny. **Nie modyfikuj pliku oczekiwanego.**

- [ ] **Step 6: Commit**

```bash
cd ~/mmh3-studio
git add shared/test/golden/expected/ref.txt shared/test/golden/fixtures/ref.ts shared/test/golden/ref.test.ts
git commit -m "test: zloty test pelnego przykladu z guide_ref"
```

---

### Task 11: Wejście kompilatora i mapa tokenów

Mapa tokenów wiąże zakresy tekstu z obiektami modelu, żeby aplikacja mogła podświetlać klip po kliknięciu w prompt i odwrotnie.

**Files:**
- Create: `shared/src/model/refs.ts`
- Create: `shared/src/compile/tokens.ts`
- Create: `shared/src/compile/compile.ts`
- Test: `shared/test/compile/compile.test.ts`

**Interfaces:**
- Consumes: `emitBase`, `emitRef`, renderery segmentów
- Produces:
  - `ObjectRef = { kind: 'project' | 'shot' | 'camera' | 'dialogue' | 'speaker' | 'label' | 'screenText' | 'audio' | 'retention'; id: string }`
  - `Token = { start: number; end: number; ref: ObjectRef }`
  - `CompiledPrompt = { text: string; tokens: Token[] }`
  - `compile(project: Project): CompiledPrompt`

- [ ] **Step 1: Napisz testy**

`shared/test/compile/compile.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { compile } from '../../src/compile/compile.js'
import { t2vaProject } from '../golden/fixtures/base.js'
import { refProject } from '../golden/fixtures/ref.js'

describe('compile', () => {
  it('wybiera emiter bazowy dla trybów bazowych', () => {
    expect(compile(t2vaProject).text).toContain('integrated_multimodal_description:')
  })

  it('wybiera emiter referencyjny dla REF', () => {
    expect(compile(refProject).text).toContain('subject_definitions:')
  })

  it('mapuje nagłówek ujęcia na obiekt ujęcia', () => {
    const { text, tokens } = compile(t2vaProject)
    const shot2 = tokens.find(t => t.ref.kind === 'shot' && t.ref.id === 's2')
    expect(shot2).toBeDefined()
    expect(text.slice(shot2!.start, shot2!.end)).toBe('[Shot 2]')
  })

  it('mapuje frazę ruchu kamery na obiekt ruchu', () => {
    const { text, tokens } = compile(t2vaProject)
    const cam = tokens.find(t => t.ref.kind === 'camera' && t.ref.id === 'c1')
    expect(text.slice(cam!.start, cam!.end))
      .toBe('The camera pushes in with small amplitude at slow speed')
  })

  it('mapuje blok dialogowy na zdarzenie', () => {
    const { text, tokens } = compile(t2vaProject)
    const dlg = tokens.find(t => t.ref.kind === 'dialogue' && t.ref.id === 'd1')
    expect(text.slice(dlg!.start, dlg!.end))
      .toBe('says: <d>[English] First batch of the morning.</d>')
  })

  it('mapuje etykiety w trybie REF', () => {
    const { text, tokens } = compile(refProject)
    const label = tokens.find(t => t.ref.kind === 'label' && t.ref.id === 'sub1')
    expect(text.slice(label!.start, label!.end)).toBe('<Subject 1>')
  })

  it('zwraca tokeny w rosnącej kolejności pozycji', () => {
    const { tokens } = compile(refProject)
    const starts = tokens.map(t => t.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test -- compile.test`
Expected: FAIL — brak modułów

- [ ] **Step 3: Zaimplementuj typ referencji**

`shared/src/model/refs.ts`:

```ts
export type ObjectRefKind =
  | 'project' | 'shot' | 'camera' | 'dialogue' | 'speaker'
  | 'label' | 'screenText' | 'audio' | 'retention'

export interface ObjectRef {
  kind: ObjectRefKind
  id: string
}

export interface Token {
  start: number
  end: number
  ref: ObjectRef
}
```

- [ ] **Step 4: Zaimplementuj mapę tokenów**

`shared/src/compile/tokens.ts`:

```ts
import type { Project } from '../model/types.js'
import type { ObjectRef, Token } from '../model/refs.js'
import { renderCameraMove } from './renderCamera.js'
import { renderDialogue } from './renderDialogue.js'
import { renderSpeakerSegment } from './renderSpeaker.js'
import { renderLabelSegment } from './renderLabel.js'

/**
 * Lokalizuje wyrenderowane fragmenty w gotowym tekście, skanując w przód.
 * Emitery produkują fragmenty w tej samej kolejności, w jakiej je tu odwiedzamy,
 * więc pojedynczy przesuwający się kursor wystarcza. Fragment, którego nie da się
 * znaleźć, jest pomijany — mapa tokenów jest pomocą nawigacyjną, nie źródłem prawdy.
 */
export function buildTokens(project: Project, text: string): Token[] {
  const tokens: Token[] = []
  let cursor = 0

  const locate = (fragment: string, ref: ObjectRef): void => {
    if (!fragment) return
    const start = text.indexOf(fragment, cursor)
    if (start === -1) return
    tokens.push({ start, end: start + fragment.length, ref })
    cursor = start + fragment.length
  }

  for (const shot of [...project.shots].sort((a, b) => a.index - b.index)) {
    locate(`[Shot ${shot.index + 1}]`, { kind: 'shot', id: shot.id })

    for (const seg of shot.body) {
      switch (seg.kind) {
        case 'camera': {
          const move = shot.cameraMoves.find(m => m.id === seg.moveId)
          if (move) locate(renderCameraMove(move), { kind: 'camera', id: move.id })
          break
        }
        case 'dialogue': {
          const event = shot.dialogue.find(d => d.id === seg.eventId)
          if (event) locate(renderDialogue(event), { kind: 'dialogue', id: event.id })
          break
        }
        case 'speaker':
          locate(renderSpeakerSegment(seg, project.speakers), { kind: 'speaker', id: seg.speakerId })
          break
        case 'label':
          locate(renderLabelSegment(seg, project.labels, project.speakers), { kind: 'label', id: seg.labelId })
          break
        case 'screenText': {
          const st = shot.screenText.find(t => t.id === seg.id)
          if (st) locate(`"${st.text}"`, { kind: 'screenText', id: st.id })
          break
        }
        case 'text':
          break
      }
    }
  }

  return tokens
}
```

- [ ] **Step 5: Zaimplementuj wejście kompilatora**

`shared/src/compile/compile.ts`:

```ts
import type { Project } from '../model/types.js'
import type { Token } from '../model/refs.js'
import { emitBase } from './emitBase.js'
import { emitRef } from './emitRef.js'
import { buildTokens } from './tokens.js'

export interface CompiledPrompt {
  text: string
  tokens: Token[]
}

export function compile(project: Project): CompiledPrompt {
  const text = project.mode === 'REF' ? emitRef(project) : emitBase(project)
  return { text, tokens: buildTokens(project, text) }
}
```

- [ ] **Step 6: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test`
Expected: PASS, wszystkie dotychczasowe testy plus 7 nowych

- [ ] **Step 7: Commit**

```bash
cd ~/mmh3-studio
git add shared/src/model/refs.ts shared/src/compile/tokens.ts shared/src/compile/compile.ts shared/test/compile/compile.test.ts
git commit -m "feat: wejscie kompilatora i mapa tokenow tekst-obiekt"
```

---

### Task 12: Szkielet walidatora

**Files:**
- Create: `shared/src/validate/types.ts`
- Create: `shared/src/validate/registry.ts`
- Create: `shared/src/validate/validate.ts`
- Test: `shared/test/validate/registry.test.ts`

**Interfaces:**
- Consumes: `ObjectRef`, `Project`, `CompiledPrompt`
- Produces:
  - `Severity = 'error' | 'warning' | 'hint'`
  - `Diagnostic = { ruleId: string; severity: Severity; message: string; messageEn: string; ref: ObjectRef; guideRef: string }`
  - `Rule = { id: string; severity: Severity; guideRef: string; run(ctx: RuleContext): Diagnostic[] }`
  - `RuleContext = { project: Project; compiled: CompiledPrompt }`
  - `registerRules(rules: Rule[]): void`, `allRules(): Rule[]`
  - `validate(project: Project, compiled: CompiledPrompt): Diagnostic[]`
  - `makeDiagnostic(rule, ref, message, messageEn): Diagnostic`

- [ ] **Step 1: Napisz testy**

`shared/test/validate/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { defineRule, makeDiagnostic } from '../../src/validate/types.js'
import { validateWith } from '../../src/validate/validate.js'
import { compile } from '../../src/compile/compile.js'
import { t2vaProject } from '../golden/fixtures/base.js'

const alwaysFails = defineRule({
  id: 'TEST_ALWAYS',
  severity: 'error',
  guideRef: 'test',
  run: ({ project }) => [
    makeDiagnostic(alwaysFails, { kind: 'project', id: project.id }, 'zawsze', 'always'),
  ],
})

const neverFails = defineRule({
  id: 'TEST_NEVER', severity: 'warning', guideRef: 'test', run: () => [],
})

describe('walidator', () => {
  it('zbiera diagnostyki ze wszystkich reguł', () => {
    const compiled = compile(t2vaProject)
    const out = validateWith([alwaysFails, neverFails], t2vaProject, compiled)
    expect(out).toHaveLength(1)
    expect(out[0]!.ruleId).toBe('TEST_ALWAYS')
    expect(out[0]!.severity).toBe('error')
    expect(out[0]!.message).toBe('zawsze')
    expect(out[0]!.messageEn).toBe('always')
    expect(out[0]!.guideRef).toBe('test')
  })

  it('nie przerywa serii, gdy reguła rzuci wyjątek', () => {
    const throwing = defineRule({
      id: 'TEST_THROWS', severity: 'error', guideRef: 'test',
      run: () => { throw new Error('bum') },
    })
    const compiled = compile(t2vaProject)
    const out = validateWith([throwing, alwaysFails], t2vaProject, compiled)
    expect(out.map(d => d.ruleId)).toContain('TEST_ALWAYS')
    expect(out.find(d => d.ruleId === 'TEST_THROWS')?.message).toContain('bum')
  })

  it('sortuje wynik: błędy, ostrzeżenia, wskazówki', () => {
    const hint = defineRule({
      id: 'TEST_HINT', severity: 'hint', guideRef: 'test',
      run: ({ project }) => [makeDiagnostic(hint, { kind: 'project', id: project.id }, 'w', 'h')],
    })
    const compiled = compile(t2vaProject)
    const out = validateWith([hint, alwaysFails], t2vaProject, compiled)
    expect(out.map(d => d.severity)).toEqual(['error', 'hint'])
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test -- registry`
Expected: FAIL — brak modułów

- [ ] **Step 3: Zaimplementuj typy reguł**

`shared/src/validate/types.ts`:

```ts
import type { Project } from '../model/types.js'
import type { ObjectRef } from '../model/refs.js'
import type { CompiledPrompt } from '../compile/compile.js'

export type Severity = 'error' | 'warning' | 'hint'

export interface Diagnostic {
  ruleId: string
  severity: Severity
  /** Komunikat po polsku. */
  message: string
  /** Komunikat po angielsku. */
  messageEn: string
  ref: ObjectRef
  /** Odwołanie do sekcji guide'a, np. "guide_base §4.3". */
  guideRef: string
}

export interface RuleContext {
  project: Project
  compiled: CompiledPrompt
}

export interface Rule {
  id: string
  severity: Severity
  guideRef: string
  run(ctx: RuleContext): Diagnostic[]
}

export function defineRule(rule: Rule): Rule {
  return rule
}

export function makeDiagnostic(
  rule: Pick<Rule, 'id' | 'severity' | 'guideRef'>,
  ref: ObjectRef,
  message: string,
  messageEn: string,
): Diagnostic {
  return {
    ruleId: rule.id,
    severity: rule.severity,
    message,
    messageEn,
    ref,
    guideRef: rule.guideRef,
  }
}
```

- [ ] **Step 4: Zaimplementuj rejestr i uruchamianie**

`shared/src/validate/registry.ts`:

```ts
import type { Rule } from './types.js'

const rules: Rule[] = []

export function registerRules(newRules: Rule[]): void {
  for (const rule of newRules) {
    if (rules.some(r => r.id === rule.id)) {
      throw new Error(`Reguła o identyfikatorze ${rule.id} jest już zarejestrowana`)
    }
    rules.push(rule)
  }
}

export function allRules(): Rule[] {
  return [...rules]
}
```

`shared/src/validate/validate.ts`:

```ts
import type { Project } from '../model/types.js'
import type { CompiledPrompt } from '../compile/compile.js'
import type { Diagnostic, Rule, Severity } from './types.js'
import { allRules } from './registry.js'

const ORDER: Record<Severity, number> = { error: 0, warning: 1, hint: 2 }

export function validateWith(
  rules: Rule[],
  project: Project,
  compiled: CompiledPrompt,
): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const rule of rules) {
    try {
      out.push(...rule.run({ project, compiled }))
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      out.push({
        ruleId: rule.id,
        severity: 'error',
        message: `Reguła ${rule.id} zgłosiła wyjątek: ${detail}`,
        messageEn: `Rule ${rule.id} threw: ${detail}`,
        ref: { kind: 'project', id: project.id },
        guideRef: rule.guideRef,
      })
    }
  }
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
}

export function validate(project: Project, compiled: CompiledPrompt): Diagnostic[] {
  return validateWith(allRules(), project, compiled)
}
```

- [ ] **Step 5: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test -- registry`
Expected: PASS, 3 testy

- [ ] **Step 6: Commit**

```bash
cd ~/mmh3-studio
git add shared/src/validate shared/test/validate
git commit -m "feat: szkielet walidatora z rejestrem regul i dwujezycznymi komunikatami"
```

---

### Task 13: Reguły czasu, kamery i spójności ciała ujęcia

**Files:**
- Create: `shared/src/validate/rules/time.ts`
- Create: `shared/src/validate/rules/camera.ts`
- Test: `shared/test/validate/rules/timeCamera.test.ts`

**Interfaces:**
- Consumes: `defineRule`, `makeDiagnostic`, `snapToFrame`, `CAMERA_MOTIONS`
- Produces: `timeRules: Rule[]`, `cameraRules: Rule[]`

- [ ] **Step 1: Napisz testy**

`shared/test/validate/rules/timeCamera.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { timeRules } from '../../../src/validate/rules/time.js'
import { cameraRules } from '../../../src/validate/rules/camera.js'
import { validateWith } from '../../../src/validate/validate.js'
import { compile } from '../../../src/compile/compile.js'
import { t2vaProject } from '../../golden/fixtures/base.js'
import type { Project } from '../../../src/model/types.js'

const rules = [...timeRules, ...cameraRules]

/**
 * Część przypadków celowo psuje model tak, że kompilacja rzuca wyjątek
 * (segment wskazujący nieistniejący obiekt, nieznany typ ruchu). Walidator
 * ma wtedy nadal działać, więc kompilujemy defensywnie.
 */
const safeCompile = (p: Project) => {
  try {
    return compile(p)
  } catch {
    return { text: '', tokens: [] }
  }
}

const run = (p: Project) => validateWith(rules, p, safeCompile(p)).map(d => d.ruleId)

describe('reguły czasu i kamery', () => {
  it('nie zgłasza nic dla poprawnego projektu złotego', () => {
    expect(run(t2vaProject)).toEqual([])
  })

  it('DURATION_RANGE — długość poniżej 4 s', () => {
    expect(run({ ...t2vaProject, video: { ...t2vaProject.video, durationMs: 3000 } }))
      .toContain('DURATION_RANGE')
  })

  it('DURATION_RANGE — długość powyżej 15 s', () => {
    expect(run({ ...t2vaProject, video: { ...t2vaProject.video, durationMs: 16000 } }))
      .toContain('DURATION_RANGE')
  })

  it('SHOT1_NO_TIMESTAMP — pierwsze ujęcie nie zaczyna się od zera', () => {
    const shots = [...t2vaProject.shots]
    shots[0] = { ...shots[0]!, startMs: 500 }
    expect(run({ ...t2vaProject, shots })).toContain('SHOT1_NO_TIMESTAMP')
  })

  it('SHOT_TIME_MONOTONIC — czasy cięć nie rosną', () => {
    const shots = [...t2vaProject.shots]
    shots[1] = { ...shots[1]!, startMs: 0 }
    expect(run({ ...t2vaProject, shots })).toContain('SHOT_TIME_MONOTONIC')
  })

  it('SHOT_TIME_IN_RANGE — cięcie poza długością wideo', () => {
    const shots = [...t2vaProject.shots]
    shots[1] = { ...shots[1]!, startMs: 9000 }
    expect(run({ ...t2vaProject, shots })).toContain('SHOT_TIME_IN_RANGE')
  })

  it('FRAME_SNAP — czas nie leży na granicy klatki', () => {
    const shots = [...t2vaProject.shots]
    shots[1] = { ...shots[1]!, startMs: 5010 }
    expect(run({ ...t2vaProject, shots })).toContain('FRAME_SNAP')
  })

  it('CAM_VOCAB — typ ruchu spoza słownika', () => {
    const shots = [...t2vaProject.shots]
    shots[0] = {
      ...shots[0]!,
      cameraMoves: [{ ...shots[0]!.cameraMoves[0]!, type: 'barrel-roll' as never }],
    }
    expect(run({ ...t2vaProject, shots })).toContain('CAM_VOCAB')
  })

  it('CAM_IN_SHOT_BOUNDS — ruch wychodzi poza ujęcie', () => {
    const shots = [...t2vaProject.shots]
    shots[0] = {
      ...shots[0]!,
      cameraMoves: [{ ...shots[0]!.cameraMoves[0]!, endMs: 7000 }],
    }
    expect(run({ ...t2vaProject, shots })).toContain('CAM_IN_SHOT_BOUNDS')
  })

  it('CAM_REDUNDANT_MODIFIER — jawnie wpisana wartość domyślna', () => {
    const shots = [...t2vaProject.shots]
    shots[0] = {
      ...shots[0]!,
      cameraMoves: [{ ...shots[0]!.cameraMoves[0]!, customPhrase: 'The camera pushes in with medium amplitude' }],
    }
    expect(run({ ...t2vaProject, shots })).toContain('CAM_REDUNDANT_MODIFIER')
  })

  it('BODY_REFS_COMPLETE — ruch kamery nieprzywołany w body', () => {
    const shots = [...t2vaProject.shots]
    shots[0] = {
      ...shots[0]!,
      body: shots[0]!.body.filter(s => s.kind !== 'camera'),
    }
    expect(run({ ...t2vaProject, shots })).toContain('BODY_REFS_COMPLETE')
  })

  it('BODY_REFS_COMPLETE — segment wskazuje nieistniejący obiekt', () => {
    const shots = [...t2vaProject.shots]
    shots[1] = { ...shots[1]!, body: [{ kind: 'dialogue', eventId: 'brak' }] }
    expect(run({ ...t2vaProject, shots })).toContain('BODY_REFS_COMPLETE')
  })

  it('TRANSITION_EXPLICIT — przejście inne niż cięcie', () => {
    const shots = [...t2vaProject.shots]
    shots[1] = { ...shots[1]!, cutType: 'cross-dissolve' }
    expect(run({ ...t2vaProject, shots })).toContain('TRANSITION_EXPLICIT')
  })

  it('CUT_SHOULD_BE_MOVE — sąsiednie ujęcia różnią się tylko planem', () => {
    const shots = [...t2vaProject.shots]
    shots[0] = { ...shots[0]!, composition: 'medium shot of the counter' }
    shots[1] = { ...shots[1]!, composition: 'close-up shot of the counter' }
    expect(run({ ...t2vaProject, shots })).toContain('CUT_SHOULD_BE_MOVE')
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test -- timeCamera`
Expected: FAIL — brak modułów

- [ ] **Step 3: Zaimplementuj reguły czasu**

`shared/src/validate/rules/time.ts`:

```ts
import { MAX_DURATION_MS, MIN_DURATION_MS } from '../../model/types.js'
import { isFrameAligned } from '../../time/frames.js'
import { defineRule, makeDiagnostic, type Rule } from '../types.js'

const durationRange = defineRule({
  id: 'DURATION_RANGE',
  severity: 'error',
  guideRef: 'karta modelu MiniMax-H3 — długość 4–15 s',
  run: ({ project }) => {
    const { durationMs } = project.video
    if (durationMs >= MIN_DURATION_MS && durationMs <= MAX_DURATION_MS) return []
    return [makeDiagnostic(
      durationRange,
      { kind: 'project', id: project.id },
      `Długość wideo ${durationMs} ms jest poza zakresem 4000–15000 ms.`,
      `Video duration ${durationMs} ms is outside the 4000–15000 ms range.`,
    )]
  },
})

const shot1NoTimestamp = defineRule({
  id: 'SHOT1_NO_TIMESTAMP',
  severity: 'error',
  guideRef: 'guide_base §4.2',
  run: ({ project }) => {
    const first = [...project.shots].sort((a, b) => a.index - b.index)[0]
    if (!first || first.startMs === 0) return []
    return [makeDiagnostic(
      shot1NoTimestamp,
      { kind: 'shot', id: first.id },
      'Pierwsze ujęcie musi zaczynać się w 0 ms i nie otrzymuje timestampu.',
      'The first shot must start at 0 ms and carries no timestamp.',
    )]
  },
})

const shotTimeMonotonic = defineRule({
  id: 'SHOT_TIME_MONOTONIC',
  severity: 'error',
  guideRef: 'guide_base §4.2',
  run: ({ project }) => {
    const shots = [...project.shots].sort((a, b) => a.index - b.index)
    return shots.flatMap((shot, i) => {
      const prev = shots[i - 1]
      if (!prev || shot.startMs > prev.startMs) return []
      return [makeDiagnostic(
        shotTimeMonotonic,
        { kind: 'shot', id: shot.id },
        `Czas cięcia ujęcia ${shot.index + 1} nie jest większy od poprzedniego.`,
        `Cut time of shot ${shot.index + 1} is not greater than the previous one.`,
      )]
    })
  },
})

const shotTimeInRange = defineRule({
  id: 'SHOT_TIME_IN_RANGE',
  severity: 'error',
  guideRef: 'guide_base §4.2',
  run: ({ project }) => project.shots
    .filter(shot => shot.startMs >= project.video.durationMs)
    .map(shot => makeDiagnostic(
      shotTimeInRange,
      { kind: 'shot', id: shot.id },
      `Cięcie ujęcia ${shot.index + 1} wypada poza długością wideo.`,
      `The cut of shot ${shot.index + 1} falls outside the video duration.`,
    )),
})

const frameSnap = defineRule({
  id: 'FRAME_SNAP',
  severity: 'warning',
  guideRef: '24 FPS — karta modelu',
  run: ({ project }) => project.shots
    .filter(shot => !isFrameAligned(shot.startMs))
    .map(shot => makeDiagnostic(
      frameSnap,
      { kind: 'shot', id: shot.id },
      `Czas cięcia ${shot.startMs} ms nie leży na granicy klatki przy 24 fps.`,
      `Cut time ${shot.startMs} ms is not aligned to a frame boundary at 24 fps.`,
    )),
})

export const timeRules: Rule[] = [
  durationRange, shot1NoTimestamp, shotTimeMonotonic, shotTimeInRange, frameSnap,
]
```

- [ ] **Step 4: Zaimplementuj reguły kamery i spójności body**

`shared/src/validate/rules/camera.ts`:

```ts
import type { Project, Shot } from '../../model/types.js'
import { CAMERA_MOTIONS } from '../../vocab/camera.js'
import { defineRule, makeDiagnostic, type Diagnostic, type Rule } from '../types.js'

const KNOWN_TYPES = new Set(CAMERA_MOTIONS.map(m => m.type))

/** Słowa oznaczające wielkość planu — używane przez CUT_SHOULD_BE_MOVE. */
const SHOT_SIZE_WORDS = [
  'extreme close-up', 'close-up', 'medium-wide', 'medium', 'wide', 'full', 'long', 'close',
]

const stripShotSize = (composition: string): string => {
  let out = composition.toLowerCase()
  for (const word of SHOT_SIZE_WORDS) out = out.replaceAll(word, '')
  return out.replace(/\s+/g, ' ').trim()
}

const shotSizeOf = (composition: string): string | null =>
  SHOT_SIZE_WORDS.find(word => composition.toLowerCase().includes(word)) ?? null

const shotEnd = (project: Project, shot: Shot): number => {
  const next = project.shots.find(s => s.index === shot.index + 1)
  return next ? next.startMs : project.video.durationMs
}

const camVocab = defineRule({
  id: 'CAM_VOCAB',
  severity: 'error',
  guideRef: 'guide_base §4.3',
  run: ({ project }) => project.shots.flatMap(shot =>
    shot.cameraMoves
      .filter(move => !KNOWN_TYPES.has(move.type))
      .map(move => makeDiagnostic(
        camVocab,
        { kind: 'camera', id: move.id },
        `Typ ruchu kamery "${move.type}" nie występuje w słowniku guide'a.`,
        `Camera motion type "${move.type}" is not in the guide vocabulary.`,
      )),
  ),
})

const camInShotBounds = defineRule({
  id: 'CAM_IN_SHOT_BOUNDS',
  severity: 'warning',
  guideRef: 'guide_base §4.3',
  run: ({ project }) => project.shots.flatMap(shot => {
    const end = shotEnd(project, shot)
    return shot.cameraMoves
      .filter(move => move.startMs < shot.startMs || move.endMs > end)
      .map(move => makeDiagnostic(
        camInShotBounds,
        { kind: 'camera', id: move.id },
        `Ruch kamery wykracza poza granice ujęcia ${shot.index + 1}.`,
        `The camera move extends beyond the bounds of shot ${shot.index + 1}.`,
      ))
  }),
})

const camRedundantModifier = defineRule({
  id: 'CAM_REDUNDANT_MODIFIER',
  severity: 'warning',
  guideRef: 'guide_base §4.3',
  run: ({ project }) => project.shots.flatMap(shot =>
    shot.cameraMoves
      .filter(move => /medium amplitude|normal speed/i.test(
        `${move.customPhrase ?? ''} ${move.target ?? ''}`,
      ))
      .map(move => makeDiagnostic(
        camRedundantModifier,
        { kind: 'camera', id: move.id },
        'Średnia amplituda i normalna prędkość powinny być pominięte, nie zapisane wprost.',
        'Medium amplitude and normal speed should be omitted, not written out.',
      )),
  ),
})

const bodyRefsComplete = defineRule({
  id: 'BODY_REFS_COMPLETE',
  severity: 'error',
  guideRef: 'guide_base §4.3, §4.4',
  run: ({ project }) => project.shots.flatMap(shot => {
    const out: Diagnostic[] = []
    const usedMoves = shot.body.filter(s => s.kind === 'camera').map(s => s.moveId)
    const usedDialogue = shot.body.filter(s => s.kind === 'dialogue').map(s => s.eventId)

    for (const move of shot.cameraMoves) {
      const count = usedMoves.filter(id => id === move.id).length
      if (count !== 1) {
        out.push(makeDiagnostic(
          bodyRefsComplete,
          { kind: 'camera', id: move.id },
          `Ruch kamery jest przywołany w treści ujęcia ${count} raz(y) zamiast dokładnie raz.`,
          `The camera move is referenced ${count} time(s) in the shot body instead of exactly once.`,
        ))
      }
    }

    for (const event of shot.dialogue) {
      const count = usedDialogue.filter(id => id === event.id).length
      if (count !== 1) {
        out.push(makeDiagnostic(
          bodyRefsComplete,
          { kind: 'dialogue', id: event.id },
          `Kwestia dialogowa jest przywołana w treści ujęcia ${count} raz(y) zamiast dokładnie raz.`,
          `The dialogue event is referenced ${count} time(s) in the shot body instead of exactly once.`,
        ))
      }
    }

    for (const id of usedMoves) {
      if (!shot.cameraMoves.some(m => m.id === id)) {
        out.push(makeDiagnostic(
          bodyRefsComplete, { kind: 'shot', id: shot.id },
          `Segment wskazuje nieistniejący ruch kamery: ${id}.`,
          `A segment points to a missing camera move: ${id}.`,
        ))
      }
    }
    for (const id of usedDialogue) {
      if (!shot.dialogue.some(d => d.id === id)) {
        out.push(makeDiagnostic(
          bodyRefsComplete, { kind: 'shot', id: shot.id },
          `Segment wskazuje nieistniejącą kwestię dialogową: ${id}.`,
          `A segment points to a missing dialogue event: ${id}.`,
        ))
      }
    }

    return out
  }),
})

const cutShouldBeMove = defineRule({
  id: 'CUT_SHOULD_BE_MOVE',
  severity: 'hint',
  guideRef: 'guide_base §4.2',
  run: ({ project }) => {
    const shots = [...project.shots].sort((a, b) => a.index - b.index)
    return shots.flatMap((shot, i) => {
      const prev = shots[i - 1]
      if (!prev || !shot.composition || !prev.composition) return []
      const context = stripShotSize(prev.composition)
      // Sam plan bez opisu treści kadru ("medium-wide" vs "close-up") nie
      // wystarcza do orzeczenia, że ujęcia pokazują to samo.
      if (!context) return []
      const sameContext = context === stripShotSize(shot.composition)
      const differentSize = shotSizeOf(prev.composition) !== shotSizeOf(shot.composition)
      if (!sameContext || !differentSize) return []
      return [makeDiagnostic(
        cutShouldBeMove,
        { kind: 'shot', id: shot.id },
        'Ujęcia różnią się tylko wielkością planu — guide zaleca wtedy ruch kamery zamiast cięcia.',
        'These shots differ only in shot size — the guide prefers camera motion over a cut here.',
      )]
    })
  },
})

const transitionExplicit = defineRule({
  id: 'TRANSITION_EXPLICIT',
  severity: 'hint',
  guideRef: 'guide_base §4.2',
  run: ({ project }) => project.shots
    .filter(shot => shot.index > 0 && shot.cutType !== 'cut')
    .map(shot => makeDiagnostic(
      transitionExplicit,
      { kind: 'shot', id: shot.id },
      `Przejście "${shot.cutType}" guide dopuszcza tylko na wyraźne życzenie — domyślne jest zwykłe cięcie.`,
      `The "${shot.cutType}" transition is allowed only when explicitly requested — a plain cut is the default.`,
    )),
})

export const cameraRules: Rule[] = [
  camVocab, camInShotBounds, camRedundantModifier, bodyRefsComplete,
  cutShouldBeMove, transitionExplicit,
]
```

- [ ] **Step 5: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test -- timeCamera`
Expected: PASS, 14 testów

- [ ] **Step 6: Commit**

```bash
cd ~/mmh3-studio
git add shared/src/validate/rules shared/test/validate/rules
git commit -m "feat: reguly walidatora dla czasu, kamery i spojnosci ciala ujecia"
```

---

### Task 14: Reguły mówców i dialogu

**Files:**
- Create: `shared/src/validate/rules/speech.ts`
- Test: `shared/test/validate/rules/speech.test.ts`

**Interfaces:**
- Consumes: `CONTINUITY_PHRASES`, `defineRule`, `makeDiagnostic`
- Produces:
  - `WORDS_PER_SECOND = 2.7`
  - `estimateSpeechMs(text: string): number`
  - `speechRules: Rule[]`

- [ ] **Step 1: Napisz testy**

`shared/test/validate/rules/speech.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { speechRules, estimateSpeechMs } from '../../../src/validate/rules/speech.js'
import { validateWith } from '../../../src/validate/validate.js'
import { compile } from '../../../src/compile/compile.js'
import { t2vaProject, i2vaProject } from '../../golden/fixtures/base.js'
import { refProject } from '../../golden/fixtures/ref.js'
import type { Project } from '../../../src/model/types.js'

const run = (p: Project) => validateWith(speechRules, p, compile(p)).map(d => d.ruleId)

const withDialogue = (p: Project, patch: Record<string, unknown>): Project => {
  const shots = [...p.shots]
  shots[0] = { ...shots[0]!, dialogue: [{ ...shots[0]!.dialogue[0]!, ...patch }] }
  return { ...p, shots }
}

describe('estimateSpeechMs', () => {
  it('szacuje czas mowy z liczby słów', () => {
    expect(estimateSpeechMs('First batch of the morning.')).toBe(1852)
    expect(estimateSpeechMs('')).toBe(0)
  })
})

describe('reguły mowy', () => {
  it('nie zgłasza nic dla projektów złotych', () => {
    expect(run(t2vaProject)).toEqual([])
    expect(run(i2vaProject)).toEqual([])
    expect(run(refProject)).toEqual([])
  })

  it('SPEAKER_ID_STABLE — dwaj mówcy z tym samym kodem', () => {
    const speakers = [
      t2vaProject.speakers[0]!,
      { ...t2vaProject.speakers[0]!, id: 'sp2' },
    ]
    expect(run({ ...t2vaProject, speakers })).toContain('SPEAKER_ID_STABLE')
  })

  it('SPEAKER_SILENT_NO_ID — mówca bez żadnej kwestii', () => {
    const speakers = [
      ...t2vaProject.speakers,
      { ...t2vaProject.speakers[0]!, id: 'sp9', code: 'S9' },
    ]
    expect(run({ ...t2vaProject, speakers })).toContain('SPEAKER_SILENT_NO_ID')
  })

  it('SPEAKER_FIRST_INTRO — pierwsze wystąpienie bez pełnego opisu', () => {
    const shots = [...t2vaProject.shots]
    shots[0] = {
      ...shots[0]!,
      body: shots[0]!.body.map(s => s.kind === 'speaker' ? { ...s, form: 'idOnly' as const } : s),
    }
    expect(run({ ...t2vaProject, shots })).toContain('SPEAKER_FIRST_INTRO')
  })

  it('DIALOGUE_D_TAG_PURE — znacznik <d> wewnątrz treści', () => {
    expect(run(withDialogue(t2vaProject, { text: '<d>[English] Hi.</d>' })))
      .toContain('DIALOGUE_D_TAG_PURE')
  })

  it('DIALOGUE_VERBATIM — treść zaczyna się od czasownika mówienia', () => {
    expect(run(withDialogue(t2vaProject, { text: 'says: hello there' })))
      .toContain('DIALOGUE_VERBATIM')
  })

  it('VO_LIPS_CLAUSE — voiceover bez klauzuli o ustach', () => {
    expect(run(withDialogue(t2vaProject, { voiceover: true })))
      .toContain('VO_LIPS_CLAUSE')
  })

  it('VO_EXACT_PHRASE — własny czasownik przy voiceoverze', () => {
    const ids = run(withDialogue(t2vaProject, {
      voiceover: true, verb: 'whispers', lipsClause: 'while his lips remain completely closed.',
    }))
    expect(ids).toContain('VO_EXACT_PHRASE')
  })

  it('SCENETRANS_BOTH_SIDES — brak kontynuacji w kolejnym ujęciu', () => {
    expect(run(withDialogue(t2vaProject, {
      sceneTransAfter: true, continuityPhrase: 'carries over from the previous shot',
    }))).toContain('SCENETRANS_BOTH_SIDES')
  })

  it('SCENETRANS_BOTH_SIDES — zdanie o ciągłości spoza dozwolonej listy', () => {
    expect(run(withDialogue(t2vaProject, {
      sceneTransAfter: true, continuityPhrase: 'keeps going somehow',
    }))).toContain('SCENETRANS_BOTH_SIDES')
  })

  it('CUTOFF_AT_END — mowa wychodzi poza koniec bez znacznika', () => {
    expect(run(withDialogue(t2vaProject, { endMs: 9000 })))
      .toContain('CUTOFF_AT_END')
  })

  it('CUTOFF_AT_END — znacznik przy mowie kończącej się przed końcem', () => {
    expect(run(withDialogue(t2vaProject, { cutoff: true })))
      .toContain('CUTOFF_AT_END')
  })

  it('SPEECH_FITS — kwestia nie mieści się w swoim oknie', () => {
    expect(run(withDialogue(t2vaProject, {
      text: 'This is a considerably longer line of dialogue that cannot possibly fit inside the allotted window of time.',
    }))).toContain('SPEECH_FITS')
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test -- speech`
Expected: FAIL — brak modułu

- [ ] **Step 3: Zaimplementuj**

`shared/src/validate/rules/speech.ts`:

```ts
import type { DialogueEvent, Project, Shot } from '../../model/types.js'
import { CONTINUITY_PHRASES } from '../../vocab/continuity.js'
import { defineRule, makeDiagnostic, type Diagnostic, type Rule } from '../types.js'

/** Domyślne tempo mowy używane do szacowania długości kwestii. */
export const WORDS_PER_SECOND = 2.7

/** Tolerancja: kwestia może przekroczyć swoje okno o połowę, zanim zgłosimy problem. */
const FIT_TOLERANCE = 1.5

const SPEECH_VERBS = ['says', 'said', 'replies', 'exclaims', 'shouts', 'whispers', 'asks', 'answers']

export function estimateSpeechMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  if (words === 0) return 0
  return Math.round((words / WORDS_PER_SECOND) * 1000)
}

const eachDialogue = (
  project: Project,
  fn: (event: DialogueEvent, shot: Shot) => Diagnostic[],
): Diagnostic[] =>
  project.shots.flatMap(shot => shot.dialogue.flatMap(event => fn(event, shot)))

const speakerIdStable = defineRule({
  id: 'SPEAKER_ID_STABLE',
  severity: 'error',
  guideRef: 'guide_base §4.4',
  run: ({ project }) => {
    const seen = new Map<string, string>()
    const out: Diagnostic[] = []
    for (const speaker of project.speakers) {
      const owner = seen.get(speaker.code)
      if (owner) {
        out.push(makeDiagnostic(
          speakerIdStable,
          { kind: 'speaker', id: speaker.id },
          `Identyfikator ${speaker.code} jest przypisany do więcej niż jednego mówcy.`,
          `Speaker ID ${speaker.code} is assigned to more than one speaker.`,
        ))
      } else {
        seen.set(speaker.code, speaker.id)
      }
    }
    return out
  },
})

const speakerSilentNoId = defineRule({
  id: 'SPEAKER_SILENT_NO_ID',
  severity: 'warning',
  guideRef: 'guide_base §4.4',
  run: ({ project }) => {
    const vocal = new Set(
      project.shots.flatMap(shot => shot.dialogue.flatMap(d => d.speakerIds)),
    )
    return project.speakers
      .filter(speaker => !vocal.has(speaker.id))
      .map(speaker => makeDiagnostic(
        speakerSilentNoId,
        { kind: 'speaker', id: speaker.id },
        `Mówca ${speaker.code} nie wypowiada żadnej kwestii — postacie niemówiące nie dostają ID.`,
        `Speaker ${speaker.code} has no utterance — non-vocalizing characters receive no ID.`,
      ))
  },
})

const speakerFirstIntro = defineRule({
  id: 'SPEAKER_FIRST_INTRO',
  severity: 'warning',
  guideRef: 'guide_base §4.4',
  run: ({ project }) => {
    const introduced = new Set<string>()
    const out: Diagnostic[] = []
    for (const shot of [...project.shots].sort((a, b) => a.index - b.index)) {
      for (const seg of shot.body) {
        if (seg.kind !== 'speaker') continue
        if (introduced.has(seg.speakerId)) continue
        introduced.add(seg.speakerId)
        const hasDescriptor = seg.form === 'full' || Boolean(seg.descriptor)
        if (hasDescriptor) continue
        out.push(makeDiagnostic(
          speakerFirstIntro,
          { kind: 'speaker', id: seg.speakerId },
          'Pierwsze wystąpienie mówcy musi zawierać opis tożsamości głosu.',
          'A speaker\'s first appearance must establish a stable voice identity.',
        ))
      }
    }
    return out
  },
})

const dialogueDTagPure = defineRule({
  id: 'DIALOGUE_D_TAG_PURE',
  severity: 'error',
  guideRef: 'guide_base §4.4',
  run: ({ project }) => eachDialogue(project, event =>
    /<\/?d>|^\s*\[[A-Za-z]+\]/.test(event.text)
      ? [makeDiagnostic(
          dialogueDTagPure,
          { kind: 'dialogue', id: event.id },
          'Treść kwestii nie może zawierać znacznika <d> ani tagu języka — kompilator dodaje je sam.',
          'Dialogue text must not contain the <d> tag or a language tag — the compiler adds them.',
        )]
      : [],
  ),
})

const dialogueVerbatim = defineRule({
  id: 'DIALOGUE_VERBATIM',
  severity: 'error',
  guideRef: 'guide_base §4.4',
  run: ({ project }) => eachDialogue(project, event => {
    const firstWord = event.text.trim().split(/\s|[:,]/)[0]?.toLowerCase() ?? ''
    if (!SPEECH_VERBS.includes(firstWord)) return []
    return [makeDiagnostic(
      dialogueVerbatim,
      { kind: 'dialogue', id: event.id },
      'Treść kwestii zaczyna się od czasownika mówienia — sposób podania należy poza znacznik <d>.',
      'The dialogue text starts with a speech verb — delivery belongs outside the <d> tag.',
    )]
  }),
})

const voExactPhrase = defineRule({
  id: 'VO_EXACT_PHRASE',
  severity: 'warning',
  guideRef: 'guide_base §4.4',
  run: ({ project }) => eachDialogue(project, event =>
    event.voiceover && event.verb !== 'says'
      ? [makeDiagnostic(
          voExactPhrase,
          { kind: 'dialogue', id: event.id },
          `Voiceover używa stałej frazy "says in an off-screen voiceover" — czasownik "${event.verb}" zostanie zignorowany.`,
          `Voiceover uses the fixed phrase "says in an off-screen voiceover" — the verb "${event.verb}" will be ignored.`,
        )]
      : [],
  ),
})

const voLipsClause = defineRule({
  id: 'VO_LIPS_CLAUSE',
  severity: 'error',
  guideRef: 'guide_base §4.4',
  run: ({ project }) => eachDialogue(project, event =>
    event.voiceover && !event.lipsClause?.trim()
      ? [makeDiagnostic(
          voLipsClause,
          { kind: 'dialogue', id: event.id },
          'Po bloku <d> voiceoveru musi wystąpić zdanie o całkowicie zamkniętych ustach postaci.',
          'A voiceover <d> block must be followed by a statement that the lips remain completely closed.',
        )]
      : [],
  ),
})

const sceneTransBothSides = defineRule({
  id: 'SCENETRANS_BOTH_SIDES',
  severity: 'error',
  guideRef: 'guide_base §4.4',
  run: ({ project }) => {
    const shots = [...project.shots].sort((a, b) => a.index - b.index)
    const out: Diagnostic[] = []
    shots.forEach((shot, i) => {
      for (const event of shot.dialogue) {
        if (!event.sceneTransAfter) continue
        const next = shots[i + 1]
        const continued = next?.dialogue.some(d => d.sceneTransBefore) ?? false
        if (!continued) {
          out.push(makeDiagnostic(
            sceneTransBothSides,
            { kind: 'dialogue', id: event.id },
            'Kwestia przecinająca cięcie wymaga znacznika <scenetrans> również po drugiej stronie.',
            'Dialogue crossing a cut requires a <scenetrans> marker on the other side as well.',
          ))
        }
        const phrase = event.continuityPhrase ?? ''
        if (!CONTINUITY_PHRASES.includes(phrase as (typeof CONTINUITY_PHRASES)[number])) {
          out.push(makeDiagnostic(
            sceneTransBothSides,
            { kind: 'dialogue', id: event.id },
            'Zdanie o ciągłości musi pochodzić z listy dozwolonej przez guide.',
            'The continuity statement must come from the list allowed by the guide.',
          ))
        }
      }
    })
    return out
  },
})

const cutoffAtEnd = defineRule({
  id: 'CUTOFF_AT_END',
  severity: 'error',
  guideRef: 'guide_base §4.4',
  run: ({ project }) => eachDialogue(project, event => {
    const overruns = event.endMs > project.video.durationMs
    if (overruns && !event.cutoff) {
      return [makeDiagnostic(
        cutoffAtEnd,
        { kind: 'dialogue', id: event.id },
        'Mowa ucięta końcem wideo wymaga znacznika <cutoff>.',
        'Speech truncated by the end of the video requires a <cutoff> marker.',
      )]
    }
    if (!overruns && event.cutoff) {
      return [makeDiagnostic(
        cutoffAtEnd,
        { kind: 'dialogue', id: event.id },
        'Znacznik <cutoff> ustawiony, choć kwestia kończy się przed końcem wideo.',
        'The <cutoff> marker is set although the line ends before the video does.',
      )]
    }
    return []
  }),
})

const speechFits = defineRule({
  id: 'SPEECH_FITS',
  severity: 'warning',
  guideRef: 'guide_ref §5.2 — dopasowanie ścieżki mówionej',
  run: ({ project }) => eachDialogue(project, event => {
    const slot = event.endMs - event.startMs
    if (slot <= 0) return []
    const estimate = estimateSpeechMs(event.text)
    if (estimate <= slot * FIT_TOLERANCE) return []
    return [makeDiagnostic(
      speechFits,
      { kind: 'dialogue', id: event.id },
      `Szacowana długość kwestii to ${estimate} ms przy oknie ${slot} ms — skróć tekst lub wydłuż okno.`,
      `Estimated line length is ${estimate} ms against a ${slot} ms window — shorten the text or widen the window.`,
    )]
  }),
})

export const speechRules: Rule[] = [
  speakerIdStable, speakerSilentNoId, speakerFirstIntro,
  dialogueDTagPure, dialogueVerbatim,
  voExactPhrase, voLipsClause,
  sceneTransBothSides, cutoffAtEnd, speechFits,
]
```

- [ ] **Step 4: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test -- speech`
Expected: PASS, 14 testów

- [ ] **Step 5: Commit**

```bash
cd ~/mmh3-studio
git add shared/src/validate/rules/speech.ts shared/test/validate/rules/speech.test.ts
git commit -m "feat: reguly walidatora dla mowcow, dialogu i ciaglosci przez ciecia"
```

---

### Task 15: Reguły audio

**Files:**
- Create: `shared/src/vocab/moodWords.ts`
- Create: `shared/src/validate/rules/audio.ts`
- Test: `shared/test/validate/rules/audio.test.ts`

**Interfaces:**
- Consumes: `defineRule`, `makeDiagnostic`
- Produces: `MOOD_WORDS: readonly string[]`, `countSentences(text: string): number`, `audioRules: Rule[]`

- [ ] **Step 1: Napisz testy**

`shared/test/validate/rules/audio.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { audioRules, countSentences } from '../../../src/validate/rules/audio.js'
import { validateWith } from '../../../src/validate/validate.js'
import { compile } from '../../../src/compile/compile.js'
import { t2vaProject, fl2vaProject } from '../../golden/fixtures/base.js'
import { refProject } from '../../golden/fixtures/ref.js'
import type { Project } from '../../../src/model/types.js'

const run = (p: Project) => validateWith(audioRules, p, compile(p)).map(d => d.ruleId)
const withAudio = (p: Project, audio: Partial<Project['audio']>): Project =>
  ({ ...p, audio: { ...p.audio, ...audio } })

describe('countSentences', () => {
  it('liczy zdania po znakach końca', () => {
    expect(countSentences('One. Two! Three?')).toBe(3)
    expect(countSentences('Just one sentence.')).toBe(1)
    expect(countSentences('')).toBe(0)
  })
})

describe('reguły audio', () => {
  it('nie zgłasza nic dla projektów złotych', () => {
    expect(run(t2vaProject)).toEqual([])
    expect(run(fl2vaProject)).toEqual([])
    expect(run(refProject)).toEqual([])
  })

  it('SOUNDSCAPE_SENTENCES — więcej niż cztery zdania', () => {
    expect(run(withAudio(t2vaProject, { overallSoundscape: 'A. B. C. D. E.' })))
      .toContain('SOUNDSCAPE_SENTENCES')
  })

  it('SOUNDSCAPE_SENTENCES — pusty opis', () => {
    expect(run(withAudio(t2vaProject, { overallSoundscape: '' })))
      .toContain('SOUNDSCAPE_SENTENCES')
  })

  it('MUSIC_SENTENCES — więcej niż trzy zdania', () => {
    expect(run(withAudio(t2vaProject, { nonDiegeticMusic: 'A. B. C. D.' })))
      .toContain('MUSIC_SENTENCES')
  })

  it('SOUNDSCAPE_NO_DIALOGUE — treść kwestii powtórzona w soundscape', () => {
    expect(run(withAudio(t2vaProject, {
      overallSoundscape: 'Shutters scrape open. He says First batch of the morning. loudly.',
    }))).toContain('SOUNDSCAPE_NO_DIALOGUE')
  })

  it('SOUNDSCAPE_NA_ONLY_IF_SILENT — N/A mimo kwestii dialogowych', () => {
    expect(run(withAudio(t2vaProject, { overallSoundscape: 'N/A' })))
      .toContain('SOUNDSCAPE_NA_ONLY_IF_SILENT')
  })

  it('MUSIC_NO_MOOD_WORDS — abstrakcyjne słowo o nastroju', () => {
    expect(run(withAudio(t2vaProject, {
      nonDiegeticMusic: 'A melancholic piano melody at a slow tempo.',
    }))).toContain('MUSIC_NO_MOOD_WORDS')
  })

  it('DIEGETIC_IN_DESCRIPTION — muzyka słyszalna dla postaci w polu non_diegetic', () => {
    expect(run(withAudio(t2vaProject, {
      nonDiegeticMusic: 'A radio in the corner plays guitar chords at a moderate tempo.',
    }))).toContain('DIEGETIC_IN_DESCRIPTION')
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test -- audio`
Expected: FAIL — brak modułów

- [ ] **Step 3: Zaimplementuj słownik słów o nastroju**

`shared/src/vocab/moodWords.ts`:

```ts
/**
 * Abstrakcyjne określenia nastroju zabronione w non_diegetic_music.
 * Guide wymaga instrumentacji, tempa, rytmu i dynamiki zamiast nazywania emocji.
 * Świadomie NIE zawiera słów opisujących dynamikę (soft, gentle, sparse),
 * bo te są dozwolone.
 */
export const MOOD_WORDS = [
  'melancholic', 'melancholy', 'uplifting', 'tense', 'joyful', 'sad', 'happy',
  'hopeful', 'dramatic', 'epic', 'emotional', 'nostalgic', 'romantic', 'eerie',
  'triumphant', 'somber', 'mysterious', 'haunting', 'whimsical', 'menacing',
  'heartwarming', 'bittersweet', 'ominous', 'euphoric', 'poignant',
] as const

/** Źródła dźwięku słyszalne dla postaci — nie należą do non_diegetic_music. */
export const DIEGETIC_SOURCES = [
  'radio', 'television', 'tv set', 'phone speaker', 'loudspeaker',
  'jukebox', 'record player', 'someone sings', 'she sings', 'he sings',
] as const
```

- [ ] **Step 4: Zaimplementuj reguły**

`shared/src/validate/rules/audio.ts`:

```ts
import type { Project } from '../../model/types.js'
import { DIEGETIC_SOURCES, MOOD_WORDS } from '../../vocab/moodWords.js'
import { defineRule, makeDiagnostic, type Diagnostic, type Rule } from '../types.js'

export function countSentences(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/[.!?]+(?:\s+|$)/).filter(part => part.trim().length > 0).length
}

const isNA = (text: string): boolean => text.trim() === 'N/A'

const allDialogueTexts = (project: Project): string[] =>
  project.shots.flatMap(shot => shot.dialogue.map(d => d.text))

const soundscapeSentences = defineRule({
  id: 'SOUNDSCAPE_SENTENCES',
  severity: 'error',
  guideRef: 'guide_base §4.6',
  run: ({ project }) => {
    const text = project.audio.overallSoundscape
    if (isNA(text)) return []
    const count = countSentences(text)
    if (count >= 1 && count <= 4) return []
    return [makeDiagnostic(
      soundscapeSentences,
      { kind: 'audio', id: 'overallSoundscape' },
      `overall_soundscape ma ${count} zdań — guide wymaga od 1 do 4.`,
      `overall_soundscape has ${count} sentences — the guide requires 1 to 4.`,
    )]
  },
})

const musicSentences = defineRule({
  id: 'MUSIC_SENTENCES',
  severity: 'error',
  guideRef: 'guide_base §4.7',
  run: ({ project }) => {
    const text = project.audio.nonDiegeticMusic
    if (isNA(text)) return []
    const count = countSentences(text)
    if (count >= 1 && count <= 3) return []
    return [makeDiagnostic(
      musicSentences,
      { kind: 'audio', id: 'nonDiegeticMusic' },
      `non_diegetic_music ma ${count} zdań — guide wymaga od 1 do 3.`,
      `non_diegetic_music has ${count} sentences — the guide requires 1 to 3.`,
    )]
  },
})

const soundscapeNoDialogue = defineRule({
  id: 'SOUNDSCAPE_NO_DIALOGUE',
  severity: 'error',
  guideRef: 'guide_base §4.6',
  run: ({ project }) => {
    const text = project.audio.overallSoundscape
    const out: Diagnostic[] = []
    if (text.includes('<d>')) {
      out.push(makeDiagnostic(
        soundscapeNoDialogue,
        { kind: 'audio', id: 'overallSoundscape' },
        'overall_soundscape nie może zawierać bloków dialogowych.',
        'overall_soundscape must not contain dialogue blocks.',
      ))
    }
    for (const line of allDialogueTexts(project)) {
      if (line.length > 3 && text.includes(line)) {
        out.push(makeDiagnostic(
          soundscapeNoDialogue,
          { kind: 'audio', id: 'overallSoundscape' },
          'Treść kwestii dialogowej powtórzona w overall_soundscape.',
          'Dialogue content is repeated in overall_soundscape.',
        ))
      }
    }
    return out
  },
})

const soundscapeNaOnlyIfSilent = defineRule({
  id: 'SOUNDSCAPE_NA_ONLY_IF_SILENT',
  severity: 'warning',
  guideRef: 'guide_base §4.6',
  run: ({ project }) => {
    if (!isNA(project.audio.overallSoundscape)) return []
    const hasSound = project.shots.some(s => s.dialogue.length > 0 || s.diegeticSfx.length > 0)
    if (!hasSound) return []
    return [makeDiagnostic(
      soundscapeNaOnlyIfSilent,
      { kind: 'audio', id: 'overallSoundscape' },
      'N/A w overall_soundscape jest dopuszczalne tylko przy wyraźnie żądanej pełnej ciszy.',
      'N/A in overall_soundscape is allowed only when complete silence is explicitly requested.',
    )]
  },
})

const musicNoMoodWords = defineRule({
  id: 'MUSIC_NO_MOOD_WORDS',
  severity: 'warning',
  guideRef: 'guide_base §4.7',
  run: ({ project }) => {
    const lower = project.audio.nonDiegeticMusic.toLowerCase()
    return MOOD_WORDS
      .filter(word => new RegExp(`\\b${word}\\b`).test(lower))
      .map(word => makeDiagnostic(
        musicNoMoodWords,
        { kind: 'audio', id: 'nonDiegeticMusic' },
        `Słowo "${word}" nazywa nastrój — guide wymaga instrumentacji, tempa, rytmu i dynamiki.`,
        `The word "${word}" names a mood — the guide requires instrumentation, tempo, rhythm and dynamics.`,
      ))
  },
})

const diegeticInDescription = defineRule({
  id: 'DIEGETIC_IN_DESCRIPTION',
  severity: 'warning',
  guideRef: 'guide_base §4.7',
  run: ({ project }) => {
    const lower = project.audio.nonDiegeticMusic.toLowerCase()
    return DIEGETIC_SOURCES
      .filter(source => lower.includes(source))
      .map(source => makeDiagnostic(
        diegeticInDescription,
        { kind: 'audio', id: 'nonDiegeticMusic' },
        `Źródło "${source}" jest słyszalne dla postaci — należy do opisu ujęcia, nie do non_diegetic_music.`,
        `The source "${source}" is audible to the characters — it belongs in the shot description, not non_diegetic_music.`,
      ))
  },
})

export const audioRules: Rule[] = [
  soundscapeSentences, musicSentences, soundscapeNoDialogue,
  soundscapeNaOnlyIfSilent, musicNoMoodWords, diegeticInDescription,
]
```

- [ ] **Step 5: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test -- audio`
Expected: PASS, 10 testów

- [ ] **Step 6: Commit**

```bash
cd ~/mmh3-studio
git add shared/src/vocab/moodWords.ts shared/src/validate/rules/audio.ts shared/test/validate/rules/audio.test.ts
git commit -m "feat: reguly walidatora dla soundscape i muzyki niediegetycznej"
```

---

### Task 16: Reguły trybu REF i kotwic klatek

**Files:**
- Create: `shared/src/validate/rules/ref.ts`
- Create: `shared/src/validate/rules/anchors.ts`
- Test: `shared/test/validate/rules/refAnchors.test.ts`

**Interfaces:**
- Consumes: `REF_TASK_TYPES`, `VISUAL_MARKERS`, `AUDIO_MARKERS`, `renderDetailedDescription`
- Produces: `refRules: Rule[]`, `anchorRules: Rule[]`

Uwaga: przykład z `guide_ref` §7 ma około 265 słów w `detailed_description`, czyli mniej niż zalecane 350–500. Reguła `REF_WORD_COUNT` ma poziom **ostrzeżenia**, a test złotego fixture'u oczekuje dokładnie tego jednego ostrzeżenia. To zamierzone — dokumentacja sama nie trzyma się własnego zalecenia, a my nie zmieniamy przykładu.

- [ ] **Step 1: Napisz testy**

`shared/test/validate/rules/refAnchors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { refRules } from '../../../src/validate/rules/ref.js'
import { anchorRules } from '../../../src/validate/rules/anchors.js'
import { validateWith } from '../../../src/validate/validate.js'
import { compile } from '../../../src/compile/compile.js'
import { refProject } from '../../golden/fixtures/ref.js'
import { t2vaProject, i2vaProject, fl2vaProject, l2vaProject } from '../../golden/fixtures/base.js'
import type { Project } from '../../../src/model/types.js'

const runRef = (p: Project) => validateWith(refRules, p, compile(p)).map(d => d.ruleId)
const runAnchors = (p: Project) => validateWith(anchorRules, p, compile(p)).map(d => d.ruleId)

describe('reguły trybu REF', () => {
  it('złoty przykład zgłasza wyłącznie ostrzeżenie o liczbie słów', () => {
    expect(runRef(refProject)).toEqual(['REF_WORD_COUNT'])
  })

  it('REF_RETENTION_COMPLETE — brak wpisu dla etykiety', () => {
    const retention = refProject.ref.retention.slice(0, 4)
    expect(runRef({ ...refProject, ref: { ...refProject.ref, retention } }))
      .toContain('REF_RETENTION_COMPLETE')
  })

  it('REF_MARKER_VOCAB — marker wizualny przy etykiecie audio', () => {
    const retention = refProject.ref.retention.map(r =>
      r.labelId === 'aud1' ? { ...r, marker: 'fully_preserved' as const } : r)
    expect(runRef({ ...refProject, ref: { ...refProject.ref, retention } }))
      .toContain('REF_MARKER_VOCAB')
  })

  it('REF_NO_SPEAKER_IN_RETENTION — identyfikator mówcy w retention_analysis', () => {
    const retention = refProject.ref.retention.map(r =>
      r.id === 'r5' ? { ...r, note: 'the voice of <Subject 3> (S1) is referenced.' } : r)
    expect(runRef({ ...refProject, ref: { ...refProject.ref, retention } }))
      .toContain('REF_NO_SPEAKER_IN_RETENTION')
  })

  it('REF_TASK_TYPES — powtórzony typ zadania', () => {
    const taskTypes = ['reference generation', 'reference generation'] as const
    expect(runRef({ ...refProject, ref: { ...refProject.ref, taskTypes: [...taskTypes] } }))
      .toContain('REF_TASK_TYPES')
  })

  it('REF_TASK_TYPES — pusta lista typów', () => {
    expect(runRef({ ...refProject, ref: { ...refProject.ref, taskTypes: [] } }))
      .toContain('REF_TASK_TYPES')
  })

  it('REF_ASSET_LIMITS — więcej niż dziewięć obrazów', () => {
    const assets = Array.from({ length: 10 }, (_, i) => ({
      id: `a${i}`, kind: 'image' as const, path: `/tmp/a${i}.png`, fileName: `a${i}.png`,
    }))
    expect(runRef({ ...refProject, assets })).toContain('REF_ASSET_LIMITS')
  })

  it('REF_STYLE_BEFORE_SHOT1 — brak zdania o stylu', () => {
    expect(runRef({ ...refProject, style: '' })).toContain('REF_STYLE_BEFORE_SHOT1')
  })

  it('REF_NO_NEW_LABELS_IN_SUMMARY — etykieta niezdefiniowana', () => {
    const summaryText = `${refProject.ref.summaryText} It also uses <Subject 9>.`
    expect(runRef({ ...refProject, ref: { ...refProject.ref, summaryText } }))
      .toContain('REF_NO_NEW_LABELS_IN_SUMMARY')
  })

  it('REF_LABEL_USED — etykieta zdefiniowana, ale nigdzie nieużyta', () => {
    const labels = [...refProject.labels, {
      id: 'vid9', kind: 'video' as const, index: 9, assetIds: [], standalone: true,
      role: '', definition: 'is an unused source video.',
    }]
    const retention = [...refProject.ref.retention, {
      id: 'r9', labelId: 'vid9', scope: '', marker: 'weak_reference' as const, note: 'nieużyte.',
    }]
    expect(runRef({ ...refProject, labels, ref: { ...refProject.ref, retention } }))
      .toContain('REF_LABEL_USED')
  })

  it('reguły REF milczą w trybach bazowych', () => {
    expect(runRef(t2vaProject)).toEqual([])
  })
})

describe('reguły kotwic', () => {
  it('nie zgłaszają nic dla poprawnych projektów złotych', () => {
    expect(runAnchors(t2vaProject)).toEqual([])
    expect(runAnchors(i2vaProject)).toEqual([])
    expect(runAnchors(fl2vaProject)).toEqual([])
    expect(runAnchors(l2vaProject)).toEqual([])
  })

  it('ANCHOR_REQUIRED — I2VA bez etykiety obrazu', () => {
    expect(runAnchors({ ...i2vaProject, labels: [] })).toContain('ANCHOR_REQUIRED')
  })

  it('ANCHOR_REQUIRED — FL2VA z jednym obrazem', () => {
    expect(runAnchors({ ...fl2vaProject, labels: [fl2vaProject.labels[0]!] }))
      .toContain('ANCHOR_REQUIRED')
  })

  it('FL2VA_PREFER_SINGLE_SHOT — dwa ujęcia', () => {
    const shots = [
      fl2vaProject.shots[0]!,
      { ...fl2vaProject.shots[0]!, id: 's2', index: 1, startMs: 4000, body: [{ kind: 'text' as const, text: 'more.' }], cameraMoves: [] },
    ]
    expect(runAnchors({ ...fl2vaProject, shots })).toContain('FL2VA_PREFER_SINGLE_SHOT')
  })

  it('L2VA_ANCHOR_LAST_SHOT — kotwica nie w ostatnim ujęciu', () => {
    const shots = [
      l2vaProject.shots[0]!,
      { ...l2vaProject.shots[0]!, id: 's2', index: 1, startMs: 3000, anchor: 'none' as const, body: [{ kind: 'text' as const, text: 'more.' }], cameraMoves: [] },
    ]
    expect(runAnchors({ ...l2vaProject, shots })).toContain('L2VA_ANCHOR_LAST_SHOT')
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test -- refAnchors`
Expected: FAIL — brak modułów

- [ ] **Step 3: Zaimplementuj reguły REF**

`shared/src/validate/rules/ref.ts`:

```ts
import type { Project } from '../../model/types.js'
import { AUDIO_MARKERS, REF_TASK_TYPES, VISUAL_MARKERS } from '../../vocab/refVocab.js'
import { renderDetailedDescription, renderSummary } from '../../compile/emitRef.js'
import { labelText } from '../../compile/renderLabel.js'
import { defineRule, makeDiagnostic, type Diagnostic, type Rule } from '../types.js'

const MIN_WORDS = 350
const MAX_WORDS = 500
const LABEL_PATTERN = /<(Subject|Picture|Video|Audio) (\d+)>/g

const isRef = (project: Project): boolean => project.mode === 'REF'

const definedLabelTexts = (project: Project): Set<string> =>
  new Set(project.labels.map(l => labelText(l, true)))

const refLabelDefined = defineRule({
  id: 'REF_LABEL_DEFINED',
  severity: 'error',
  guideRef: 'guide_ref §2',
  run: ({ project }) => {
    if (!isRef(project)) return []
    const out: Diagnostic[] = []
    for (const shot of project.shots) {
      for (const seg of shot.body) {
        if (seg.kind !== 'label') continue
        if (project.labels.some(l => l.id === seg.labelId)) continue
        out.push(makeDiagnostic(
          refLabelDefined,
          { kind: 'shot', id: shot.id },
          `Ujęcie ${shot.index + 1} używa etykiety bez definicji: ${seg.labelId}.`,
          `Shot ${shot.index + 1} uses an undefined label: ${seg.labelId}.`,
        ))
      }
    }
    return out
  },
})

const refLabelUsed = defineRule({
  id: 'REF_LABEL_USED',
  severity: 'warning',
  guideRef: 'guide_ref §2',
  run: ({ project }) => {
    if (!isRef(project)) return []
    const haystack = `${renderSummary(project)}\n${renderDetailedDescription(project)}`
    return project.labels
      .filter(l => l.standalone && !haystack.includes(labelText(l, true)))
      .map(l => makeDiagnostic(
        refLabelUsed,
        { kind: 'label', id: l.id },
        `Etykieta ${labelText(l, true)} jest zdefiniowana, ale nie występuje w summary ani w opisie.`,
        `Label ${labelText(l, true)} is defined but appears in neither the summary nor the description.`,
      ))
  },
})

const refRetentionComplete = defineRule({
  id: 'REF_RETENTION_COMPLETE',
  severity: 'error',
  guideRef: 'guide_ref §4',
  run: ({ project }) => {
    if (!isRef(project)) return []
    const covered = new Set(project.ref.retention.map(r => r.labelId))
    return project.labels
      .filter(l => l.standalone && !covered.has(l.id))
      .map(l => makeDiagnostic(
        refRetentionComplete,
        { kind: 'label', id: l.id },
        `Brak wpisu w retention_analysis dla ${labelText(l, true)}.`,
        `Missing retention_analysis entry for ${labelText(l, true)}.`,
      ))
  },
})

const refMarkerVocab = defineRule({
  id: 'REF_MARKER_VOCAB',
  severity: 'error',
  guideRef: 'guide_ref §4.1, §4.2',
  run: ({ project }) => {
    if (!isRef(project)) return []
    return project.ref.retention.flatMap(entry => {
      const label = project.labels.find(l => l.id === entry.labelId)
      if (!label) return []
      const allowed: readonly string[] = label.kind === 'audio' ? AUDIO_MARKERS : VISUAL_MARKERS
      if (allowed.includes(entry.marker)) return []
      return [makeDiagnostic(
        refMarkerVocab,
        { kind: 'retention', id: entry.id },
        `Marker "${entry.marker}" nie jest dozwolony dla etykiety ${labelText(label, true)}.`,
        `Marker "${entry.marker}" is not allowed for label ${labelText(label, true)}.`,
      )]
    })
  },
})

const refNoSpeakerInRetention = defineRule({
  id: 'REF_NO_SPEAKER_IN_RETENTION',
  severity: 'error',
  guideRef: 'guide_ref §5.4',
  run: ({ project }) => {
    if (!isRef(project)) return []
    return project.ref.retention
      .filter(entry => /\(S\d+(,S\d+)*\)/.test(`${entry.scope} ${entry.note}`))
      .map(entry => makeDiagnostic(
        refNoSpeakerInRetention,
        { kind: 'retention', id: entry.id },
        'Identyfikatory mówców nie mogą występować w retention_analysis.',
        'Speaker IDs must not appear in retention_analysis.',
      ))
  },
})

const refTaskTypes = defineRule({
  id: 'REF_TASK_TYPES',
  severity: 'error',
  guideRef: 'guide_ref §3',
  run: ({ project }) => {
    if (!isRef(project)) return []
    const types = project.ref.taskTypes
    const out: Diagnostic[] = []
    if (types.length === 0) {
      out.push(makeDiagnostic(
        refTaskTypes, { kind: 'project', id: project.id },
        'summary musi zaczynać się od co najmniej jednego typu zadania.',
        'The summary must begin with at least one task type.',
      ))
    }
    if (new Set(types).size !== types.length) {
      out.push(makeDiagnostic(
        refTaskTypes, { kind: 'project', id: project.id },
        'Typy zadania nie mogą się powtarzać.',
        'Task types must not repeat.',
      ))
    }
    for (const type of types) {
      if (!REF_TASK_TYPES.includes(type)) {
        out.push(makeDiagnostic(
          refTaskTypes, { kind: 'project', id: project.id },
          `Nieznany typ zadania: ${type}.`,
          `Unknown task type: ${type}.`,
        ))
      }
    }
    return out
  },
})

const refAssetLimits = defineRule({
  id: 'REF_ASSET_LIMITS',
  severity: 'error',
  guideRef: 'karta modelu — Ref2VA: 9 obrazów, 3 wideo, 3 audio',
  run: ({ project }) => {
    if (!isRef(project)) return []
    const limits: Array<[Project['assets'][number]['kind'], number]> =
      [['image', 9], ['video', 3], ['audio', 3]]
    return limits.flatMap(([kind, max]) => {
      const count = project.assets.filter(a => a.kind === kind).length
      if (count <= max) return []
      return [makeDiagnostic(
        refAssetLimits, { kind: 'project', id: project.id },
        `Tryb Ref2VA dopuszcza najwyżej ${max} assetów typu ${kind}, a jest ich ${count}.`,
        `Ref2VA allows at most ${max} ${kind} assets, but there are ${count}.`,
      )]
    })
  },
})

const refWordCount = defineRule({
  id: 'REF_WORD_COUNT',
  severity: 'warning',
  guideRef: 'guide_ref §5.2',
  run: ({ project }) => {
    if (!isRef(project)) return []
    const words = renderDetailedDescription(project).trim().split(/\s+/).filter(Boolean).length
    if (words >= MIN_WORDS && words <= MAX_WORDS) return []
    return [makeDiagnostic(
      refWordCount, { kind: 'project', id: project.id },
      `detailed_description ma ${words} słów — zalecany zakres to ${MIN_WORDS}–${MAX_WORDS}.`,
      `detailed_description has ${words} words — the recommended range is ${MIN_WORDS}–${MAX_WORDS}.`,
    )]
  },
})

const refStyleBeforeShot1 = defineRule({
  id: 'REF_STYLE_BEFORE_SHOT1',
  severity: 'error',
  guideRef: 'guide_ref §5.2',
  run: ({ project }) => {
    if (!isRef(project) || project.style.trim()) return []
    return [makeDiagnostic(
      refStyleBeforeShot1, { kind: 'project', id: project.id },
      'Tryb REF wymaga zdania o stylu przed [Shot 1].',
      'REF mode requires a style statement before [Shot 1].',
    )]
  },
})

const refNoNewLabelsInSummary = defineRule({
  id: 'REF_NO_NEW_LABELS_IN_SUMMARY',
  severity: 'error',
  guideRef: 'guide_ref §3',
  run: ({ project }) => {
    if (!isRef(project)) return []
    const defined = definedLabelTexts(project)
    const found = project.ref.summaryText.match(LABEL_PATTERN) ?? []
    return [...new Set(found)]
      .filter(token => !defined.has(token))
      .map(token => makeDiagnostic(
        refNoNewLabelsInSummary, { kind: 'project', id: project.id },
        `summary wprowadza etykietę spoza subject_definitions: ${token}.`,
        `The summary introduces a label absent from subject_definitions: ${token}.`,
      ))
  },
})

export const refRules: Rule[] = [
  refLabelDefined, refLabelUsed, refRetentionComplete, refMarkerVocab,
  refNoSpeakerInRetention, refTaskTypes, refAssetLimits, refWordCount,
  refStyleBeforeShot1, refNoNewLabelsInSummary,
]
```

- [ ] **Step 4: Zaimplementuj reguły kotwic**

`shared/src/validate/rules/anchors.ts`:

```ts
import type { Mode, Project } from '../../model/types.js'
import { defineRule, makeDiagnostic, type Diagnostic, type Rule } from '../types.js'

const REQUIRED_PICTURES: Partial<Record<Mode, number>> = {
  I2VA: 1,
  FL2VA: 2,
  L2VA: 1,
}

const pictureCount = (project: Project): number =>
  project.labels.filter(l => l.kind === 'picture').length

const anchorRequired = defineRule({
  id: 'ANCHOR_REQUIRED',
  severity: 'error',
  guideRef: 'guide_base §2.1, §3',
  run: ({ project }) => {
    const required = REQUIRED_PICTURES[project.mode]
    const out: Diagnostic[] = []

    if (required === undefined) {
      if (project.mode === 'T2VA' && pictureCount(project) > 0) {
        out.push(makeDiagnostic(
          anchorRequired, { kind: 'project', id: project.id },
          'Tryb T2VA nie korzysta z obrazów referencyjnych.',
          'T2VA mode does not use reference images.',
        ))
      }
      return out
    }

    if (pictureCount(project) !== required) {
      out.push(makeDiagnostic(
        anchorRequired, { kind: 'project', id: project.id },
        `Tryb ${project.mode} wymaga dokładnie ${required} obrazów referencyjnych, a jest ich ${pictureCount(project)}.`,
        `Mode ${project.mode} requires exactly ${required} reference image(s), but there are ${pictureCount(project)}.`,
      ))
    }

    if (!project.shots.some(s => s.anchor !== 'none')) {
      out.push(makeDiagnostic(
        anchorRequired, { kind: 'project', id: project.id },
        `Tryb ${project.mode} wymaga wskazania ujęcia zakotwiczonego na klatce referencyjnej.`,
        `Mode ${project.mode} requires a shot anchored to a reference frame.`,
      ))
    }

    return out
  },
})

const fl2vaPreferSingleShot = defineRule({
  id: 'FL2VA_PREFER_SINGLE_SHOT',
  severity: 'warning',
  guideRef: 'guide_base §3.2',
  run: ({ project }) => {
    if (project.mode !== 'FL2VA' || project.shots.length <= 1) return []
    return [makeDiagnostic(
      fl2vaPreferSingleShot, { kind: 'project', id: project.id },
      'FL2VA preferuje pojedyncze ujęcie, żeby model mógł interpolować od pierwszej do ostatniej klatki.',
      'FL2VA prefers a single shot so the model can interpolate from the first to the last frame.',
    )]
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
    const anchored = shots.filter(s => s.anchor === 'picture-last')
    if (anchored.length === 1 && anchored[0]!.id === last.id) return []
    return [makeDiagnostic(
      l2vaAnchorLastShot, { kind: 'project', id: project.id },
      'W trybie L2VA klatka referencyjna należy do ostatniego ujęcia.',
      'In L2VA mode the reference frame belongs to the last shot.',
    )]
  },
})

export const anchorRules: Rule[] = [
  anchorRequired, fl2vaPreferSingleShot, l2vaAnchorLastShot,
]
```

- [ ] **Step 5: Uruchom testy**

Run: `cd ~/mmh3-studio && npm test -- refAnchors`
Expected: PASS, 16 testów

- [ ] **Step 6: Commit**

```bash
cd ~/mmh3-studio
git add shared/src/validate/rules/ref.ts shared/src/validate/rules/anchors.ts shared/test/validate/rules/refAnchors.test.ts
git commit -m "feat: reguly walidatora dla trybu referencyjnego i kotwic klatek"
```

---

### Task 17: Publiczne API pakietu i narzędzie wiersza poleceń

**Files:**
- Create: `shared/src/validate/rules/index.ts`
- Create: `shared/src/api.ts`
- Create: `shared/src/cli.ts`
- Modify: `shared/src/index.ts`
- Modify: `shared/package.json` (skrypt `mmh3c`)
- Test: `shared/test/api.test.ts`

**Interfaces:**
- Consumes: wszystko powyżej
- Produces:
  - `registerAllRules(): void` — idempotentne
  - `buildPrompt(project: Project): { text: string; tokens: Token[]; diagnostics: Diagnostic[] }`
  - `isExportReady(diagnostics: Diagnostic[]): boolean`
  - CLI: `npm run mmh3c --workspace @mmh3/shared -- <ścieżka/project.json>`

- [ ] **Step 1: Napisz testy**

`shared/test/api.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildPrompt, isExportReady, registerAllRules } from '../src/api.js'
import { t2vaProject, l2vaProject } from './golden/fixtures/base.js'
import { refProject } from './golden/fixtures/ref.js'

describe('buildPrompt', () => {
  it('rejestracja reguł jest idempotentna', () => {
    expect(() => { registerAllRules(); registerAllRules() }).not.toThrow()
  })

  it('zwraca tekst, tokeny i diagnostykę', () => {
    const result = buildPrompt(t2vaProject)
    expect(result.text).toContain('integrated_multimodal_description:')
    expect(result.tokens.length).toBeGreaterThan(0)
    expect(result.diagnostics).toEqual([])
  })

  it('uznaje projekt bez błędów za gotowy do eksportu', () => {
    expect(isExportReady(buildPrompt(t2vaProject).diagnostics)).toBe(true)
    expect(isExportReady(buildPrompt(l2vaProject).diagnostics)).toBe(true)
  })

  it('ostrzeżenie nie blokuje eksportu', () => {
    const result = buildPrompt(refProject)
    expect(result.diagnostics.map(d => d.ruleId)).toEqual(['REF_WORD_COUNT'])
    expect(isExportReady(result.diagnostics)).toBe(true)
  })

  it('błąd blokuje eksport', () => {
    const broken = { ...t2vaProject, video: { ...t2vaProject.video, durationMs: 1000 } }
    const result = buildPrompt(broken)
    expect(result.diagnostics.some(d => d.severity === 'error')).toBe(true)
    expect(isExportReady(result.diagnostics)).toBe(false)
  })
})
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `cd ~/mmh3-studio && npm test -- api`
Expected: FAIL — brak modułu `src/api.js`

- [ ] **Step 3: Zaimplementuj rejestrację reguł i API**

`shared/src/validate/rules/index.ts`:

```ts
import { registerRules } from '../registry.js'
import { timeRules } from './time.js'
import { cameraRules } from './camera.js'
import { speechRules } from './speech.js'
import { audioRules } from './audio.js'
import { refRules } from './ref.js'
import { anchorRules } from './anchors.js'

let registered = false

/** Rejestruje wszystkie rodziny reguł. Wielokrotne wywołanie nic nie zmienia. */
export function registerAllRules(): void {
  if (registered) return
  registerRules([
    ...timeRules, ...cameraRules, ...speechRules,
    ...audioRules, ...refRules, ...anchorRules,
  ])
  registered = true
}
```

`shared/src/api.ts`:

```ts
import type { Project } from './model/types.js'
import type { Token } from './model/refs.js'
import { compile } from './compile/compile.js'
import { validate } from './validate/validate.js'
import { registerAllRules } from './validate/rules/index.js'
import type { Diagnostic } from './validate/types.js'

export { registerAllRules }

export interface PromptResult {
  text: string
  tokens: Token[]
  diagnostics: Diagnostic[]
}

/** Jedyne wejście dla aplikacji: kompiluje projekt i uruchamia pełny zestaw reguł. */
export function buildPrompt(project: Project): PromptResult {
  registerAllRules()
  const compiled = compile(project)
  return { ...compiled, diagnostics: validate(project, compiled) }
}

/** Ostrzeżenia i wskazówki nie blokują eksportu — blokują tylko błędy. */
export function isExportReady(diagnostics: Diagnostic[]): boolean {
  return !diagnostics.some(d => d.severity === 'error')
}
```

- [ ] **Step 4: Zaimplementuj CLI**

`shared/src/cli.ts`:

```ts
import { readFileSync } from 'node:fs'
import { parseProject } from './model/schema.js'
import { buildPrompt, isExportReady } from './api.js'

const path = process.argv[2]
if (!path) {
  console.error('Użycie: mmh3c <ścieżka/project.json>')
  process.exit(2)
}

const project = parseProject(JSON.parse(readFileSync(path, 'utf8')))
const { text, diagnostics } = buildPrompt(project)

console.log(text)

if (diagnostics.length > 0) {
  console.error('')
  console.error(`Diagnostyka (${diagnostics.length}):`)
  for (const d of diagnostics) {
    console.error(`  [${d.severity}] ${d.ruleId} (${d.ref.kind}:${d.ref.id}) — ${d.message}`)
    console.error(`      źródło: ${d.guideRef}`)
  }
}

process.exit(isExportReady(diagnostics) ? 0 : 1)
```

Dodaj skrypt w `shared/package.json`:

```json
"mmh3c": "tsx src/cli.ts"
```

- [ ] **Step 5: Wyeksportuj publiczne API**

`shared/src/index.ts`:

```ts
export const VERSION = '0.1.0'

export * from './model/types.js'
export * from './model/refs.js'
export * from './model/schema.js'
export * from './time/frames.js'
export * from './time/format.js'
export * from './vocab/camera.js'
export * from './vocab/continuity.js'
export * from './vocab/refVocab.js'
export * from './vocab/moodWords.js'
export * from './compile/compile.js'
export * from './validate/types.js'
export * from './api.js'
```

- [ ] **Step 6: Uruchom pełny zestaw testów i sprawdzenie typów**

Run: `cd ~/mmh3-studio && npm test && npm run typecheck`
Expected: PASS — wszystkie testy zielone, brak błędów typów

- [ ] **Step 7: Sprawdź CLI na prawdziwym pliku**

Run:

```bash
cd ~/mmh3-studio
node --import tsx -e "
import { writeFileSync } from 'node:fs'
import { t2vaProject } from './shared/test/golden/fixtures/base.ts'
writeFileSync('/tmp/t2va.json', JSON.stringify(t2vaProject, null, 2))
"
npm run mmh3c --workspace @mmh3/shared -- /tmp/t2va.json
echo "kod wyjścia: $?"
```

Expected: wypisany prompt Case 1 i kod wyjścia 0

- [ ] **Step 8: Commit**

```bash
cd ~/mmh3-studio
git add shared/src/api.ts shared/src/cli.ts shared/src/index.ts shared/src/validate/rules/index.ts shared/package.json shared/test/api.test.ts
git commit -m "feat: publiczne API pakietu shared i narzedzie wiersza polecen mmh3c"
```

---

## Definicja ukończenia

- `npm test` — wszystkie testy zielone, w tym pięć testów złotych odtwarzających dokumentację znak w znak
- `npm run typecheck` — brak błędów
- `npm run mmh3c --workspace @mmh3/shared -- /tmp/t2va.json` wypisuje prompt i kończy się kodem 0
- 40 reguł walidatora zarejestrowanych, każda z testem naruszenia. Wyjątkiem jest wymieniona w specyfikacji reguła `ALIGNMENT_DECIMALS` — nie powstaje jako reguła, bo format `S.SS` jest gwarantowany konstrukcyjnie przez `formatAlignSeconds` i pokryty testem w zadaniu 3. Nie da się zbudować projektu, który by ją naruszył.
- Pakiet `shared/` nie importuje Reacta ani `node:*` poza `cli.ts`

Po zamknięciu tego planu powstaje **Plan 2 (aplikacja)** i **Plan 3 (LLM)**, których zadania opierają się na `buildPrompt`, `Token`, `Diagnostic` i typach domeny ustalonych tutaj.
