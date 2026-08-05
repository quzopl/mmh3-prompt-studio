import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { runTask } from '../../src/llm/run.js'
import type { Provider } from '../../src/llm/provider.js'

const task = {
  name: 'test',
  schema: z.object({ liczba: z.number() }),
  jsonSchema: { type: 'object' },
  buildMessages: () => [{ role: 'user' as const, content: 'x' }],
  maxTokens: 100,
}

const providerReturning = (...texts: string[]): Provider => {
  let call = 0
  return {
    listModels: async () => [],
    complete: vi.fn(async () => {
      const text = texts[Math.min(call, texts.length - 1)] ?? ''
      call += 1
      return { text, promptTokens: 1, completionTokens: 2 }
    }),
  }
}

describe('runTask', () => {
  it('zwraca zwalidowaną wartość przy poprawnej odpowiedzi', async () => {
    const result = await runTask(providerReturning('{"liczba":5}'), task, {}, new AbortController().signal)
    expect(result.value.liczba).toBe(5)
    expect(result.repaired).toBe(false)
  })

  it('sumuje tokeny z obu prób przy naprawie', async () => {
    // Liczniki muszą się różnić między próbami — przy identycznych liczbach
    // (jak poprzednio: 1 i 2 za każdym razem) zliczenie samej pierwszej próby
    // dwa razy dałoby ten sam wynik co poprawne zsumowanie obu, więc test nic
    // by nie odróżniał.
    let call = 0
    const provider: Provider = {
      listModels: async () => [],
      complete: vi.fn(async () => {
        call += 1
        return call === 1
          ? { text: '{"liczba":"nie"}', promptTokens: 3, completionTokens: 5 }
          : { text: '{"liczba":5}', promptTokens: 7, completionTokens: 11 }
      }),
    }
    const result = await runTask(provider, task, {}, new AbortController().signal)
    expect(result.repaired).toBe(true)
    expect(result.promptTokens).toBe(10)
    expect(result.completionTokens).toBe(16)
  })

  it('próbuje dokładnie dwa razy, nie trzy', async () => {
    const provider = providerReturning('{"liczba":"nie"}')
    await expect(runTask(provider, task, {}, new AbortController().signal)).rejects.toThrow()
    expect(provider.complete).toHaveBeenCalledTimes(2)
  })

  it('druga próba niesie komunikat błędu z pierwszej', async () => {
    const provider = providerReturning('{"liczba":"nie"}', '{"liczba":5}')
    await runTask(provider, task, {}, new AbortController().signal)
    const second = vi.mocked(provider.complete).mock.calls[1]?.[0]
    const joined = second?.messages.map(m => m.content).join(' ') ?? ''
    expect(joined).toContain('liczba')
  })

  it('odpowiedź, która nie jest JSON-em, też idzie do naprawy', async () => {
    const result = await runTask(providerReturning('to nie JSON', '{"liczba":7}'), task, {}, new AbortController().signal)
    expect(result.value.liczba).toBe(7)
  })

  it('model owijający JSON w płotek z markdownu jest rozumiany', async () => {
    const result = await runTask(providerReturning('```json\n{"liczba":3}\n```'), task, {}, new AbortController().signal)
    expect(result.value.liczba).toBe(3)
  })

  it('przerwanie przekazuje sygnał do dostawcy', async () => {
    const controller = new AbortController()
    const provider = providerReturning('{"liczba":1}')
    await runTask(provider, task, {}, controller.signal)
    expect(vi.mocked(provider.complete).mock.calls[0]?.[0]?.signal).toBe(controller.signal)
  })
})

// Runda 1 poprawek po review: zdejmowanie płotka tylko wtedy, gdy owija całą
// odpowiedź, oraz rozdzielenie audytorium komunikatów (model po angielsku,
// użytkownik po polsku bez surowego tekstu bibliotek).
describe('runTask — zdejmowanie płotka tylko wokół całej odpowiedzi', () => {
  it('poprawny JSON z potrójnym grawisem wewnątrz wartości string nie jest okaleczany', async () => {
    // Odtwarza znalezisko z review: stara, nieotoczona regułą wersja szukała
    // ```...``` gdziekolwiek w tekście, więc trafiała też na przypadkowe
    // grawisy wewnątrz wartości i wycinała resztę poprawnej odpowiedzi.
    const withEmbeddedFence = JSON.stringify({ liczba: 5, cytat: '```kod```' })
    const result = await runTask(providerReturning(withEmbeddedFence), task, {}, new AbortController().signal)
    expect(result.value.liczba).toBe(5)
    expect(result.repaired).toBe(false)
  })

  it('płotek bez znacznika języka jest zdejmowany', async () => {
    const result = await runTask(providerReturning('```\n{"liczba":9}\n```'), task, {}, new AbortController().signal)
    expect(result.value.liczba).toBe(9)
    expect(result.repaired).toBe(false)
  })

  it('tekst przed albo po płotku nie jest już zdejmowany — odpowiedź uczciwie idzie do naprawy', async () => {
    const wrappedInProse = 'Oto wynik:\n```json\n{"liczba":11}\n```\nDzięki za cierpliwość'
    const result = await runTask(
      providerReturning(wrappedInProse, '{"liczba":11}'),
      task,
      {},
      new AbortController().signal,
    )
    expect(result.repaired).toBe(true)
    expect(result.value.liczba).toBe(11)
  })
})

describe('runTask — komunikaty rozdzielone dla modelu i dla użytkownika', () => {
  it('wiadomość naprawcza dla modelu jest po angielsku', async () => {
    const provider = providerReturning('{"liczba":"nie"}', '{"liczba":5}')
    await runTask(provider, task, {}, new AbortController().signal)
    const second = vi.mocked(provider.complete).mock.calls[1]?.[0]
    const joined = second?.messages.map(m => m.content).join(' ') ?? ''
    expect(joined).toContain('Validation error')
    expect(joined).toContain('Fix this')
  })

  it('błąd zgłaszany użytkownikowi jest po polsku, nazywa zadanie i pola, bez surowego tekstu Zoda', async () => {
    const provider = providerReturning('{"liczba":"nie"}')
    await expect(runTask(provider, task, {}, new AbortController().signal)).rejects.toThrow(
      /Zadanie „test": niezgodne pola: liczba\./,
    )
    try {
      await runTask(providerReturning('{"liczba":"nie"}'), task, {}, new AbortController().signal)
      throw new Error('powinno rzucić')
    } catch (error) {
      // Surowy komunikat Zoda dla tego przypadku to "Expected number,
      // received string" — nie ma prawa trafić do wyjątku czytanego przez
      // użytkownika.
      expect(String(error)).not.toContain('Expected number')
    }
  })

  it('błąd zgłaszany użytkownikowi przy niepoprawnym JSON-ie nie zawiera surowego tekstu JSON.parse', async () => {
    const provider = providerReturning('to nie JSON')
    await expect(runTask(provider, task, {}, new AbortController().signal)).rejects.toThrow(
      /Zadanie „test": odpowiedź modelu nie jest poprawnym JSON-em\./,
    )
    try {
      await runTask(providerReturning('to nie JSON'), task, {}, new AbortController().signal)
      throw new Error('powinno rzucić')
    } catch (error) {
      expect(String(error)).not.toContain('Unexpected token')
      expect(String(error)).not.toContain('JSON.parse')
    }
  })
})
