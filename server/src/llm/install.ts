import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface InstallProgress {
  stage: 'engine' | 'model'
  received: number
  total: number
}

/** Zapas ponad rozmiar pobrania. Zapełnienie dysku w połowie dziewiętnastu
 *  gigabajtów jest gorsze niż niezaczęcie pobierania. */
const FREE_SPACE_MARGIN = 1_073_741_824

export async function ensureFreeSpace(dir: string, needBytes: number): Promise<void> {
  await mkdir(dir, { recursive: true })
  const fs = await statfs(dir)
  const free = fs.bavail * fs.bsize
  const need = needBytes + FREE_SPACE_MARGIN
  if (free < need) {
    const gb = (bytes: number): string => (bytes / 1e9).toFixed(1)
    throw new Error(`Za mało miejsca: potrzeba ${gb(need)} GB, wolne ${gb(free)} GB`)
  }
}

/**
 * Pobieranie do pliku `.part` i `rename` na koniec — ten sam powód co w
 * `projectStore.ts`: przerwanie nie ma zostawić pliku, który WYGLĄDA na
 * kompletny. Plik częściowy pod nazwą docelową sprawiłby, że następne
 * uruchomienie uznałoby model za pobrany i podało llama.cpp uciętą binarną
 * kaszę.
 *
 * Wznawianie nie jest ostrożnością na zapas. Przy stawianiu serwera 2026-08-06
 * maszyna zrestartowała się w połowie 8,4 GB; bez nagłówka `Range` całe
 * pobieranie zaczynałoby się od zera.
 */
export async function downloadWithResume(
  url: string,
  target: string,
  onProgress: (received: number, total: number) => void,
  signal: AbortSignal,
): Promise<void> {
  const part = `${target}.part`
  await mkdir(join(target, '..'), { recursive: true })

  let already = 0
  try {
    already = (await stat(part)).size
  } catch {
    already = 0
  }

  const headers: Record<string, string> = {}
  if (already > 0) headers.range = `bytes=${already}-`

  const response = await fetch(url, { headers, signal })
  if (!response.ok) throw new Error(`Pobieranie nie powiodło się: ${response.status}`)
  if (response.body === null) throw new Error('Odpowiedź bez treści')

  // Serwer, który ZIGNOROWAŁ `Range` i odpowiedział dwusetką, wysyła plik OD
  // ZERA — dopisanie tego do istniejącego ogona dałoby plik uszkodzony bez
  // żadnego sygnału. Rozstrzyga kod odpowiedzi, nie nasza intencja.
  const resuming = response.status === 206
  const total = Number(response.headers.get('content-length') ?? 0) + (resuming ? already : 0)
  let received = resuming ? already : 0

  const sink = createWriteStream(part, { flags: resuming ? 'a' : 'w' })
  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  source.on('data', (chunk: Buffer) => {
    received += chunk.length
    onProgress(received, total)
  })
  await pipeline(source, sink)
  await rename(part, target)
}

/**
 * Szuka pliku w rozpakowanym wydaniu. Wydanie llama.cpp trzyma binarki w
 * podkatalogu nazwanym wersją, a jego układ nie jest gwarantowany między
 * wydaniami — szukamy, zamiast zgadywać ścieżkę i psuć się przy pierwszej
 * zmianie po stronie dostawcy.
 */
export async function findExecutable(dir: string, name: string): Promise<string | null> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return path
    if (entry.isDirectory()) {
      const found = await findExecutable(path, name)
      if (found !== null) return found
    }
  }
  return null
}

/**
 * Uruchomienie `--version` jako dowód, że binarka NAPRAWDĘ działa na tej
 * maszynie. Przy ręcznym stawianiu serwera skopiowałem samą binarkę bez
 * bibliotek stojących obok niej — nie uruchamiała się, a wyszło to dopiero
 * przy pierwszym zadaniu użytkownika. Dlatego rozpakowujemy CAŁE wydanie i
 * sprawdzamy je od razu, zanim zapiszemy ustawienia.
 */
export async function verifyEngine(binary: string): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    const done = (value: boolean): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const proc = spawn(binary, ['--version'])
      proc.on('error', () => done(false))
      proc.on('exit', code => done(code === 0))
    } catch {
      done(false)
    }
  })
}

/**
 * Rozpakowanie systemowym `tar`. Windows 10+ dostarcza `tar.exe` (bsdtar),
 * który radzi sobie także z archiwami ZIP — dzięki temu nie dokładamy
 * zależności tylko po to, żeby raz rozpakować archiwum.
 *
 * Archiwum znika po rozpakowaniu: waży kilkaset megabajtów i zostawienie go
 * podwajałoby miejsce zajęte przez silnik bez żadnego powodu.
 */
export async function extractArchive(archive: string, into: string): Promise<void> {
  await mkdir(into, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('tar', ['-xf', archive, '-C', into])
    proc.on('error', reject)
    proc.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`Rozpakowanie nie powiodło się (kod ${String(code)})`))
    })
  })
  await rm(archive, { force: true })
}
