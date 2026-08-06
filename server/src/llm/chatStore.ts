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
 * Sufit długości POJEDYNCZEJ wiadomości. Polecenie użytkownika w realnym
 * użyciu nigdy nie jest tak długie, a odpowiedź modelu ma z góry ograniczoną
 * długość przez `maxTokens: 900` w zadaniu czatu (ok. 3600 znaków) — 8000 to
 * zapas ponad obie strony. Dzięki temu jeden wątek to najwyżej
 * `20 × 8000 ≈ 160 000` znaków, czyli zawsze mniej niż `MAX_BYTES`, więc
 * warunek `kept.length > 1` w pętli limitu bajtów NIGDY nie musi ustąpić
 * przed pojedynczym, przewymiarowanym wątkiem — niezmiennik „plik ≤
 * MAX_BYTES" trzyma się zawsze, nie tylko zwykle.
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

  // Limit bajtów zdejmuje CAŁE najstarsze wątki (od początku tablicy, czyli od
  // najdawniej założonych), nie tnie tekstu w połowie — obcięty JSON nie dałby
  // się odczytać, a obcięta wiadomość kłamałaby o tym, co użytkownik napisał.
  // Warunek `kept.length > 1` sam w sobie NIE gwarantowałby zejścia pod
  // `MAX_BYTES`, gdyby pojedynczy wątek mógł być dowolnie duży — dlatego
  // każda wiadomość jest już wcześniej przycięta do `MAX_MESSAGE_CHARS`
  // (patrz `truncateMessage`), co ogranicza jeden wątek do ok. 160 000
  // znaków i czyni ten warunek wystarczającym w każdym przypadku.
  let kept = trimmed
  while (kept.length > 1 && serialize(kept).length > MAX_BYTES) {
    kept = kept.slice(1)
  }
  await writeRaw(root, slug, kept)
}

/** Przycina `text` i `english` do `MAX_MESSAGE_CHARS` — patrz komentarz przy stałej. */
function truncateMessage(message: ChatMessageRecord): ChatMessageRecord {
  const text = message.text.slice(0, MAX_MESSAGE_CHARS)
  return message.english === undefined
    ? { role: message.role, text }
    : { role: message.role, text, english: message.english.slice(0, MAX_MESSAGE_CHARS) }
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
