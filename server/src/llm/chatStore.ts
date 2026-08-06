import { readFile, rename, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Project } from '@mmh3/shared'
import { chatsFile } from '../storage/paths.js'
import { redactSourceText, RedactTargetSchema, type RedactTarget } from './tasks/fieldTarget.js'

/** Wiadomości na wątek. Starsze odpadają przy zapisie. */
export const MAX_MESSAGES = 20
/** Sufit całego pliku. Bez niego `chats.json` rośnie bez końca — nic go nie sprząta. */
export const MAX_BYTES = 256 * 1024
/**
 * Sufit długości POJEDYNCZEJ wiadomości, liczony w ZNAKACH. Polecenie
 * użytkownika w realnym użyciu nigdy nie jest tak długie, a odpowiedź modelu
 * ma z góry ograniczoną długość przez `maxTokens: 900` w zadaniu czatu (ok.
 * 3600 znaków) — 8000 to zapas ponad obie strony.
 *
 * To jest tylko TANI WSTĘPNY BEZPIECZNIK, nie gwarancja rozmiaru pliku:
 * liczba znaków to nie liczba bajtów zserializowanego JSON-a.
 * `JSON.stringify` eskejpuje np. `\n` do dwóch bajtów, a znaki kontrolne w
 * stylu `U+0000` do sześciu — wątek złożony z samych znaków nowej linii
 * zajmuje więc grubo ponad `20 × 8000` bajtów, mimo że mieści się w tym
 * limicie znaków. Faktyczny niezmiennik „plik ≤ MAX_BYTES" pilnuje
 * `enforceByteLimit` niżej, mierząc PRAWDZIWY rozmiar zserializowanego
 * wyniku (`Buffer.byteLength(serialize(...), 'utf8')`), a nie licząc znaki.
 */
export const MAX_MESSAGE_CHARS = 8000

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
  // `JSON.parse` musi być w TYM SAMYM `try` co odczyt: plik uszkodzony na
  // poziomie składni JSON (nie tylko niezgodny ze schematem) rzuca
  // `SyntaxError`, a rozmowa jest wygodą, nie danymi projektu — gorszym
  // wyjściem byłoby zablokować edytor wyjątkiem z powodu popsutego pliku.
  try {
    const raw = await readFile(chatsFile(root, slug), 'utf8')
    const parsed = FileSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data.threads : []
  } catch {
    // Brak pliku to normalny stan projektu, w którym nikt jeszcze nie
    // rozmawiał; uszkodzona składnia JSON dostaje tę samą, łagodną obsługę.
    return []
  }
}

/**
 * Zapisy wątków tego samego projektu ustawiają się w kolejkę — ten sam
 * wzorzec co `writeQueues` w `projectStore.ts`. Tu ryzyko wyścigu jest
 * WIĘKSZE niż tam: `writeProject` tylko zapisuje, a `appendTurn` NAJPIERW
 * CZYTA, więc bez kolejki dwa równoległe wywołania dla RÓŻNYCH pól tego
 * samego projektu mogłyby zgubić turę — drugie czytałoby stan sprzed
 * pierwszego zapisu i nadpisałoby go, zamiast dołożyć swój wątek. Kolejka
 * musi obejmować CAŁY cykl odczyt-modyfikacja-zapis, nie sam zapis, inaczej
 * wyścig zostaje mimo kolejki.
 */
const writeQueues = new Map<string, Promise<void>>()

async function withWriteQueue(slug: string, task: () => Promise<void>): Promise<void> {
  const previous = writeQueues.get(slug) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(task)
  writeQueues.set(slug, current)
  try {
    await current
  } finally {
    if (writeQueues.get(slug) === current) writeQueues.delete(slug)
  }
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
  await withWriteQueue(slug, async () => {
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
  })
}

export async function clearThread(root: string, slug: string, key: string): Promise<void> {
  await withWriteQueue(slug, async () => {
    const threads = await readChats(root, slug)
    await writeRaw(root, slug, threads.filter(t => t.key !== key))
  })
}

async function writeThreads(
  root: string, slug: string, project: Project, threads: ChatThread[],
): Promise<void> {
  // Sieroty: ujęcie albo mówca mogli zniknąć z projektu, a ich wątek został.
  // `redactSourceText` zwraca `undefined` dokładnie dla celu, którego nie da
  // się już rozwiązać — ta sama funkcja, która decyduje, czy w ogóle jest co
  // redagować, więc nie ma dwóch definicji „cel istnieje". Filtr działa na
  // KAŻDYM zapisie, łącznie z tym, który właśnie dopisuje nową turę — w
  // praktyce nie ma to znaczenia, bo okno rozmowy otwiera się tylko dla pola,
  // które w danej chwili istnieje w projekcie, więc świeżo dopisywany cel
  // zawsze jest żywy w momencie zapisu.
  const alive = threads.filter(t => redactSourceText(project, t.target) !== undefined)
  const trimmed = alive.map(t => ({
    ...t,
    messages: t.messages.slice(-MAX_MESSAGES).map(truncateMessage),
  }))

  await writeRaw(root, slug, enforceByteLimit(trimmed))
}

/** Przycina `text` i `english` do `MAX_MESSAGE_CHARS` — tani wstępny bezpiecznik, patrz komentarz przy stałej. */
function truncateMessage(message: ChatMessageRecord): ChatMessageRecord {
  const text = message.text.slice(0, MAX_MESSAGE_CHARS)
  return message.english === undefined
    ? { role: message.role, text }
    : { role: message.role, text, english: message.english.slice(0, MAX_MESSAGE_CHARS) }
}

/**
 * Wymusza `Buffer.byteLength(serialize(...), 'utf8') <= MAX_BYTES` na
 * PRAWDZIWYM rozmiarze zserializowanego wyniku, nie na liczbie znaków —
 * `MAX_MESSAGE_CHARS` to tylko tani wstępny bezpiecznik, ten kod jest
 * jedynym miejscem, które faktycznie GWARANTUJE niezmiennik. Trzy kroki, w
 * kolejności od najmniej do najbardziej dotkliwego:
 *
 *  1. zdejmij CAŁE najstarsze wątki, dopóki zostaje więcej niż jeden —
 *     wątek to naturalna jednostka „czego nie potrzebuję" (zamknięta
 *     rozmowa o innym polu), więc znika w całości, nie fragmentami;
 *  2. gdy został jeden wątek i wciąż za duży — zdejmij jego najstarsze
 *     wiadomości, z tego samego powodu co wyżej, tylko o jeden poziom niżej
 *     (wiadomość, nie wątek, jest tu najmniejszą sensowną jednostką);
 *  3. gdy została jedna wiadomość i wciąż za duża — PRZYTNIJ jej `text`
 *     (i `english`, jeśli jest). To świadomy kompromis: „nigdy nie tnij
 *     tekstu w połowie" i „plik zawsze ≤ MAX_BYTES" nie dają się dotrzymać
 *     jednocześnie, gdy JEDNA wiadomość sama przekracza cały limit (np.
 *     tysiące znaków nowej linii, które `JSON.stringify` eskejpuje do dwóch
 *     bajtów każdy). Wygrywa twardy limit rozmiaru — to on chroni dysk
 *     użytkownika przed plikiem bez górnej granicy, a obcięta wiadomość w
 *     najgorszym razie traci fragment treści, nie wywraca aplikacji.
 */
function enforceByteLimit(threads: ChatThread[]): ChatThread[] {
  let kept = threads
  while (kept.length > 1 && byteLength(kept) > MAX_BYTES) {
    kept = kept.slice(1)
  }

  const solo = kept[0]
  if (kept.length === 1 && solo !== undefined && byteLength(kept) > MAX_BYTES) {
    let messages = solo.messages
    while (messages.length > 1 && byteLength([{ ...solo, messages }]) > MAX_BYTES) {
      messages = messages.slice(1)
    }
    kept = [{ ...solo, messages }]
  }

  const only = kept[0]
  const lastMessage = only?.messages[0]
  if (kept.length === 1 && only !== undefined && lastMessage !== undefined
    && byteLength(kept) > MAX_BYTES) {
    kept = [{ ...only, messages: [shrinkToFit(only, lastMessage)] }]
  }

  return kept
}

/**
 * Szuka BINARNIE największej długości `text`/`english` (tej samej dla obu
 * pól — to wystarczy, żeby zmieścić się w limicie, a nie trzeba osobno
 * ważyć, które pole bardziej „kosztuje" po eskejpowaniu), przy której
 * wątek z tą jedną wiadomością mieści się w `MAX_BYTES`. Binarnie, nie znak
 * po znaku: wiadomość może mieć miliony znaków, a każde sprawdzenie
 * wymaga pełnej serializacji — liniowe cięcie byłoby zbyt wolne.
 */
function shrinkToFit(thread: ChatThread, message: ChatMessageRecord): ChatMessageRecord {
  const maxLen = Math.max(message.text.length, message.english?.length ?? 0)
  let lo = 0
  let hi = maxLen
  let best: ChatMessageRecord = sliceMessage(message, 0)
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const candidate = sliceMessage(message, mid)
    if (byteLength([{ ...thread, messages: [candidate] }]) <= MAX_BYTES) {
      best = candidate
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

const sliceMessage = (message: ChatMessageRecord, length: number): ChatMessageRecord => {
  const text = message.text.slice(0, length)
  return message.english === undefined
    ? { role: message.role, text }
    : { role: message.role, text, english: message.english.slice(0, length) }
}

const byteLength = (threads: ChatThread[]): number => Buffer.byteLength(serialize(threads), 'utf8')

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
