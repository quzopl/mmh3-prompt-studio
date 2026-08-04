import { describe, it, expect } from 'vitest'
import { injectPrompt } from '../../src/export/comfyWorkflow.js'

const workflow = {
  '3': { class_type: 'CLIPTextEncode', inputs: { text: 'stary prompt', clip: ['4', 0] } },
  '4': { class_type: 'CheckpointLoader', inputs: { ckpt_name: 'model.safetensors' } },
}

describe('injectPrompt', () => {
  it('podmienia pole w inputs wskazanego węzła', () => {
    const out = injectPrompt(workflow, '3', 'text', 'nowy prompt')
    expect((out['3'] as any).inputs.text).toBe('nowy prompt')
  })

  it('nie rusza pozostałych węzłów ani pól', () => {
    const out = injectPrompt(workflow, '3', 'text', 'nowy prompt')
    expect((out['3'] as any).inputs.clip).toEqual(['4', 0])
    expect(out['4']).toEqual(workflow['4'])
  })

  it('nie modyfikuje wejściowego obiektu', () => {
    injectPrompt(workflow, '3', 'text', 'nowy prompt')
    expect(workflow['3'].inputs.text).toBe('stary prompt')
  })

  it('pisze wprost do węzła, gdy nie ma sekcji inputs', () => {
    const flat = { '7': { text: 'stary' } }
    expect((injectPrompt(flat, '7', 'text', 'nowy')['7'] as any).text).toBe('nowy')
  })

  it('zgłasza błąd dla nieznanego węzła', () => {
    expect(() => injectPrompt(workflow, '99', 'text', 'x')).toThrow(/węz/i)
  })

  it('zgłasza błąd dla nieznanego pola', () => {
    expect(() => injectPrompt(workflow, '3', 'nie_ma', 'x')).toThrow(/pol/i)
  })

  it('odrzuca workflow, który nie jest obiektem', () => {
    expect(() => injectPrompt([], '3', 'text', 'x')).toThrow(/workflow/i)
    expect(() => injectPrompt(null, '3', 'text', 'x')).toThrow(/workflow/i)
  })

  it('nazwa pola z prototypu nie udaje istniejącego pola', () => {
    for (const field of ['toString', 'valueOf', 'constructor', 'hasOwnProperty']) {
      expect(() => injectPrompt(workflow, '3', field, 'x'), field).toThrow(/pol/i)
    }
  })
})
