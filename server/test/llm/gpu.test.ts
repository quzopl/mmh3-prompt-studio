import { describe, it, expect } from 'vitest'
import { parseGpuLine, readGpu } from '../../src/llm/gpu.js'

describe('parseGpuLine', () => {
  it('parsuje prawdziwe wyjście nvidia-smi', () => {
    // Zmierzone na 154.54.100.218 (RTX PRO 6000 Blackwell), format
    // `--format=csv,noheader,nounits`.
    expect(parseGpuLine('NVIDIA RTX PRO 6000 Blackwell Server Edition, 10651, 97887'))
      .toEqual({ name: 'NVIDIA RTX PRO 6000 Blackwell Server Edition', usedMb: 10651, totalMb: 97887 })
  })

  it('nazwa karty z przecinkiem nie rozwala podziału', () => {
    // Ostatnie DWA pola to liczby; wszystko przed nimi jest nazwą. Podział z
    // założeniem trzech pól obciąłby tu nazwę do „NVIDIA GeForce RTX 4090".
    expect(parseGpuLine('NVIDIA GeForce RTX 4090, Founders, 1024, 24564'))
      .toEqual({ name: 'NVIDIA GeForce RTX 4090, Founders', usedMb: 1024, totalMb: 24564 })
  })

  it('wyjście bez liczb to null, nie zera', () => {
    expect(parseGpuLine('[N/A], [N/A], [N/A]')).toBeNull()
    expect(parseGpuLine('')).toBeNull()
    expect(parseGpuLine('NVIDIA, 10651')).toBeNull()
  })

  it('pusta nazwa to null — pomiar bez karty nie jest pomiarem', () => {
    expect(parseGpuLine(', 1024, 24564')).toBeNull()
  })
})

describe('readGpu', () => {
  it('brak polecenia to null, nie wyjątek', async () => {
    expect(await readGpu('polecenie-ktorego-nie-ma-nigdzie')).toBeNull()
  })

  it('polecenie kończące się błędem to null', async () => {
    expect(await readGpu('false')).toBeNull()
  })
})
