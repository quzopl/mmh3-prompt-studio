import { spawn } from 'node:child_process'

export interface GpuInfo {
  name: string
  usedMb: number
  totalMb: number
}

const QUERY = ['--query-gpu=name,memory.used,memory.total', '--format=csv,noheader,nounits']

/**
 * Ostatnie DWA pola to liczby, wszystko przed nimi to nazwa. Podział po
 * przecinku z założeniem dokładnie trzech pól psuje się na kartach, których
 * nazwa sama zawiera przecinek — a nazwy pochodzą od producenta, nie od nas.
 */
export function parseGpuLine(line: string): GpuInfo | null {
  const parts = line.split(',').map(part => part.trim())
  if (parts.length < 3) return null
  const totalMb = Number(parts[parts.length - 1])
  const usedMb = Number(parts[parts.length - 2])
  const name = parts.slice(0, -2).join(', ')
  if (!Number.isFinite(totalMb) || !Number.isFinite(usedMb) || name === '') return null
  return { name, usedMb, totalMb }
}

/**
 * `null` znaczy „nie wiem" i obejmuje wszystkie powody naraz: brak
 * `nvidia-smi`, kod wyjścia inny niż zero, wyjście, którego nie da się
 * sparsować. Interfejs na `null` nie pokazuje linijki VRAM w ogóle — zero
 * udające pomiar jest gorsze niż brak pomiaru (ta sama zasada, którą
 * `useLlmRun` stosuje do liczników tokenów: `null` to kreska, nie zero).
 *
 * Nazwa polecenia jest parametrem, żeby test mógł podstawić polecenie
 * nieistniejące i takie, które kończy się błędem, nie polegając na tym, czy
 * maszyna testowa ma kartę NVIDIA.
 */
export async function readGpu(command = 'nvidia-smi'): Promise<GpuInfo | null> {
  return new Promise(resolve => {
    let out = ''
    let settled = false
    const done = (value: GpuInfo | null): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const proc = spawn(command, QUERY)
      proc.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString() })
      // `error` łapie brak polecenia; `exit` — kod wyjścia. Bez pierwszego
      // `spawn` nieistniejącego polecenia wywróciłby proces serwera.
      proc.on('error', () => done(null))
      proc.on('exit', code => {
        if (code !== 0) return done(null)
        const first = out.split('\n').find(line => line.trim() !== '')
        done(first === undefined ? null : parseGpuLine(first))
      })
    } catch {
      done(null)
    }
  })
}
