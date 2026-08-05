import { spawn, type ChildProcess } from 'node:child_process'
import { stat, access, constants as fsConstants } from 'node:fs/promises'
import { createServer } from 'node:net'
import type { LlmSettings } from './settings.js'

export interface ManagedState {
  status: 'stopped' | 'starting' | 'ready' | 'failed'
  logs: string[]
  port: number
}

type ManagedSettings = LlmSettings['managed']

/** Trzymamy tylko ostatnie 200 linii — model, który dużo mówi, nie ma prawa
 * zapełnić pamięci procesu nieograniczonym buforem logów. */
const MAX_LOG_LINES = 200

/** 30-gigabajtowy model wstaje wolno; 60 sekund z próbą co 500 ms daje mu
 * na to szansę, a jednocześnie nie trzyma żądania w nieskończoność. */
const HEALTH_TIMEOUT_MS = 60_000
const HEALTH_INTERVAL_MS = 500

/** SIGTERM ma czas, żeby proces zamknął się porządkowo (i zwolnił model z
 * pamięci); dopiero po tym czasie przychodzi SIGKILL. */
const STOP_GRACE_MS = 5_000

const PORT_MIN = 9900
const PORT_MAX = 9999

/**
 * Stan zarządzanego serwera jest celowo modułowy/globalny: ta aplikacja
 * uruchamia co najwyżej jeden `llama-server` na jedną instancję backendu —
 * to nie jest pula procesów i nikt nie powinien jej z tego robić. Kolejne
 * wywołanie `startManaged` zastępuje bieżący proces, nie dokłada drugiego.
 */
let state: ManagedState = { status: 'stopped', logs: [], port: 0 }
let child: ChildProcess | null = null

/**
 * Numer porządkowy przypisywany każdemu wywołaniu `startManaged`. Dwa
 * nachodzące na siebie starty (podwójny POST, albo stop-i-start w trakcie
 * wciąż trwającego sondowania poprzedniego) inaczej wyścigowo nadpisują
 * sobie nawzajem stan: spóźnione rozstrzygnięcie starszego wywołania może
 * wylądować już po tym, jak nowsze zdążyło dojść do `ready`. Tylko
 * wywołanie, którego token wciąż jest aktualny, ma prawo zapisać stan.
 */
let startSeq = 0

function appendLog(line: string): void {
  state.logs.push(line)
  if (state.logs.length > MAX_LOG_LINES) {
    state.logs.splice(0, state.logs.length - MAX_LOG_LINES)
  }
}

function ingest(chunk: Buffer): void {
  for (const line of chunk.toString('utf8').split('\n')) {
    if (line !== '') appendLog(line)
  }
}

/** Zwraca kopię stanu — wołający nie może przez referencję do `logs`
 * wyciec zmian z powrotem do modułu. */
export function managedState(): ManagedState {
  return { ...state, logs: [...state.logs] }
}

async function statOrNull(path: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(path)
  } catch {
    return null
  }
}

/** `stat` się udający nie znaczy „da się to uruchomić" — katalog podany
 * zamiast pliku wygląda na istniejący, ale `spawn` na nim zawiedzie dopiero
 * w środku procesu, dając niejasny `failed` zamiast czytelnego komunikatu
 * przed próbą. Sprawdzamy więc typ wpisu, a dla binarki dodatkowo prawo
 * wykonania — `access(X_OK)` liczy się z efektywnym użytkownikiem, czego
 * ręczne parsowanie bitów `stat().mode` by nie zrobiło poprawnie. */
export async function validateManaged(settings: ManagedSettings): Promise<void> {
  const modelInfo = await statOrNull(settings.modelPath)
  if (modelInfo === null) {
    throw new Error(`Nie znaleziono pliku modelu: ${settings.modelPath}`)
  }
  if (!modelInfo.isFile()) {
    throw new Error(`Ścieżka modelu nie jest plikiem: ${settings.modelPath}`)
  }

  const binInfo = await statOrNull(settings.serverBinary)
  if (binInfo === null) {
    throw new Error(`Nie znaleziono binarki serwera: ${settings.serverBinary}`)
  }
  if (!binInfo.isFile()) {
    throw new Error(`Ścieżka binarki serwera nie jest plikiem: ${settings.serverBinary}`)
  }
  try {
    await access(settings.serverBinary, fsConstants.X_OK)
  } catch {
    throw new Error(`Binarka serwera nie ma prawa wykonywania: ${settings.serverBinary}`)
  }
}

/** Argumenty jako osobne elementy tablicy trafiające prosto do `spawn` —
 * ścieżka ze średnikiem albo spacją zostaje jednym argumentem (nazwą pliku),
 * a nie zostaje sklejona w string i przepuszczona przez powłokę. */
export function buildArgs(settings: ManagedSettings, port: number): string[] {
  return [
    '--model', settings.modelPath,
    '--n-gpu-layers', String(settings.gpuLayers),
    '--ctx-size', String(settings.contextSize),
    '--port', String(port),
    '--host', '127.0.0.1',
  ]
}

/** Sprawdza, czy da się związać z portem na `127.0.0.1`, i natychmiast
 * zwalnia gniazdo — to tylko próba, właściwe wiązanie robi proces, który za
 * chwilę wystartujemy. */
function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const tester = createServer()
    tester.once('error', () => resolve(false))
    tester.once('listening', () => tester.close(() => resolve(true)))
    tester.listen(port, '127.0.0.1')
  })
}

/** Wybór portu z zakresu wysokiego, z realnym sprawdzeniem dostępności:
 * losujemy punkt startowy, a potem próbujemy po kolei — zajęty port (np.
 * inna instancja tej aplikacji już uruchomiona) nie kosztuje użytkownika
 * cichej minuty sondowania zdrowia, tylko od razu przechodzi do następnego
 * kandydata. Gdy cały zakres jest zajęty, mówimy to wprost zamiast
 * uruchamiać proces, który i tak nie zdoła się związać z portem. */
export async function pickAvailablePort(): Promise<number> {
  const span = PORT_MAX - PORT_MIN + 1
  const start = PORT_MIN + Math.floor(Math.random() * span)
  for (let offset = 0; offset < span; offset++) {
    const port = PORT_MIN + ((start - PORT_MIN + offset) % span)
    if (await isPortFree(port)) return port
  }
  throw new Error(`Wszystkie porty w zakresie ${PORT_MIN}–${PORT_MAX} są zajęte`)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function probeHealth(port: number, proc: ChildProcess): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
        signal: AbortSignal.timeout(HEALTH_INTERVAL_MS),
      })
      if (response.ok) return true
    } catch {
      // Serwer jeszcze nie odpowiada — normalne w trakcie wczytywania modelu.
    }
    // Proces, który już padł, nigdy nie odpowie — nie ma sensu czekać do
    // upływu pełnych 60 sekund, żeby to stwierdzić.
    if (proc.exitCode !== null || proc.signalCode !== null) return false
    await sleep(HEALTH_INTERVAL_MS)
  }
  return false
}

export async function startManaged(settings: ManagedSettings): Promise<ManagedState> {
  const seq = ++startSeq
  await validateManaged(settings)
  // Jeden serwer na instancję — nowe uruchomienie zastępuje poprzednie.
  await stopManaged()

  // Kolejne wywołanie `startManaged` mogło wyprzedzić nas w trakcie walidacji
  // albo zatrzymywania poprzedniego procesu — ono jest teraz właścicielem
  // stanu, więc wycofujemy się bez uruchamiania czegokolwiek.
  if (seq !== startSeq) return managedState()

  const port = await pickAvailablePort()

  if (seq !== startSeq) return managedState()

  state = { status: 'starting', logs: [], port }

  // Tablica argumentów, nigdy `shell: true` — ścieżka ma zostać nazwą pliku,
  // nie fragmentem polecenia powłoki.
  const proc = spawn(settings.serverBinary, buildArgs(settings, port))
  child = proc

  proc.stdout?.on('data', ingest)
  proc.stderr?.on('data', ingest)

  proc.on('exit', (code, signal) => {
    appendLog(`Proces zakończył się (kod: ${code ?? 'brak'}, sygnał: ${signal ?? 'brak'})`)
    // Proces potrafi umrzeć sam, bez wołania `stopManaged` — trzeba to
    // wykryć niezależnie, żeby stan nie pozostał w `starting` na zawsze.
    // Podwójny warunek: `child === proc` odróżnia to zdarzenie od procesu,
    // który już został zastąpiony albo świadomie zatrzymany (`stopManaged`
    // czyści `child` zanim wyśle sygnał, więc spóźniony `exit` po jawnym
    // zatrzymaniu tu nie trafia); `seq === startSeq`, żeby zdarzenie z
    // procesu wyścigowo wyprzedzonego przez nowszy start nie nadpisało
    // stanu, który należy już do tego nowszego wywołania.
    if (child === proc && seq === startSeq) {
      child = null
      state = { ...state, status: 'failed' }
    }
  })

  proc.on('error', error => {
    appendLog(`Błąd uruchomienia procesu: ${error.message}`)
    if (child === proc && seq === startSeq) {
      child = null
      state = { ...state, status: 'failed' }
    }
  })

  const healthy = await probeHealth(port, proc)
  // Tylko wywołanie, którego token wciąż jest aktualny, i tylko gdy stan
  // faktycznie wciąż czeka na rozstrzygnięcie — inaczej spóźniona sonda
  // nadpisałaby jawne zatrzymanie albo start, który już wygrał wyścig.
  if (seq === startSeq && state.status === 'starting') {
    state = { ...state, status: healthy ? 'ready' : 'failed' }
  }

  return managedState()
}

export async function stopManaged(): Promise<void> {
  const proc = child
  child = null
  state = { ...state, status: 'stopped' }

  if (proc === null) return
  if (proc.exitCode !== null || proc.signalCode !== null) return

  await new Promise<void>(resolve => {
    const onExit = (): void => {
      clearTimeout(killTimer)
      resolve()
    }
    // SIGTERM najpierw — daje procesowi szansę zamknąć się porządkowo i
    // zwolnić model z pamięci. Dopiero brak reakcji w ciągu 5 sekund
    // kończy się twardym SIGKILL.
    const killTimer = setTimeout(() => proc.kill('SIGKILL'), STOP_GRACE_MS)
    proc.once('exit', onExit)
    proc.kill('SIGTERM')
  })
}
