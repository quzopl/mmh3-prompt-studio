# Okno dialogowe LLM przy polu — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rozmowa zawężona do jednego pola projektu — użytkownik pisze polecenie, model rozszerza pole i dodaje efekty, a doprecyzowania („mocniej", „mniej deszczu") pamiętają poprzednie tury.

**Architecture:** Nowe zadanie `fieldChat` obok siedmiu istniejących, zwracające `{ reply, english? }`. Prozę (`reply`) użytkownik czyta, a `english` staje się operacją przez **istniejącą** ścieżkę budowania operacji, więc strażnicy treści (liczba zdań pól audio, brak bloku `<d>`) obowiązują czat automatycznie. Historia mieszka w `chats.json` w katalogu projektu, obok `project.json` — bez ruszania `ProjectSchema` i bez migracji.

**Tech Stack:** TypeScript (strict), Zod, Fastify 5, React 18 + Zustand, Vitest, Playwright, npm workspaces (`shared/`, `server/`, `web/`).

## Global Constraints

- **Reguła wiążąca:** akcja interfejsu nie może wyprodukować diagnostyki walidatora na projekcie, który jej nie miał. Przyjęte wyjątki: `SPEECH_FITS`, `SOUNDSCAPE_NA_ONLY_IF_SILENT`, `SPEAKER_SILENT_NO_ID`, `FL2VA_PREFER_SINGLE_SHOT`, `MUSIC_NO_MOOD_WORDS`, `SOUNDSCAPE_NO_DIALOGUE`.
- **Model nigdy nie pisze do projektu bezpośrednio** — zwraca operacje, które użytkownik zaznacza w `PatchReview`; domyślnie nie jest zaznaczona żadna.
- **Prompty są po angielsku.** Polskie wejście tłumaczy model na końcowym etapie. Interfejs i komentarze w kodzie są po polsku; `README.md` po angielsku.
- **Domyślny język interfejsu to `en`** (`web/src/i18n/useT.ts`, `readInitialLang`). Testy webowe ustawiają `pl` w `web/test/setup.ts`.
- **Każdy nowy test musi paść po cofnięciu kodu, który sprawdza.** W tym projekcie trzy testy okazały się bezczynne (dwa puste zbiory reguł, regex bez jednej litery, brak rejestracji reguł poza `buildPrompt`). Weryfikacja odwrotna jest krokiem obowiązkowym, nie formalnością.
- **Reguły rejestrują się wyłącznie jako efekt uboczny `buildPrompt`.** Test używający `validate`/`compile` wprost dostaje dwa puste zbiory i nie potrafi paść.
- **Limity historii:** 20 ostatnich wiadomości na wątek, 256 KB na cały plik `chats.json`.
- **Zapis pliku przez plik tymczasowy i `rename`** — `writeFile` najpierw obcina plik.
- Komendy: `npm test` (cały monorepo), `npm test --workspace @mmh3/server -- <wzorzec>`, `npm run typecheck`, `npm run e2e` (w `web/`).

---

## Struktura plików

| Plik | Odpowiedzialność |
|---|---|
| `server/src/llm/tasks/fieldTarget.ts` **(nowy)** | Wskazanie pola projektu (`RedactTarget`), reguła treści dla tego pola (`fieldTextSchema`), odczyt bieżącej treści (`redactSourceText`) i budowa operacji (`fieldOp`). Wspólny fundament redakcji i czatu. |
| `server/src/llm/tasks/redact.ts` (modyfikacja) | Zostaje zadaniem redakcji PL→EN; przestaje być właścicielem powyższych czterech rzeczy. |
| `server/src/llm/chatStore.ts` **(nowy)** | `chats.json`: odczyt, dopisanie tury, przycinanie, limit bajtów, usuwanie sierot, czyszczenie wątku. |
| `server/src/llm/tasks/fieldChat.ts` **(nowy)** | Definicja zadania czatu: schemat odpowiedzi, prompt systemowy z rodzinami efektów, złożenie historii w wiadomości. |
| `server/src/routes/llm.ts` (modyfikacja) | Wariant `task: 'fieldChat'` w `RunBody` i gałąź `case` budująca wynik oraz zapisująca turę po sukcesie. |
| `server/src/routes/projects.ts` (modyfikacja) | `GET /api/projects/:slug/chats`, `DELETE /api/projects/:slug/chats/:key`. |
| `web/src/llm/chatApi.ts` **(nowy)** | Typy wątku po stronie web + `fetchChats`, `clearChat`. |
| `web/src/llm/FieldChat.tsx` **(nowy)** | Okno dialogowe: lista tur, pole wiadomości, wysyłka, czyszczenie, `PatchReview` dla tury z operacją. |
| `web/src/llm/LlmPanel.tsx` (modyfikacja) | Przycisk „Rozmawiaj o tym polu" zamiast „Redaguj"; otwiera `FieldChat`. |
| `web/src/i18n/dict.ts` (modyfikacja) | Klucze `llm.chat*` w `pl` i `en`. |

---

### Task 1: Wspólny fundament pola — `fieldTarget.ts`

Czysty refaktor bez zmiany zachowania. Wyciąga z `redact.ts` cztery rzeczy, których czat będzie potrzebował, żeby nie powstała druga droga do budowania operacji na polu.

**Files:**
- Create: `server/src/llm/tasks/fieldTarget.ts`
- Modify: `server/src/llm/tasks/redact.ts` (usunięcie przeniesionych definicji, import z nowego modułu)
- Modify: `server/src/routes/llm.ts:13` (instrukcja importu)
- Modify: `server/src/llm/tasks/translateAll.ts:10` (instrukcja importu)
- Modify: `server/test/llm/tasks/redact.test.ts:10` (instrukcja importu)
- Test: `server/test/llm/tasks/fieldTarget.test.ts`

**Interfaces:**
- Produces:
  - `RedactTargetSchema: z.ZodDiscriminatedUnion` oraz `type RedactTarget` (przeniesione bez zmian)
  - `fieldTextSchema(target: RedactTarget): z.ZodType<string>`
  - `redactSourceText(project: Project, target: RedactTarget): string | undefined` (przeniesione bez zmian)
  - `fieldOp(target: RedactTarget, text: string, label: string): PatchOp`

- [ ] **Step 1: Napisz test na `fieldOp` i `fieldTextSchema`**

Plik `server/test/llm/tasks/fieldTarget.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { fieldOp, fieldTextSchema } from '../../../src/llm/tasks/fieldTarget.js'

describe('fieldOp — operacja dla wskazanego pola', () => {
  it('etykieta jest parametrem, nie wpisana na stałe', () => {
    const op = fieldOp({ kind: 'style' }, 'Live-action', 'Etykieta z czatu.')
    expect(op.kind).toBe('setStyle')
    expect(op.label).toBe('Etykieta z czatu.')
    expect(op.kind === 'setStyle' && op.text).toBe('Live-action')
  })

  it('każdy z czterech celów daje operację swojego rodzaju', () => {
    expect(fieldOp({ kind: 'audio', field: 'nonDiegeticMusic' }, 'x', 'l').kind).toBe('setAudio')
    expect(fieldOp({ kind: 'speaker', speakerId: 's-1', field: 'shortDescriptor' }, 'x', 'l').kind)
      .toBe('setSpeakerDescriptor')
    expect(fieldOp({ kind: 'shotText', shotId: 'sh-1', segmentIndex: 0 }, 'x', 'l').kind)
      .toBe('setShotText')
  })

  it('identyfikatory operacji są różne dla dwóch wywołań', () => {
    const a = fieldOp({ kind: 'style' }, 'x', 'l')
    const b = fieldOp({ kind: 'style' }, 'x', 'l')
    expect(a.id).not.toBe(b.id)
  })
})

describe('fieldTextSchema — reguła treści zależna od pola', () => {
  it('pole audio dziedziczy limit zdań', () => {
    const schema = fieldTextSchema({ kind: 'audio', field: 'nonDiegeticMusic' })
    // MUSIC_SENTENCES dopuszcza 1–3 zdania.
    expect(schema.safeParse('One. Two. Three.').success).toBe(true)
    expect(schema.safeParse('One. Two. Three. Four.').success).toBe(false)
  })

  it('pole audio odrzuca blok dialogowy', () => {
    const schema = fieldTextSchema({ kind: 'audio', field: 'overallSoundscape' })
    expect(schema.safeParse('Rain falls. <d>[English] Hello.</d>').success).toBe(false)
  })

  it('pozostałe cele to zwykła proza bez limitu zdań', () => {
    const schema = fieldTextSchema({ kind: 'style' })
    expect(schema.safeParse('One. Two. Three. Four. Five.').success).toBe(true)
  })
})
```

- [ ] **Step 2: Uruchom test — ma paść**

Run: `npm test --workspace @mmh3/server -- fieldTarget`
Expected: FAIL, `Cannot find module '../../../src/llm/tasks/fieldTarget.js'`

- [ ] **Step 3: Utwórz `fieldTarget.ts`**

Przenieś z `redact.ts` **bez zmiany treści** (wraz z komentarzami, które je opisują): `RedactTargetSchema`, `RedactTarget`, `redactSourceText`. Następnie dołóż dwie nowe funkcje:

```ts
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PatchOp, Project } from '@mmh3/shared'
import { audioFieldTextSchema, MUSIC_TEXT_RULE, SOUNDSCAPE_TEXT_RULE } from './audioFieldText.js'

/**
 * Reguła „co wolno treści przeznaczonej na TO pole" — jedna definicja, którą
 * importuje KAŻDE zadanie zdolne zapisać pole projektu. Wcześniej mieszkała
 * wewnątrz `redactSchemaFor` w `redact.ts`, więc kolejne zadanie piszące do
 * tych samych pól (czat) musiałoby ją powtórzyć — dokładnie ta sytuacja, z
 * której powstał `audioFieldText.ts` (trzy zadania, to samo pole, trzy drogi).
 *
 * Zwraca schemat SAMEGO TEKSTU, nie obiektu odpowiedzi: każde zadanie
 * opakowuje go we własny kształt (`{ english }` w redakcji,
 * `{ reply, english? }` w czacie), a wspólna zostaje reguła treści.
 */
export function fieldTextSchema(target: RedactTarget): z.ZodType<string> {
  if (target.kind !== 'audio') return z.string()
  return audioFieldTextSchema(
    target.field === 'overallSoundscape' ? SOUNDSCAPE_TEXT_RULE : MUSIC_TEXT_RULE,
  )
}

/**
 * Operacja zapisująca `text` do pola wskazanego przez `target`. Etykieta jest
 * PARAMETREM, nie stałą: redakcja opisuje siebie jako tłumaczenie PL→EN, a
 * rozmowa jako zmianę z rozmowy — ta sama operacja, dwa różne uzasadnienia na
 * ekranie przeglądu.
 */
export function fieldOp(target: RedactTarget, text: string, label: string): PatchOp {
  const id = `op-${randomUUID()}`
  switch (target.kind) {
    case 'style':
      return { kind: 'setStyle', id, label, text }
    case 'audio':
      return { kind: 'setAudio', id, label, field: target.field, text }
    case 'speaker':
      return {
        kind: 'setSpeakerDescriptor', id, label,
        speakerId: target.speakerId, field: target.field, text,
      }
    case 'shotText':
      return {
        kind: 'setShotText', id, label,
        shotId: target.shotId, segmentIndex: target.segmentIndex, text,
      }
  }
}
```

- [ ] **Step 4: Przestaw `redact.ts` na nowy moduł**

W `redact.ts` usuń przeniesione definicje i dodaj import. `redactSchemaFor` korzysta teraz z `fieldTextSchema`, a `redactToPatch` z `fieldOp` — zachowując **dotychczasowe** etykiety:

```ts
import { fieldOp, fieldTextSchema, redactSourceText, type RedactTarget } from './fieldTarget.js'
export { RedactTargetSchema, redactSourceText, type RedactTarget } from './fieldTarget.js'

function redactSchemaFor(target: RedactTarget): z.ZodType<RedactResult> {
  return z.object({ english: fieldTextSchema(target) })
}

/** Etykiety BEZ ZMIAN wobec stanu sprzed refaktoru — pilnuje ich 38 asercji
 *  w `redact.test.ts`. Zwykły `switch` zamiast mapy po `kind`, bo tylko on
 *  zawęża `target` na tyle, żeby `target.field` się skompilowało. */
function redactLabel(target: RedactTarget): string {
  switch (target.kind) {
    case 'style': return 'Redakcja stylu wizualnego z polskiego na angielski.'
    case 'audio': return `Redakcja pola ${target.field} z polskiego na angielski.`
    case 'speaker': return `Redakcja opisu mówcy (${target.field}) z polskiego na angielski.`
    case 'shotText': return 'Redakcja treści ujęcia z polskiego na angielski.'
  }
}

export function redactToPatch(result: RedactResult, target: RedactTarget, project: Project): ProjectPatch {
  const text = result.english.trim()
  if (text === '') return { ops: [] }
  const current = redactSourceText(project, target)
  if (current === undefined) return { ops: [] }
  if (current.trim() === text) return { ops: [] }
  return { ops: [fieldOp(target, text, redactLabel(target))] }
}
```

Re-eksport w drugiej linii istnieje po to, żeby `routes/llm.ts`, `translateAll.ts` i `redact.test.ts` nie musiały zmieniać importów w tym zadaniu. Instrukcje importu przestaw mimo to na `fieldTarget.js` w trzech miejscach: `server/src/routes/llm.ts:13`, `server/src/llm/tasks/translateAll.ts:10`, `server/test/llm/tasks/redact.test.ts:10` — a po tym re-eksport **usuń**, żeby nie zostały dwa wejścia do tej samej definicji.

- [ ] **Step 5: Uruchom testy — mają przejść, w tym 38 istniejących asercji redakcji**

Run: `npm test --workspace @mmh3/server && npm run typecheck`
Expected: PASS, zero błędów typów. Etykiety operacji redakcji są **niezmienione** — to sprawdzają istniejące testy w `redact.test.ts`.

- [ ] **Step 6: Weryfikacja odwrotna**

Zamień w `fieldTextSchema` warunek `target.kind !== 'audio'` na `target.kind === 'audio'` i uruchom `npm test --workspace @mmh3/server -- fieldTarget`. Test limitu zdań musi paść. Cofnij zmianę.

- [ ] **Step 7: Commit**

```bash
git add server/src/llm/tasks/fieldTarget.ts server/src/llm/tasks/redact.ts \
        server/src/routes/llm.ts server/src/llm/tasks/translateAll.ts \
        server/test/llm/tasks/fieldTarget.test.ts server/test/llm/tasks/redact.test.ts
git commit -m "refactor: wspolny fundament pola dla redakcji i czatu"
```

---

### Task 2: Trwałe wątki rozmów — `chatStore.ts`

**Files:**
- Create: `server/src/llm/chatStore.ts`
- Modify: `server/src/storage/paths.ts` (dodanie `chatsFile`)
- Test: `server/test/llm/chatStore.test.ts`

**Interfaces:**
- Consumes: `RedactTarget`, `redactSourceText` z `fieldTarget.js` (Task 1)
- Produces:
  - `threadKey(target: RedactTarget): string`
  - `readChats(root: string, slug: string): Promise<ChatThread[]>`
  - `appendTurn(root, slug, project, target, userText, assistantText, english): Promise<void>`
  - `clearThread(root: string, slug: string, key: string): Promise<void>`
  - `interface ChatMessageRecord { role: 'user' | 'assistant'; text: string; english?: string }`
  - `interface ChatThread { key: string; target: RedactTarget; messages: ChatMessageRecord[] }`
  - `const MAX_MESSAGES = 20`, `const MAX_BYTES = 256 * 1024`

- [ ] **Step 1: Napisz testy**

Plik `server/test/llm/chatStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newProject } from '../../src/storage/newProject.js'
import { writeProject } from '../../src/storage/projectStore.js'
import {
  appendTurn, clearThread, readChats, threadKey, MAX_MESSAGES,
} from '../../src/llm/chatStore.js'

let root: string
const slug = 'projekt'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-chat-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const style = { kind: 'style' } as const

describe('chatStore', () => {
  it('klucz wątku wyprowadza się z celu, nie z losowego identyfikatora', () => {
    expect(threadKey(style)).toBe('style')
    expect(threadKey({ kind: 'audio', field: 'nonDiegeticMusic' })).toBe('audio:nonDiegeticMusic')
    expect(threadKey({ kind: 'shotText', shotId: 'sh-1', segmentIndex: 2 })).toBe('shot:sh-1:2')
    expect(threadKey({ kind: 'speaker', speakerId: 'sp-1', field: 'fullDescriptor' }))
      .toBe('speaker:sp-1:fullDescriptor')
  })

  it('zapisana tura wraca odczytem identyczna', async () => {
    const project = newProject('Projekt', 'T2VA')
    await writeProject(root, slug, project)
    await appendTurn(root, slug, project, style, 'dodaj deszcz', 'Dodałem deszcz.', 'Rain taps the roof.')

    const threads = await readChats(root, slug)
    expect(threads).toHaveLength(1)
    expect(threads[0]?.key).toBe('style')
    expect(threads[0]?.messages).toEqual([
      { role: 'user', text: 'dodaj deszcz' },
      { role: 'assistant', text: 'Dodałem deszcz.', english: 'Rain taps the roof.' },
    ])
  })

  it('brak pliku to pusta lista, nie wyjątek', async () => {
    await writeProject(root, slug, newProject('Projekt', 'T2VA'))
    expect(await readChats(root, slug)).toEqual([])
  })

  it('wątek trzyma najwyżej MAX_MESSAGES wiadomości i zachowuje najnowsze', async () => {
    const project = newProject('Projekt', 'T2VA')
    await writeProject(root, slug, project)
    for (let i = 0; i < MAX_MESSAGES; i += 1) {
      await appendTurn(root, slug, project, style, `pytanie ${i}`, `odpowiedź ${i}`, undefined)
    }
    const threads = await readChats(root, slug)
    const messages = threads[0]?.messages ?? []
    expect(messages).toHaveLength(MAX_MESSAGES)
    expect(messages[messages.length - 1]?.text).toBe(`odpowiedź ${MAX_MESSAGES - 1}`)
    expect(messages.some(m => m.text === 'pytanie 0')).toBe(false)
  })

  it('wątek celu, którego nie ma już w projekcie, znika przy zapisie', async () => {
    const project = newProject('Projekt', 'T2VA')
    await writeProject(root, slug, project)
    const orphan = { kind: 'speaker', speakerId: 'nie-istnieje', field: 'fullDescriptor' } as const
    await appendTurn(root, slug, project, orphan, 'a', 'b', undefined)
    expect(await readChats(root, slug)).toHaveLength(1)

    await appendTurn(root, slug, project, style, 'c', 'd', undefined)
    const keys = (await readChats(root, slug)).map(t => t.key)
    expect(keys).toEqual(['style'])
  })

  it('przekroczenie limitu bajtów usuwa całe najstarsze wątki, nie tnie pliku w połowie', async () => {
    const project = newProject('Projekt', 'T2VA')
    await writeProject(root, slug, project)
    const long = 'x'.repeat(20_000)
    for (let i = 0; i < 20; i += 1) {
      await appendTurn(root, slug, project, { kind: 'shotText', shotId: project.shots[0]!.id, segmentIndex: i },
        long, long, undefined)
    }
    const raw = await readFile(join(root, slug, 'chats.json'), 'utf8')
    expect(raw.length).toBeLessThanOrEqual(256 * 1024)
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  it('czyszczenie usuwa jeden wątek, resztę zostawia', async () => {
    const project = newProject('Projekt', 'T2VA')
    await writeProject(root, slug, project)
    await appendTurn(root, slug, project, style, 'a', 'b', undefined)
    await appendTurn(root, slug, project, { kind: 'audio', field: 'overallSoundscape' }, 'c', 'd', undefined)

    await clearThread(root, slug, 'style')
    expect((await readChats(root, slug)).map(t => t.key)).toEqual(['audio:overallSoundscape'])
  })
})
```

Uwaga do testu sierot: cel `shotText` w teście limitu bajtów używa **istniejącego** ujęcia z `newProject`, bo inaczej usuwanie sierot skasowałoby wątki, zanim limit bajtów zdąży zadziałać, i test mierzyłby coś innego, niż deklaruje.

- [ ] **Step 2: Uruchom testy — mają paść**

Run: `npm test --workspace @mmh3/server -- chatStore`
Expected: FAIL, `Cannot find module '../../src/llm/chatStore.js'`

- [ ] **Step 3: Dodaj ścieżkę pliku**

W `server/src/storage/paths.ts`, obok `projectFile`:

```ts
export const chatsFile = (root: string, slug: string): string =>
  join(projectDir(root, slug), 'chats.json')
```

- [ ] **Step 4: Napisz `chatStore.ts`**

```ts
import { readFile, rename, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Project } from '@mmh3/shared'
import { chatsFile } from '../storage/paths.js'
import { redactSourceText, RedactTargetSchema, type RedactTarget } from './tasks/fieldTarget.js'

/** Wiadomości na wątek. Starsze odpadają przy zapisie. */
export const MAX_MESSAGES = 20
/** Sufit całego pliku. Bez niego `chats.json` rośnie bez końca — nic go nie sprząta. */
export const MAX_BYTES = 256 * 1024

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  english: z.string().optional(),
})

const ThreadSchema = z.object({
  key: z.string().min(1),
  target: RedactTargetSchema,
  messages: z.array(MessageSchema),
})

const FileSchema = z.object({ version: z.literal(1), threads: z.array(ThreadSchema) })

export type ChatMessageRecord = z.infer<typeof MessageSchema>
export type ChatThread = z.infer<typeof ThreadSchema>

/**
 * Tożsamość wątku wyprowadzona z celu, nie losowa: jedno pole to jeden wątek,
 * więc ponowne otwarcie rozmowy o tym samym polu trafia w tę samą historię bez
 * żadnego rejestru identyfikatorów.
 */
export function threadKey(target: RedactTarget): string {
  switch (target.kind) {
    case 'style': return 'style'
    case 'audio': return `audio:${target.field}`
    case 'speaker': return `speaker:${target.speakerId}:${target.field}`
    case 'shotText': return `shot:${target.shotId}:${target.segmentIndex}`
  }
}

export async function readChats(root: string, slug: string): Promise<ChatThread[]> {
  let raw: string
  try {
    raw = await readFile(chatsFile(root, slug), 'utf8')
  } catch {
    // Brak pliku to normalny stan projektu, w którym nikt jeszcze nie rozmawiał.
    return []
  }
  const parsed = FileSchema.safeParse(JSON.parse(raw))
  // Plik uszkodzony albo z przyszłej wersji nie wywraca aplikacji — rozmowa jest
  // wygodą, nie danymi projektu, więc gorszym wyjściem byłoby zablokować edytor.
  return parsed.success ? parsed.data.threads : []
}

export async function appendTurn(
  root: string,
  slug: string,
  project: Project,
  target: RedactTarget,
  userText: string,
  assistantText: string,
  english: string | undefined,
): Promise<void> {
  const key = threadKey(target)
  const threads = await readChats(root, slug)
  const existing = threads.find(t => t.key === key)
  const assistant: ChatMessageRecord = english === undefined
    ? { role: 'assistant', text: assistantText }
    : { role: 'assistant', text: assistantText, english }
  const turn: ChatMessageRecord[] = [{ role: 'user', text: userText }, assistant]

  const updated: ChatThread[] = existing === undefined
    ? [...threads, { key, target, messages: turn }]
    : threads.map(t => (t.key === key ? { ...t, messages: [...t.messages, ...turn] } : t))

  await writeThreads(root, slug, project, updated)
}

export async function clearThread(root: string, slug: string, key: string): Promise<void> {
  const threads = await readChats(root, slug)
  await writeRaw(root, slug, threads.filter(t => t.key !== key))
}

async function writeThreads(
  root: string, slug: string, project: Project, threads: ChatThread[],
): Promise<void> {
  // Sieroty: ujęcie albo mówca mogli zniknąć z projektu, a ich wątek został.
  // `redactSourceText` zwraca `undefined` dokładnie dla celu, którego nie da
  // się już rozwiązać — ta sama funkcja, która decyduje, czy w ogóle jest co
  // redagować, więc nie ma dwóch definicji „cel istnieje".
  const alive = threads.filter(t => redactSourceText(project, t.target) !== undefined)
  const trimmed = alive.map(t => ({ ...t, messages: t.messages.slice(-MAX_MESSAGES) }))

  // Limit bajtów zdejmuje CAŁE najstarsze wątki (od początku tablicy, czyli od
  // najdawniej założonych), nie tnie tekstu w połowie — obcięty JSON nie dałby
  // się odczytać, a obcięta wiadomość kłamałaby o tym, co użytkownik napisał.
  let kept = trimmed
  while (kept.length > 1 && serialize(kept).length > MAX_BYTES) {
    kept = kept.slice(1)
  }
  await writeRaw(root, slug, kept)
}

async function writeRaw(root: string, slug: string, threads: ChatThread[]): Promise<void> {
  const target = chatsFile(root, slug)
  const temporary = `${target}.tmp`
  // Ten sam powód co w `projectStore.ts`: `writeFile` najpierw obcina plik,
  // więc przerwanie w trakcie zostawiłoby połowę. `rename` jest atomowe.
  await writeFile(temporary, serialize(threads), 'utf8')
  await rename(temporary, target)
}

const serialize = (threads: ChatThread[]): string =>
  `${JSON.stringify({ version: 1, threads }, null, 2)}\n`
```

- [ ] **Step 5: Uruchom testy — mają przejść**

Run: `npm test --workspace @mmh3/server -- chatStore`
Expected: PASS (7 testów)

- [ ] **Step 6: Weryfikacja odwrotna — trzy osobne cofnięcia**

1. Usuń `.slice(-MAX_MESSAGES)` → test przycinania musi paść.
2. Usuń filtr `alive` → test sierot musi paść.
3. Zmień `while` na `if` w limicie bajtów → test limitu musi paść.

Po każdym sprawdzeniu cofnij zmianę.

- [ ] **Step 7: Commit**

```bash
git add server/src/llm/chatStore.ts server/src/storage/paths.ts server/test/llm/chatStore.test.ts
git commit -m "feat: trwale watki rozmow w chats.json obok project.json"
```

---

### Task 3: Zadanie `fieldChat`

**Files:**
- Create: `server/src/llm/tasks/fieldChat.ts`
- Test: `server/test/llm/tasks/fieldChat.test.ts`

**Interfaces:**
- Consumes: `fieldTextSchema`, `fieldOp`, `redactSourceText`, `RedactTarget` (Task 1); `ChatMessageRecord` (Task 2); `TaskDefinition` z `../run.js`; `ChatMessage` z `../provider.js`
- Produces:
  - `interface FieldChatResult { reply: string; english?: string }`
  - `interface FieldChatInput { fieldLabel: string; current: string; history: ChatMessageRecord[]; message: string }`
  - `fieldChatTaskFor(target: RedactTarget): TaskDefinition<FieldChatResult>`
  - `fieldChatToPatch(result: FieldChatResult, target: RedactTarget, project: Project): ProjectPatch`
  - `fieldLabelFor(target: RedactTarget): string`

- [ ] **Step 1: Napisz testy**

Plik `server/test/llm/tasks/fieldChat.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { newProject } from '../../../src/storage/newProject.js'
import {
  fieldChatTaskFor, fieldChatToPatch, fieldLabelFor,
} from '../../../src/llm/tasks/fieldChat.js'

const style = { kind: 'style' } as const

describe('fieldChatTaskFor — schemat odpowiedzi', () => {
  it('sama proza bez propozycji zmiany jest poprawną odpowiedzią', () => {
    const parsed = fieldChatTaskFor(style).schema.safeParse({ reply: 'Wyjaśniam różnicę.' })
    expect(parsed.success).toBe(true)
  })

  it('pusta proza jest odrzucona — tura bez odpowiedzi nie ma sensu', () => {
    expect(fieldChatTaskFor(style).schema.safeParse({ reply: '' }).success).toBe(false)
  })

  it('propozycja dla pola audio dziedziczy limit zdań', () => {
    const task = fieldChatTaskFor({ kind: 'audio', field: 'nonDiegeticMusic' })
    expect(task.schema.safeParse({ reply: 'ok', english: 'One. Two. Three.' }).success).toBe(true)
    expect(task.schema.safeParse({ reply: 'ok', english: 'One. Two. Three. Four.' }).success)
      .toBe(false)
  })

  it('propozycja dla pola audio odrzuca blok dialogowy', () => {
    const task = fieldChatTaskFor({ kind: 'audio', field: 'overallSoundscape' })
    expect(task.schema.safeParse({ reply: 'ok', english: 'Rain. <d>[English] Hi.</d>' }).success)
      .toBe(false)
  })
})

describe('fieldChatTaskFor — wiadomości', () => {
  const buildFor = (history: Array<{ role: 'user' | 'assistant'; text: string }>) =>
    fieldChatTaskFor(style).buildMessages({
      fieldLabel: 'visual style',
      current: 'Live-action',
      history,
      message: 'mocniej',
    })

  it('historia trafia do promptu jako osobne tury, w kolejności', () => {
    const messages = buildFor([
      { role: 'user', text: 'dodaj deszcz' },
      { role: 'assistant', text: 'Dodałem deszcz.' },
    ])
    const roles = messages.map(m => m.role)
    expect(roles).toEqual(['system', 'user', 'user', 'assistant', 'user'])
    expect(messages[2]?.content).toBe('dodaj deszcz')
    expect(messages[3]?.content).toBe('Dodałem deszcz.')
    expect(messages[4]?.content).toBe('mocniej')
  })

  it('prompt systemowy niesie rodziny efektów i zakaz słów nastroju', () => {
    const system = buildFor([])[0]?.content ?? ''
    for (const family of ['lighting', 'weather', 'material', 'speed']) {
      expect(system.toLowerCase()).toContain(family)
    }
    expect(system).toContain('melancholic')
  })

  it('bieżąca treść pola i jego nazwa trafiają do pierwszej wiadomości użytkownika', () => {
    const first = buildFor([])[1]?.content ?? ''
    expect(first).toContain('visual style')
    expect(first).toContain('Live-action')
  })
})

describe('fieldChatToPatch', () => {
  it('brak propozycji daje pustą listę operacji', () => {
    const project = newProject('P', 'T2VA')
    expect(fieldChatToPatch({ reply: 'tylko odpowiadam' }, style, project).ops).toEqual([])
  })

  it('propozycja identyczna z bieżącą treścią nie tworzy operacji', () => {
    const project = { ...newProject('P', 'T2VA'), style: 'Live-action' }
    expect(fieldChatToPatch({ reply: 'ok', english: '  Live-action  ' }, style, project).ops)
      .toEqual([])
  })

  it('propozycja zmiany daje jedną operację z etykietą rozmowy', () => {
    const project = { ...newProject('P', 'T2VA'), style: 'Live-action' }
    const ops = fieldChatToPatch({ reply: 'ok', english: 'Live-action, rain' }, style, project).ops
    expect(ops).toHaveLength(1)
    expect(ops[0]?.label).toContain('rozmow')
    expect(ops[0]?.kind).toBe('setStyle')
  })
})

describe('fieldLabelFor', () => {
  it('nazywa pole po angielsku, bo trafia do promptu', () => {
    expect(fieldLabelFor(style)).toBe('visual style')
    expect(fieldLabelFor({ kind: 'audio', field: 'overallSoundscape' })).toBe('overall soundscape')
  })
})
```

- [ ] **Step 2: Uruchom testy — mają paść**

Run: `npm test --workspace @mmh3/server -- fieldChat`
Expected: FAIL, `Cannot find module '../../../src/llm/tasks/fieldChat.js'`

- [ ] **Step 3: Napisz `fieldChat.ts`**

```ts
import { z } from 'zod'
import type { Project, ProjectPatch } from '@mmh3/shared'
import type { ChatMessage } from '../provider.js'
import type { TaskDefinition } from '../run.js'
import type { ChatMessageRecord } from '../chatStore.js'
import { fieldOp, fieldTextSchema, redactSourceText, type RedactTarget } from './fieldTarget.js'

export interface FieldChatResult { reply: string; english?: string }

export interface FieldChatInput {
  fieldLabel: string
  current: string
  history: ChatMessageRecord[]
  message: string
}

/**
 * Nazwa pola PO ANGIELSKU, bo jedzie do promptu razem z resztą instrukcji.
 * Interfejs pokazuje własne, przetłumaczone etykiety (`web/src/i18n/dict.ts`) —
 * to są dwie różne publiczności, nie jedna.
 */
export function fieldLabelFor(target: RedactTarget): string {
  switch (target.kind) {
    case 'style': return 'visual style'
    case 'audio':
      return target.field === 'overallSoundscape' ? 'overall soundscape' : 'non-diegetic music'
    case 'speaker':
      return target.field === 'fullDescriptor' ? 'speaker full descriptor' : 'speaker short descriptor'
    case 'shotText': return 'shot description'
  }
}

/**
 * Prompt rozmowy. Różni się od redakcji (`redact.ts`) zadaniem: tam chodzi o
 * wierne przeniesienie pola z polskiego na angielski, tu o ROZSZERZENIE go
 * zgodnie z życzeniem użytkownika. Wspólne zostają ograniczenia formatu, bo
 * pochodzą z przewodnika MMH3, nie z zadania.
 *
 * Efekty nie mają w MMH3 osobnego pola — żyją w prozie ujęcia (przykład
 * dostawcy: „cracks spread through it as fragments slide outward") i w
 * amplitudzie/prędkości frazy kamery. Stąd cztery rodziny wypisane wprost:
 * bez nich model odpowiada na „dodaj efekty" słowami nastroju, a te zapalają
 * `MUSIC_NO_MOOD_WORDS` — potwierdzone uruchomieniem na serwerze 2026-08-05.
 */
const SYSTEM_PROMPT = [
  'You help a director refine ONE text field of a video-generation prompt. '
    + 'The user writes instructions in Polish or English; the field itself is '
    + 'always written in English.',
  'Answer in two parts: "reply" is a short note to the human, in the language '
    + 'they wrote in, saying what you changed and why. "english" is the full '
    + 'new field text. Omit "english" entirely when the user only asked a '
    + 'question and nothing should change.',
  'When the user asks for effects, reach for concrete, observable phenomena in '
    + 'four families: lighting (transitions, sources, direction, contrast); '
    + 'weather and atmosphere (rain, fog, dust, steam, sparks); material '
    + 'behaviour (cracking, spilling, falling, losing momentum); and speed of '
    + 'motion (how fast things move, and the amplitude and speed of any camera '
    + 'movement).',
  'Never name an emotion or atmosphere directly. Words such as "melancholic", '
    + '"dramatic", "eerie" or "tense" are rejected by a validation rule — write '
    + 'what is seen or heard instead, and let the feeling follow from it.',
  'Write in the present tense. Prefer concrete detail over evaluation.',
  'Never write a "<d>" tag or a bracketed language marker such as "[English]" '
    + 'into the field — the compiler adds those itself and a rule rejects them. '
    + 'In an audio field, never repeat or paraphrase spoken dialogue: describe '
    + 'the sound, do not quote the words.',
  'Keep the field to the length the user asks for. If they do not say, stay '
    + 'close to the current length.',
].join('\n')

const jsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reply'],
  properties: {
    reply: { type: 'string' },
    english: { type: 'string' },
  },
} as const

export function fieldChatTaskFor(target: RedactTarget): TaskDefinition<FieldChatResult> {
  return {
    name: 'rozmowa o polu',
    schema: z.object({
      reply: z.string().min(1),
      english: fieldTextSchema(target).optional(),
    }),
    jsonSchema,
    maxTokens: 900,
    buildMessages: (input: unknown): ChatMessage[] => {
      const parsed = input as FieldChatInput
      return [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Field: ${parsed.fieldLabel}\nCurrent content:\n\n${parsed.current}`,
        },
        ...parsed.history.map(m => ({ role: m.role, content: m.text } as ChatMessage)),
        { role: 'user', content: parsed.message },
      ]
    },
  }
}

/**
 * Ta sama droga do operacji, którą chodzi redakcja (`fieldOp`) — nie ma
 * drugiej, więc strażnicy treści nie mają czego ominąć. Różni się wyłącznie
 * etykietą, bo uzasadnienie zmiany jest inne.
 */
export function fieldChatToPatch(
  result: FieldChatResult,
  target: RedactTarget,
  project: Project,
): ProjectPatch {
  const text = result.english?.trim() ?? ''
  if (text === '') return { ops: [] }
  const current = redactSourceText(project, target)
  if (current === undefined) return { ops: [] }
  if (current.trim() === text) return { ops: [] }
  return { ops: [fieldOp(target, text, `Zmiana pola z rozmowy z modelem.`)] }
}
```

- [ ] **Step 4: Uruchom testy — mają przejść**

Run: `npm test --workspace @mmh3/server -- fieldChat`
Expected: PASS (11 testów)

- [ ] **Step 5: Weryfikacja odwrotna**

1. Usuń `.optional()` z `english` → test „sama proza" musi paść.
2. Zamień `fieldTextSchema(target)` na `z.string()` → oba testy pól audio muszą paść.
3. Usuń rozłożenie `parsed.history` z `buildMessages` → test kolejności historii musi paść.

Cofnij po każdym sprawdzeniu.

- [ ] **Step 6: Commit**

```bash
git add server/src/llm/tasks/fieldChat.ts server/test/llm/tasks/fieldChat.test.ts
git commit -m "feat: zadanie rozmowy o polu z rodzinami efektow"
```

---

### Task 4: Trasa uruchomienia i zapis tury

**Files:**
- Modify: `server/src/routes/llm.ts` (wariant `RunBody`, gałąź `case`)
- Test: `server/test/routes/llmChat.test.ts`

**Interfaces:**
- Consumes: `fieldChatTaskFor`, `fieldChatToPatch`, `fieldLabelFor`, `FieldChatInput` (Task 3); `appendTurn`, `readChats`, `threadKey` (Task 2)
- Produces: wariant żądania `{ task: 'fieldChat', projectSlug, target, message }`; ładunek `done` z polami `patch`, `reply`, `promptTokens`, `completionTokens`, `repaired`

- [ ] **Step 1: Napisz test trasy**

Plik `server/test/routes/llmChat.test.ts`. Pomocniki (`buildApp`, `enableProvider`, `mockFetch`, `chatResponse`, `parseSse`, `doneData`) skopiuj **dosłownie** z `server/test/routes/llm.test.ts:1-153` — ten zestaw obsługuje już pięć zadań i nie ma powodu pisać drugiego.

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { readChats } from '../../src/llm/chatStore.js'

// --- pomocniki skopiowane z routes/llm.test.ts (buildApp, enableProvider,
// --- mockFetch, chatResponse, parseSse, doneData) ---

let root: string
let app: FastifyInstance

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-chatroute-'))
  app = await buildApp({ dataRoot: root })
})

afterEach(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const chatJson = JSON.stringify({
  reply: 'Dodałem deszcz.',
  english: 'Live-action, rain on cold asphalt',
})

const chatBody = (slug: string, message = 'dodaj deszcz') => ({
  task: 'fieldChat',
  projectSlug: slug,
  target: { kind: 'style' },
  message,
})

describe('POST /api/llm/run — fieldChat', () => {
  it('udana tura zapisuje pytanie i odpowiedź do chats.json', async () => {
    const slug = await createProject('Projekt')
    await enableProvider()
    mockFetch(() => chatResponse(chatJson))

    const res = await app.inject({ method: 'POST', url: '/api/llm/run', payload: chatBody(slug) })
    expect(res.statusCode).toBe(200)

    const threads = await readChats(root, slug)
    expect(threads).toHaveLength(1)
    expect(threads[0]?.key).toBe('style')
    expect(threads[0]?.messages.map(m => m.role)).toEqual(['user', 'assistant'])
    expect(threads[0]?.messages[0]?.text).toBe('dodaj deszcz')
    expect(threads[0]?.messages[1]?.text).toBe('Dodałem deszcz.')
    expect(threads[0]?.messages[1]?.english).toBe('Live-action, rain on cold asphalt')
  })

  it('wynik niesie prozę OBOK łatki', async () => {
    const slug = await createProject('Projekt')
    await enableProvider()
    mockFetch(() => chatResponse(chatJson))

    const res = await app.inject({ method: 'POST', url: '/api/llm/run', payload: chatBody(slug) })
    const done = doneData(res.payload)
    expect(done.reply).toBe('Dodałem deszcz.')
    expect((done.patch as { ops: unknown[] }).ops).toHaveLength(1)
  })

  it('błąd modelu nie zapisuje niczego — nie ma czego zapisać', async () => {
    const slug = await createProject('Projekt')
    await enableProvider()
    mockFetch(() => new Response('nie działa', { status: 500 }))

    await app.inject({ method: 'POST', url: '/api/llm/run', payload: chatBody(slug) })
    expect(await readChats(root, slug)).toEqual([])
  })

  it('druga tura widzi pierwszą — historia idzie do modelu', async () => {
    const slug = await createProject('Projekt')
    await enableProvider()
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: { body?: string }) => {
      sent.push(init.body ?? '')
      return chatResponse(chatJson)
    }))

    await app.inject({ method: 'POST', url: '/api/llm/run', payload: chatBody(slug, 'dodaj deszcz') })
    await app.inject({ method: 'POST', url: '/api/llm/run', payload: chatBody(slug, 'mocniej') })

    expect(sent).toHaveLength(2)
    expect(sent[0]).not.toContain('mocniej')
    // Drugie zapytanie niesie pierwszą wymianę jako osobne tury rozmowy.
    expect(sent[1]).toContain('dodaj deszcz')
    expect(sent[1]).toContain('Dodałem deszcz.')
    expect(sent[1]).toContain('mocniej')
  })

  it('puste pole nie blokuje rozmowy — inaczej niż redakcja', async () => {
    // `newProject` zostawia `style` pusty; redakcja odrzuciłaby to kodem 400
    // („Wskazane pole nie istnieje albo jest puste"), bo nie ma czego
    // tłumaczyć. Rozmowa o pustym polu to normalny pierwszy ruch: „napisz mi
    // styl od zera".
    const slug = await createProject('Projekt')
    await enableProvider()
    mockFetch(() => chatResponse(chatJson))

    const chat = await app.inject({ method: 'POST', url: '/api/llm/run', payload: chatBody(slug) })
    expect(chat.statusCode).toBe(200)

    const redact = await app.inject({
      method: 'POST',
      url: '/api/llm/run',
      payload: { task: 'redact', projectSlug: slug, target: { kind: 'style' } },
    })
    expect(redact.statusCode).toBe(400)
  })

  it('pusta wiadomość jest odrzucona przez schemat', async () => {
    const slug = await createProject('Projekt')
    await enableProvider()
    const res = await app.inject({
      method: 'POST', url: '/api/llm/run', payload: chatBody(slug, ''),
    })
    expect(res.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Uruchom testy — mają paść**

Run: `npm test --workspace @mmh3/server -- llmChat`
Expected: FAIL — trasa odrzuca `task: 'fieldChat'` kodem 400 („Żądanie niezgodne ze schematem zadania")

- [ ] **Step 3: Dodaj wariant do `RunBody`**

W `server/src/routes/llm.ts`, w unii `RunBody`:

```ts
  z.object({
    task: z.literal('fieldChat'),
    projectSlug: SlugSchema,
    target: RedactTargetSchema,
    message: z.string().min(1),
  }),
```

- [ ] **Step 4: Dodaj gałąź `case`**

Obok `case 'redact'`:

```ts
        case 'fieldChat': {
          const target = parsed.data.target
          const message = parsed.data.message
          // W odróżnieniu od redakcji puste pole NIE jest błędem: „napisz mi
          // styl od zera" to normalny pierwszy ruch rozmowy. Model dostaje
          // pustą treść i wie z promptu, że ma ją zbudować.
          const current = redactSourceText(project, target) ?? ''
          return {
            ok: true,
            run: async (fwd, signal, onRepairStart) => {
              const history = (await readChats(app.dataRoot, parsed.data.projectSlug))
                .find(t => t.key === threadKey(target))?.messages ?? []
              const input: FieldChatInput = {
                fieldLabel: fieldLabelFor(target), current, history, message,
              }
              const result = await runTask(fwd, fieldChatTaskFor(target), input, signal, onRepairStart)
              // Zapis PO sukcesie, nigdy przed: tura przerwana albo zakończona
              // błędem nie ma czego zapisać, a historia z połową wymiany
              // myliłaby model w następnym pytaniu.
              await appendTurn(
                app.dataRoot, parsed.data.projectSlug, project, target,
                message, result.value.reply, result.value.english,
              )
              return {
                patch: fieldChatToPatch(result.value, target, project),
                reply: result.value.reply,
                promptTokens: result.promptTokens,
                completionTokens: result.completionTokens,
                repaired: result.repaired,
              }
            },
          }
        }
```

Dopisz importy na górze pliku: `readChats`, `threadKey`, `appendTurn` z `../llm/chatStore.js` oraz `fieldChatTaskFor`, `fieldChatToPatch`, `fieldLabelFor`, `type FieldChatInput` z `../llm/tasks/fieldChat.js`.

- [ ] **Step 5: Uruchom testy — mają przejść**

Run: `npm test --workspace @mmh3/server && npm run typecheck`
Expected: PASS, zero błędów typów. Gałąź `default` z `const exhaustive: never = parsed.data` nadal się kompiluje — to ona pilnuje, że nowy wariant unii dostał obsługę.

- [ ] **Step 6: Weryfikacja odwrotna**

Przenieś `appendTurn` PRZED `runTask` → test „błąd modelu nie zapisuje niczego" musi paść. Cofnij.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/llm.ts server/test/routes/llmChat.test.ts
git commit -m "feat: trasa rozmowy o polu z zapisem tury po sukcesie"
```

---

### Task 5: Trasy odczytu i czyszczenia wątków

**Files:**
- Modify: `server/src/routes/projects.ts`
- Test: `server/test/routes/chats.test.ts`

**Interfaces:**
- Consumes: `readChats`, `clearThread` (Task 2)
- Produces: `GET /api/projects/:slug/chats` → `{ threads: ChatThread[] }`; `DELETE /api/projects/:slug/chats/:key` → `204`

- [ ] **Step 1: Napisz testy**

Plik `server/test/routes/chats.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { readProject } from '../../src/storage/projectStore.js'
import { appendTurn } from '../../src/llm/chatStore.js'

let root: string
let app: FastifyInstance

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-chats-api-'))
  app = await buildApp({ dataRoot: root })
})

afterEach(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true })
})

const create = async (name: string): Promise<string> => {
  const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name, mode: 'T2VA' } })
  return res.json().slug as string
}

const seed = async (slug: string, target: unknown, text: string): Promise<void> => {
  const project = await readProject(root, slug)
  await appendTurn(root, slug, project, target as never, text, 'odpowiedź', undefined)
}

describe('GET /api/projects/:slug/chats', () => {
  it('zwraca wątki zapisanego projektu', async () => {
    const slug = await create('Projekt')
    await seed(slug, { kind: 'style' }, 'dodaj deszcz')

    const res = await app.inject({ method: 'GET', url: `/api/projects/${slug}/chats` })
    expect(res.statusCode).toBe(200)
    expect(res.json().threads).toHaveLength(1)
    expect(res.json().threads[0].key).toBe('style')
    expect(res.json().threads[0].messages[0].text).toBe('dodaj deszcz')
  })

  it('projekt bez rozmów zwraca pustą listę, nie 404', async () => {
    const slug = await create('Projekt')
    const res = await app.inject({ method: 'GET', url: `/api/projects/${slug}/chats` })
    expect(res.statusCode).toBe(200)
    expect(res.json().threads).toEqual([])
  })

  it('nieistniejący projekt zwraca 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/nie-ma-takiego/chats' })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /api/projects/:slug/chats/:key', () => {
  it('czyści wskazany wątek, resztę zostawia', async () => {
    const slug = await create('Projekt')
    await seed(slug, { kind: 'style' }, 'a')
    await seed(slug, { kind: 'audio', field: 'nonDiegeticMusic' }, 'b')

    const res = await app.inject({ method: 'DELETE', url: `/api/projects/${slug}/chats/style` })
    expect(res.statusCode).toBe(204)

    const after = await app.inject({ method: 'GET', url: `/api/projects/${slug}/chats` })
    expect(after.json().threads.map((t: { key: string }) => t.key)).toEqual(['audio:nonDiegeticMusic'])
  })

  it('klucz z dwukropkami przechodzi zakodowany', async () => {
    const slug = await create('Projekt')
    await seed(slug, { kind: 'audio', field: 'nonDiegeticMusic' }, 'b')

    const key = encodeURIComponent('audio:nonDiegeticMusic')
    const res = await app.inject({ method: 'DELETE', url: `/api/projects/${slug}/chats/${key}` })
    expect(res.statusCode).toBe(204)

    const after = await app.inject({ method: 'GET', url: `/api/projects/${slug}/chats` })
    expect(after.json().threads).toEqual([])
  })

  it('czyszczenie nieistniejącego wątku to też 204 — stan końcowy jest ten sam', async () => {
    const slug = await create('Projekt')
    const res = await app.inject({ method: 'DELETE', url: `/api/projects/${slug}/chats/style` })
    expect(res.statusCode).toBe(204)
  })
})
```

Uwaga: `seed` używa `readProject`, bo `appendTurn` potrzebuje projektu do usuwania sierot — cel `{ kind: 'audio', field: 'nonDiegeticMusic' }` rozwiązuje się w świeżym projekcie (`newProject` ustawia tam `'N/A'`), więc wątek przeżywa zapis.

- [ ] **Step 2: Uruchom — mają paść**

Run: `npm test --workspace @mmh3/server -- chats.test`
Expected: FAIL, 404 na obu trasach

- [ ] **Step 3: Dodaj trasy**

W `server/src/routes/projects.ts`, obok istniejących tras projektu:

```ts
  app.get('/api/projects/:slug/chats', async (request, reply) => {
    const slug = parseSlugParam(request.params)
    if (slug === null) return reply.status(400).send({ error: 'Nieprawidłowy identyfikator projektu' })
    try {
      await readProject(app.dataRoot, slug)
    } catch {
      return reply.status(404).send({ error: `Projekt "${slug}" nie istnieje` })
    }
    return { threads: await readChats(app.dataRoot, slug) }
  })

  app.delete('/api/projects/:slug/chats/:key', async (request, reply) => {
    const slug = parseSlugParam(request.params)
    if (slug === null) return reply.status(400).send({ error: 'Nieprawidłowy identyfikator projektu' })
    // Klucz wątku zawiera dwukropki (`shot:sh-1:0`), więc klient koduje go
    // przez `encodeURIComponent`; Fastify dekoduje parametr ścieżki sam.
    const key = (request.params as { key?: string }).key ?? ''
    await clearThread(app.dataRoot, slug, key)
    return reply.status(204).send()
  })
```

Użyj tego samego sposobu odczytu i walidacji parametru `slug`, którego używają sąsiednie trasy w tym pliku (`server/src/routes/params.ts`) — nie wprowadzaj własnego.

- [ ] **Step 4: Uruchom — mają przejść**

Run: `npm test --workspace @mmh3/server && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Weryfikacja odwrotna**

Usuń wywołanie `clearThread` z ciała trasy DELETE (zostaw samo `204`) → test czyszczenia musi paść. Cofnij.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/projects.ts server/test/routes/chats.test.ts
git commit -m "feat: trasy odczytu i czyszczenia watkow rozmowy"
```

---

### Task 6: Klient i okno dialogowe

**Files:**
- Create: `web/src/llm/chatApi.ts`
- Create: `web/src/llm/FieldChat.tsx`
- Modify: `web/src/llm/useLlmRun.ts` (przeniesienie pola `reply` ze zdarzenia `done`)
- Modify: `web/src/i18n/dict.ts` (klucze `llm.chat*` w `pl` i `en`)
- Test: `web/test/llm/fieldChat.test.tsx`

**Interfaces:**
- Consumes: trasy z Tasków 4 i 5; `PatchReview` (`web/src/llm/PatchReview.tsx`, props `{ patch: ProjectPatch }`); `useLlmRun` (`web/src/llm/useLlmRun.ts`)
- Produces:
  - `chatApi.ts`: `interface ChatMessageRecord { role: 'user' | 'assistant'; text: string; english?: string }`, `interface ChatThread { key: string; target: RedactTarget; messages: ChatMessageRecord[] }`, `fetchChats(slug): Promise<ChatThread[]>`, `clearChat(slug, key): Promise<void>`
  - `FieldChat.tsx`: `function FieldChat({ slug, target, onClose }: { slug: string; target: RedactTarget; onClose: () => void })`

- [ ] **Step 1: Dodaj klucze tłumaczeń**

W `web/src/i18n/dict.ts`, w obiekcie `pl` obok istniejących `llm.*`:

```ts
  'llm.chatOpen': 'Rozmawiaj o tym polu',
  'llm.chatTitle': 'Rozmowa o polu',
  'llm.chatMessage': 'Twoje polecenie',
  'llm.chatSend': 'Wyślij',
  'llm.chatClear': 'Wyczyść rozmowę',
  'llm.chatClose': 'Zamknij',
  'llm.chatEmpty': 'Napisz, co zmienić w tym polu — na przykład „dodaj deszcz i zimne światło".',
  'llm.chatYou': 'Ty',
  'llm.chatModel': 'Model',
  'llm.chatNoChange': 'Ta odpowiedź niczego nie zmienia w polu.',
```

I te same klucze w obiekcie `en` z tłumaczeniami:

```ts
  'llm.chatOpen': 'Discuss this field',
  'llm.chatTitle': 'Field conversation',
  'llm.chatMessage': 'Your instruction',
  'llm.chatSend': 'Send',
  'llm.chatClear': 'Clear conversation',
  'llm.chatClose': 'Close',
  'llm.chatEmpty': 'Say what to change in this field — for example "add rain and cold light".',
  'llm.chatYou': 'You',
  'llm.chatModel': 'Model',
  'llm.chatNoChange': 'This answer changes nothing in the field.',
```

- [ ] **Step 2: Przenieś `reply` w `useLlmRun`**

W `web/src/llm/useLlmRun.ts`: dodaj `reply?: unknown` do `DonePayload`, `reply: string | null` do `UseLlmRunResult`, stan `const [reply, setReply] = useState<string | null>(null)`, ustawienie obok `setPatch` (`setReply(typeof payload.reply === 'string' ? payload.reply : null)`), wyzerowanie tam, gdzie zerują się `patch`/`notes`, i `reply` w zwracanym obiekcie.

- [ ] **Step 3: Napisz test okna**

Plik `web/test/llm/fieldChat.test.tsx`. Pomocnik `routedFetch` skopiuj z `web/test/llm/unloadButton.test.tsx:16-30` — ten pakiet mockuje `fetch` po parze `METODA URL`, klika w **nazwy dostępności**, nigdy w klasy CSS, a `web/test/setup.ts` ustawia język na `pl`.

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FieldChat } from '../../src/llm/FieldChat.js'

// --- `json` i `routedFetch` skopiowane z unloadButton.test.tsx:16-30 ---

/** Odpowiedź SSE trasy `/api/llm/run` — trzy zdarzenia, tak jak buduje je
 *  `server/src/routes/llm.ts`. */
const runStream = (payload: unknown): Response => new Response(
  `event: done\ndata: ${JSON.stringify(payload)}\n\n`,
  { headers: { 'content-type': 'text/event-stream' } },
)

const styleOp = {
  kind: 'setStyle', id: 'op-1', label: 'Zmiana pola z rozmowy z modelem.',
  text: 'Live-action, rain',
}

const withHistory = {
  threads: [{
    key: 'style',
    target: { kind: 'style' },
    messages: [
      { role: 'user', text: 'dodaj deszcz' },
      { role: 'assistant', text: 'Dodałem deszcz.', english: 'Live-action, rain' },
    ],
  }],
}

const target = { kind: 'style' } as const

afterEach(() => { vi.unstubAllGlobals() })

describe('FieldChat', () => {
  it('pokazuje zapisaną historię wątku po otwarciu', async () => {
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/projects/p/chats': () => json(withHistory),
    }))
    render(<FieldChat slug="p" target={target} onClose={() => {}} />)

    expect(await screen.findByText('dodaj deszcz')).toBeInTheDocument()
    expect(await screen.findByText('Dodałem deszcz.')).toBeInTheDocument()
  })

  it('pusty wątek pokazuje podpowiedź, nie pustkę', async () => {
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/projects/p/chats': () => json({ threads: [] }),
    }))
    render(<FieldChat slug="p" target={target} onClose={() => {}} />)

    expect(await screen.findByText(/dodaj deszcz i zimne światło/)).toBeInTheDocument()
  })

  it('przycisk wysyłki jest wyłączony, dopóki pole jest puste', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/projects/p/chats': () => json({ threads: [] }),
    }))
    render(<FieldChat slug="p" target={target} onClose={() => {}} />)

    const send = await screen.findByRole('button', { name: /wyślij/i })
    expect(send).toBeDisabled()

    await user.type(screen.getByLabelText(/twoje polecenie/i), 'dodaj deszcz')
    expect(send).toBeEnabled()
  })

  it('odpowiedź z propozycją pokazuje przegląd operacji', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/projects/p/chats': () => json({ threads: [] }),
      'POST /api/llm/run': () => runStream({ reply: 'Dodałem deszcz.', patch: { ops: [styleOp] } }),
    }))
    render(<FieldChat slug="p" target={target} onClose={() => {}} />)

    await user.type(await screen.findByLabelText(/twoje polecenie/i), 'dodaj deszcz')
    await user.click(screen.getByRole('button', { name: /wyślij/i }))

    expect(await screen.findByText('Dodałem deszcz.')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /zatwierdź/i })).toBeInTheDocument()
    })
  })

  it('odpowiedź bez propozycji mówi wprost, że nic nie zmienia', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/projects/p/chats': () => json({ threads: [] }),
      'POST /api/llm/run': () => runStream({ reply: 'Wyjaśniam.', patch: { ops: [] } }),
    }))
    render(<FieldChat slug="p" target={target} onClose={() => {}} />)

    await user.type(await screen.findByLabelText(/twoje polecenie/i), 'czym się różni push in?')
    await user.click(screen.getByRole('button', { name: /wyślij/i }))

    expect(await screen.findByText(/niczego nie zmienia/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /zatwierdź/i })).not.toBeInTheDocument()
  })

  it('czyszczenie rozmowy woła DELETE i opróżnia listę tur', async () => {
    const user = userEvent.setup()
    const deleted: string[] = []
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/projects/p/chats': () => json(withHistory),
      'DELETE /api/projects/p/chats/style': () => {
        deleted.push('style')
        return new Response(null, { status: 204 })
      },
    }))
    render(<FieldChat slug="p" target={target} onClose={() => {}} />)

    await user.click(await screen.findByRole('button', { name: /wyczyść rozmowę/i }))

    expect(deleted).toEqual(['style'])
    await waitFor(() => {
      expect(screen.queryByText('dodaj deszcz')).not.toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 4: Uruchom — mają paść**

Run: `npm test --workspace @mmh3/web -- fieldChat`
Expected: FAIL, brak modułu `FieldChat.js`

- [ ] **Step 5: Napisz `chatApi.ts` i `FieldChat.tsx`**

`chatApi.ts` — dwa wywołania sieciowe, z `encodeURIComponent` na kluczu wątku:

```ts
export async function fetchChats(slug: string): Promise<ChatThread[]> {
  const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/chats`)
  if (!response.ok) return []
  const data = await response.json() as { threads?: ChatThread[] }
  return data.threads ?? []
}

export async function clearChat(slug: string, key: string): Promise<void> {
  await fetch(
    `/api/projects/${encodeURIComponent(slug)}/chats/${encodeURIComponent(key)}`,
    { method: 'DELETE' },
  )
}
```

`FieldChat.tsx` — okno z listą tur, polem wiadomości i przyciskami. Wymagania:
- historia ładuje się raz przy zamontowaniu (`useEffect` na `[slug, key]`),
- wysyłka woła `run({ task: 'fieldChat', projectSlug: slug, target, message })` z `useLlmRun`,
- po zdarzeniu `done` dopisuje turę do lokalnej listy (serwer zapisał swoją kopię),
- `PatchReview` renderuje się tylko dla tury, której `patch.ops` nie jest puste; dla pustej pokazuje `t('llm.chatNoChange')`,
- przycisk „Wyślij" jest wyłączony przy pustym polu i w trakcie biegu,
- każdy przycisk i pole ma etykietę z `dict.ts`, bo testy i zrzuty do README klikają w nazwy dostępności.

- [ ] **Step 6: Uruchom — mają przejść**

Run: `npm test --workspace @mmh3/web && npm run typecheck`
Expected: PASS

- [ ] **Step 7: Weryfikacja odwrotna**

Usuń warunek pustych operacji (renderuj `PatchReview` zawsze) → test „odpowiedź bez propozycji" musi paść. Cofnij.

- [ ] **Step 8: Commit**

```bash
git add web/src/llm/chatApi.ts web/src/llm/FieldChat.tsx web/src/llm/useLlmRun.ts \
        web/src/i18n/dict.ts web/test/llm/fieldChat.test.tsx
git commit -m "feat: okno dialogowe rozmowy o polu"
```

---

### Task 7: Zamiana wejścia w panelu LLM

**Files:**
- Modify: `web/src/llm/LlmPanel.tsx:636-667`
- Test: `web/test/llm/LlmPanel.test.tsx` (istniejący — dopisanie przypadków)

**Interfaces:**
- Consumes: `FieldChat` (Task 6); istniejąca lista `redactChoices` z `LlmPanel.tsx:53-80`

- [ ] **Step 1: Dopisz testy do istniejącego pliku panelu**

```tsx
  it('panel oferuje rozmowę o wybranym polu zamiast jednostrzałowej redakcji', async () => {
    render(<LlmPanel />)
    expect(screen.queryByRole('button', { name: /redaguj/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /rozmawiaj o tym polu/i })).toBeInTheDocument()
  })

  it('kliknięcie otwiera okno rozmowy dla celu wybranego w liście', async () => {
    const user = userEvent.setup()
    render(<LlmPanel />)
    await user.selectOptions(screen.getByLabelText(/cel redakcji/i), 'audio:overallSoundscape')
    await user.click(screen.getByRole('button', { name: /rozmawiaj o tym polu/i }))
    expect(await screen.findByRole('dialog', { name: /rozmowa o polu/i })).toBeInTheDocument()
  })
```

Wartość `'audio:overallSoundscape'` musi odpowiadać `option.value` z `redactChoices`; sprawdź w pliku i użyj tej, która tam jest, zamiast zakładać.

- [ ] **Step 2: Uruchom — mają paść**

Run: `npm test --workspace @mmh3/web -- LlmPanel`
Expected: FAIL — przycisk „Redaguj" wciąż istnieje

- [ ] **Step 3: Zamień kontrolkę**

W `LlmPanel.tsx`: zostaw listę celów bez zmian (razem z komentarzem o `aria-label`, który opisuje realne znalezisko z przeglądarki), a `ActionButton` z `t('llm.taskRedact')` zastąp przyciskiem `t('llm.chatOpen')`, który ustawia stan `chatTarget` na cel wybrany w liście. Gdy `chatTarget` nie jest `null`, renderuj `<FieldChat slug={slug} target={chatTarget} onClose={() => setChatTarget(null)} />`.

Usuń `runRedact` i związany z nim kod, który zostaje bez wywołań. Zadanie `redact` po stronie serwera **zostaje** — używa go `translateAll`, a ponadto to ono niesie tłumaczenie PL→EN całego projektu.

- [ ] **Step 4: Uruchom — mają przejść**

Run: `npm test --workspace @mmh3/web && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/llm/LlmPanel.tsx web/test/llm/LlmPanel.test.tsx
git commit -m "feat: rozmowa zastepuje jednostrzalowa redakcje w panelu"
```

---

### Task 8: Przebieg w przeglądarce, reguła wiążąca i dokumentacja

Testy jednostkowe tego projektu trzykrotnie przepuściły usterkę, którą prawdziwa przeglądarka pokazała od razu (odtwarzanie zamarzało przy vsync 16,7 ms, nazwa dostępna `<select>` kolidowała z polem tekstowym). To zadanie zamyka tę lukę.

**Files:**
- Create: `web/e2e/fieldChat.spec.ts`
- Test: `server/test/llm/tasks/fieldChatBinding.test.ts`
- Modify: `README.md` (sekcja o zadaniach modelu)
- Modify: `web/e2e/screenshots.spec.ts` (zrzut okna rozmowy)
- Modify: `docs/superpowers/specs/2026-08-04-uwagi-do-planu-2.md` (dopisanie ewentualnego długu)

- [ ] **Step 1: Napisz test reguły wiążącej**

```ts
import { describe, it, expect } from 'vitest'
import { applyOps, buildPrompt } from '@mmh3/shared'
import { newProject } from '../../../src/storage/newProject.js'
import { fieldChatToPatch } from '../../../src/llm/tasks/fieldChat.js'

const ACCEPTED = new Set([
  'SPEECH_FITS', 'SOUNDSCAPE_NA_ONLY_IF_SILENT', 'SPEAKER_SILENT_NO_ID',
  'FL2VA_PREFER_SINGLE_SHOT', 'MUSIC_NO_MOOD_WORDS', 'SOUNDSCAPE_NO_DIALOGUE',
])

describe('reguła wiążąca — rozmowa o polu', () => {
  it('operacja z rozmowy nie zapala nowej diagnostyki na projekcie, który jej nie miał', () => {
    const project = { ...newProject('P', 'T2VA'), style: 'Live-action, cinematic realism' }
    // `buildPrompt` rejestruje reguły — `validate`/`compile` wprost dają dwa
    // puste zbiory i test nie potrafiłby paść (znalezisko planu 5, zadanie 6).
    const before = buildPrompt(project).diagnostics.map(d => d.ruleId)
    expect(before.filter(id => !ACCEPTED.has(id))).toEqual([])

    const patch = fieldChatToPatch(
      { reply: 'ok', english: 'Live-action, cinematic realism, cold rain-lit streets' },
      { kind: 'style' },
      project,
    )
    const after = buildPrompt(applyOps(project, patch.ops)).diagnostics.map(d => d.ruleId)
    expect(after.filter(id => !ACCEPTED.has(id))).toEqual([])
  })
})
```

- [ ] **Step 2: Uruchom — ma przejść, potem sprawdź, że potrafi paść**

Run: `npm test --workspace @mmh3/server -- fieldChatBinding`
Expected: PASS. Następnie podmień `english` na `'Live-action. <d>[English] test</d>'` i sprawdź, że test **pada** — inaczej niczego nie pilnuje. Cofnij podmianę.

- [ ] **Step 3: Napisz przebieg e2e**

Plik `web/e2e/fieldChat.spec.ts`. Ten pakiet klika w nazwy dostępności; jsdom nie ma `PointerEvent`, `setPointerCapture` ani układu strony, więc dopiero tutaj widać rzeczy takie jak kolizje nazw.

Dostawca modelu nie jest w e2e skonfigurowany, więc historię wstawiamy prosto do API. Sprawdzamy interfejs i trwałość rozmowy, nie jakość odpowiedzi modelu.

```ts
import { test, expect } from '@playwright/test'

test('rozmowa o polu otwiera się i pamięta historię po ponownym otwarciu', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /nowy projekt/i }).click()
  await page.getByLabel(/nazwa projektu/i).fill('Rozmowa')
  await page.getByRole('button', { name: /^T2VA/ }).click()
  await page.getByRole('button', { name: /^utwórz$/i }).click()

  await page.getByLabel(/styl wizualny/i).fill('Live-action, cinematic realism')

  // Historia wstawiona z pominięciem modelu: `appendTurn` po stronie serwera
  // jest wołany przez trasę uruchomienia, której tu nie odpalamy, więc wątek
  // zakładamy tym samym API, którym czyta go okno.
  await page.request.post('/api/llm/run', {
    data: { task: 'fieldChat', projectSlug: 'rozmowa', target: { kind: 'style' }, message: 'dodaj deszcz' },
    failOnStatusCode: false,
  })

  await page.getByRole('button', { name: /rozmawiaj o tym polu/i }).click()
  const dialog = page.getByRole('dialog', { name: /rozmowa o polu/i })
  await expect(dialog).toBeVisible()

  // Pusty wątek albo wątek z historią — w obu przypadkach okno ma stać
  // otwarte i mieć wyłączoną wysyłkę, dopóki nic nie napisano.
  await expect(dialog.getByRole('button', { name: /wyślij/i })).toBeDisabled()

  await dialog.getByLabel(/twoje polecenie/i).fill('mocniej')
  await expect(dialog.getByRole('button', { name: /wyślij/i })).toBeEnabled()

  await dialog.getByRole('button', { name: /zamknij/i }).click()
  await expect(dialog).toBeHidden()

  // Ponowne otwarcie tego samego pola trafia w ten sam wątek — klucz jest
  // wyprowadzony z celu, nie losowany przy otwarciu.
  await page.getByRole('button', { name: /rozmawiaj o tym polu/i }).click()
  await expect(page.getByRole('dialog', { name: /rozmowa o polu/i })).toBeVisible()
})
```

Etykiety w selektorach są polskie, bo `web/e2e/` uruchamia aplikację w domyślnym języku przeglądarki testowej — sprawdź w istniejących plikach `web/e2e/*.spec.ts`, czy klikają w polskie czy angielskie nazwy, i użyj tej samej konwencji. Gdy używają angielskich, przełącz język przyciskiem `EN`, tak jak robi to `screenshots.spec.ts:27`.

- [ ] **Step 4: Uruchom e2e**

Run: `cd web && npm run e2e`
Expected: PASS (8 przebiegów: 7 istniejących + nowy)

- [ ] **Step 5: Dodaj zrzut do generatora README**

W `web/e2e/screenshots.spec.ts`, w teście panelu LLM, po zapisaniu ustawień dostawcy: otwórz rozmowę o stylu i zapisz `docs/screenshots/07-field-chat.png`. Plik jest wykluczony ze zwykłego przebiegu (`MMH3_SHOTS=1` włącza go).

Run: `cd web && MMH3_SHOTS=1 npx playwright test e2e/screenshots.spec.ts`

- [ ] **Step 6: Uzupełnij README**

W sekcji o zadaniach modelu (angielski): opisz rozmowę o polu — że jest zawężona do jednego pola, pamięta historię w `chats.json` w katalogu projektu, ma limit 20 tur na wątek, a jej propozycje trafiają do projektu wyłącznie przez ekran przeglądu operacji. Wstaw nowy zrzut. Zaktualizuj listę zadań modelu, bo „Redakcja pola" znika z interfejsu.

- [ ] **Step 7: Pełny przebieg i commit**

```bash
npm test && npm run typecheck && (cd web && npm run e2e)
git add README.md docs/screenshots/07-field-chat.png web/e2e/fieldChat.spec.ts \
        web/e2e/screenshots.spec.ts server/test/llm/tasks/fieldChatBinding.test.ts
git commit -m "test: przebieg rozmowy w przegladarce, regula wiazaca i dokumentacja"
```

---

## Uwaga o wdrożeniu

Po zakończeniu planu aplikacja stoi na serwerze pod `154.54.100.49` (UI `:9921`, API `:8899`). Wdrożenie: `~/mmh3-run/restart.sh` (robi `git pull`, build i podnosi oba procesy). Zweryfikuj rozmowę na prawdziwym modelu — w tym projekcie trzy defekty prozy przeszły przez komplet zielonych testów i pokazały się dopiero na prawdziwym modelu. Sprawdź w szczególności, czy „dodaj efekty" produkuje opis fizyczny, a nie słowa nastroju.
