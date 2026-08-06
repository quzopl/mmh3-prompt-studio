import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, readdir, rename, rm, stat, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { engineAssetFor, MODELS } from './catalog.js'
import { readSettings, writeSettings } from './settings.js'

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

/** Nazwa binarki zależy od systemu — na Windows wydanie niesie `.exe`. */
const ENGINE_BINARY = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Kolejność jest celowa: NAJPIERW silnik, potem model. Silnik waży ~200 MB, a
 * model do 19 GB — jeśli coś ma nie wyjść (nieobsługiwana platforma, binarka,
 * która się nie uruchamia na tej maszynie), lepiej, żeby wyszło po dwustu
 * megabajtach niż po dziewiętnastu gigabajtach.
 *
 * Oba kroki są POMIJANE, gdy plik już jest. Ponowne kliknięcie po nieudanej
 * instalacji nie pobiera od nowa tego, co się udało.
 */
export async function installEngineAndModel(opts: {
  runtimeRoot: string
  dataRoot: string
  modelId: string
  onProgress: (progress: InstallProgress) => void
  signal: AbortSignal
}): Promise<{ serverBinary: string; modelPath: string }> {
  const model = MODELS.find(candidate => candidate.id === opts.modelId)
  if (model === undefined) throw new Error(`Nie znam modelu "${opts.modelId}"`)

  const asset = engineAssetFor(process.platform, process.arch)
  if (asset === null) {
    throw new Error(
      `Brak gotowego silnika dla ${process.platform}/${process.arch}. `
      + 'Pobierz llama.cpp ręcznie i wskaż binarkę w ustawieniach.',
    )
  }

  const engineDir = join(opts.runtimeRoot, 'engine')
  const modelsDir = join(opts.runtimeRoot, 'models')

  let serverBinary = await findExecutable(engineDir, ENGINE_BINARY)
  if (serverBinary === null) {
    await ensureFreeSpace(engineDir, 400_000_000)
    const archive = join(engineDir, asset.name)
    await downloadWithResume(asset.url, archive, (received, total) => {
      opts.onProgress({ stage: 'engine', received, total })
    }, opts.signal)
    await extractArchive(archive, engineDir)
    serverBinary = await findExecutable(engineDir, ENGINE_BINARY)
    if (serverBinary === null) throw new Error('W pobranym wydaniu nie ma llama-server')
    await chmod(serverBinary, 0o755)
  }

  if (!await verifyEngine(serverBinary)) {
    throw new Error('Pobrany llama-server nie uruchamia się na tej maszynie')
  }

  const modelPath = join(modelsDir, model.fileName)
  if (!await exists(modelPath)) {
    await ensureFreeSpace(modelsDir, model.bytes)
    await downloadWithResume(model.url, modelPath, (received, total) => {
      opts.onProgress({ stage: 'model', received, total })
    }, opts.signal)
  }

  // Ustawienia zapisujemy DOPIERO tutaj — po weryfikacji silnika i po
  // kompletnym pobraniu modelu. Zapis wcześniej zostawiłby konfigurację
  // wskazującą na pliki, których nie ma albo które nie działają, a użytkownik
  // zobaczyłby „skonfigurowane" i błąd dopiero przy starcie serwera.
  const settings = await readSettings(opts.dataRoot)
  await writeSettings(opts.dataRoot, {
    ...settings,
    mode: 'managed',
    managed: { ...settings.managed, serverBinary, modelPath, gpuLayers: 99, contextSize: 8192 },
  })

  return { serverBinary, modelPath }
}
