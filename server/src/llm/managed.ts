import { spawn, type ChildProcess } from 'node:child_process'
import { stat } from 'node:fs/promises'
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

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function validateManaged(settings: ManagedSettings): Promise<void> {
  if (!(await exists(settings.modelPath))) {
    throw new Error(`Nie znaleziono pliku modelu: ${settings.modelPath}`)
  }
  if (!(await exists(settings.serverBinary))) {
    throw new Error(`Nie znaleziono binarki serwera: ${settings.serverBinary}`)
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

/** Wybór portu z zakresu wysokiego. Nie sprawdzamy z góry, czy port jest
 * wolny — gdyby był zajęty, `llama-server` nie wstanie, sondowanie zdrowia
 * przekroczy czas (albo proces padnie i sam się zgłosi przez `exit`), a stan
 * i tak skończy jako `failed` z odpowiednim logiem w buforze. To wystarcza
 * dla aplikacji jednoosobowej — nie ma potrzeby dodatkowej logiki wykrywania
 * zajętości portu przed próbą. */
function pickPort(): number {
  return PORT_MIN + Math.floor(Math.random() * (PORT_MAX - PORT_MIN + 1))
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
  await validateManaged(settings)
  // Jeden serwer na instancję — nowe uruchomienie zastępuje poprzednie.
  await stopManaged()

  const port = pickPort()
  state = { status: 'starting', logs: [], port }

  // Tablica argumentów, nigdy `shell: true` — ścieżka ma zostać nazwą pliku,
  // nie fragmentem polecenia powłoki.
  const proc = spawn(settings.serverBinary, buildArgs(settings, port))
  child = proc

  proc.stdout?.on('data', ingest)
  proc.stderr?.on('data', ingest)

  proc.on('exit', (code, signal) => {
    // Proces potrafi umrzeć sam, bez wołania `stopManaged` — trzeba to
    // wykryć niezależnie, żeby stan nie pozostał w `starting` na zawsze.
    // Sprawdzenie `child === proc` odróżnia to zdarzenie od procesu, który
    // już został zastąpiony (albo zatrzymany) w międzyczasie.
    if (child === proc) {
      child = null
      state = { ...state, status: 'failed' }
    }
    appendLog(`Proces zakończył się (kod: ${code ?? 'brak'}, sygnał: ${signal ?? 'brak'})`)
  })

  proc.on('error', error => {
    if (child === proc) {
      child = null
      state = { ...state, status: 'failed' }
    }
    appendLog(`Błąd uruchomienia procesu: ${error.message}`)
  })

  const healthy = await probeHealth(port, proc)
  if (state.status === 'starting') {
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
