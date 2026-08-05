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
    const result = await runTask(providerReturning('{"liczba":"nie"}', '{"liczba":5}'), task, {}, new AbortController().signal)
    expect(result.repaired).toBe(true)
    expect(result.promptTokens).toBe(2)
    expect(result.completionTokens).toBe(4)
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
