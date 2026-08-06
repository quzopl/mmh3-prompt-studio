import { describe, it, expect } from 'vitest'
import { DEFAULT_MODEL_ID, engineAssetFor, LLAMA_RELEASE, MODELS } from '../../src/llm/catalog.js'

describe('MODELS', () => {
  it('trzy pozycje, każda z rozmiarem, wymaganym VRAM i adresem', () => {
    expect(MODELS).toHaveLength(3)
    for (const model of MODELS) {
      expect(model.bytes).toBeGreaterThan(1e9)
      expect(model.vramMb).toBeGreaterThan(0)
      expect(model.url.startsWith('https://huggingface.co/')).toBe(true)
      expect(model.fileName.endsWith('.gguf')).toBe(true)
    }
  })

  it('domyślny model istnieje w katalogu', () => {
    expect(MODELS.some(model => model.id === DEFAULT_MODEL_ID)).toBe(true)
  })

  it('identyfikatory są unikalne', () => {
    expect(new Set(MODELS.map(m => m.id)).size).toBe(MODELS.length)
  })

  it('adres kończy się TĄ SAMĄ nazwą pliku, którą zapiszemy na dysku', () => {
    // Rozjazd między nazwą w adresie a `fileName` dałby plik zapisany pod inną
    // nazwą, niż szuka go potem instalacja — i pobieranie ruszałoby od nowa
    // przy każdym kliknięciu.
    for (const model of MODELS) {
      expect(model.url.endsWith(model.fileName)).toBe(true)
    }
  })
})

describe('engineAssetFor', () => {
  it('Linux dostaje wariant Vulkan — działa na NVIDII bez toolkitu CUDA', () => {
    expect(engineAssetFor('linux', 'x64')?.name)
      .toBe(`llama-${LLAMA_RELEASE}-bin-ubuntu-vulkan-x64.tar.gz`)
    expect(engineAssetFor('linux', 'arm64')?.name)
      .toBe(`llama-${LLAMA_RELEASE}-bin-ubuntu-vulkan-arm64.tar.gz`)
  })

  it('macOS i Windows dostają swoje warianty', () => {
    expect(engineAssetFor('darwin', 'arm64')?.name)
      .toBe(`llama-${LLAMA_RELEASE}-bin-macos-arm64.tar.gz`)
    expect(engineAssetFor('darwin', 'x64')?.name)
      .toBe(`llama-${LLAMA_RELEASE}-bin-macos-x64.tar.gz`)
    expect(engineAssetFor('win32', 'x64')?.name)
      .toBe(`llama-${LLAMA_RELEASE}-bin-win-cpu-x64.zip`)
  })

  it('rodzaj archiwum zgadza się z rozszerzeniem', () => {
    expect(engineAssetFor('linux', 'x64')?.archive).toBe('tar')
    expect(engineAssetFor('win32', 'x64')?.archive).toBe('zip')
  })

  it('nieobsługiwana kombinacja to null — nie pobieramy 200 MB czegoś, co nie ruszy', () => {
    expect(engineAssetFor('win32', 'arm64')).toBeNull()
    expect(engineAssetFor('freebsd', 'x64')).toBeNull()
    expect(engineAssetFor('linux', 's390x')).toBeNull()
  })

  it('adres wskazuje PRZYPIĘTE wydanie, nie „latest"', () => {
    // 2026-08-06 najnowsze wydanie llama.cpp niosło WYŁĄCZNIE binaria Windows,
    // więc „latest" wywróciłby pobieranie na Linuksie.
    const asset = engineAssetFor('linux', 'x64')
    expect(asset?.url).toContain(`/download/${LLAMA_RELEASE}/`)
    expect(asset?.url).not.toContain('latest')
    expect(LLAMA_RELEASE).toMatch(/^b\d+$/)
  })
})
