import { describe, it, expect } from 'vitest'
import { alignmentLine } from '../../src/compile/alignment.js'
import { emitBase } from '../../src/compile/emitBase.js'
import type { Project } from '../../src/model/types.js'

const base: Project = {
  schemaVersion: 1, id: 'p', name: 'p', mode: 'T2VA',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Live-action, cinematic',
  assets: [], labels: [], speakers: [],
  shots: [{
    id: 's1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
    composition: '', body: [{ kind: 'text', text: 'a shot.' }],
    cameraMoves: [], dialogue: [], screenText: [], diegeticSfx: [], labelRefs: [], anchor: 'none',
  }],
  audio: { overallSoundscape: 'Rain.', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

describe('alignmentLine', () => {
  it('zwraca null dla T2VA', () => {
    expect(alignmentLine(base)).toBeNull()
  })

  it('buduje linię I2VA', () => {
    expect(alignmentLine({ ...base, mode: 'I2VA' })).toBe(
      'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.',
    )
  })

  it('buduje linię FL2VA z numerem ostatniego ujęcia i długością', () => {
    expect(alignmentLine({ ...base, mode: 'FL2VA' })).toBe(
      'How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the 8.00-second mark of the target video.',
    )
  })

  it('buduje linię L2VA', () => {
    expect(alignmentLine({ ...base, mode: 'L2VA', video: { ...base.video, durationMs: 6000 } })).toBe(
      'How the reference pictures align with the target video — <Picture 1> (from [Shot 1]) aligns with the 6.00-second mark of the target video.',
    )
  })

  it('używa numeru ostatniego ujęcia w FL2VA przy wielu ujęciach', () => {
    const p: Project = {
      ...base, mode: 'FL2VA',
      shots: [
        base.shots[0]!,
        { ...base.shots[0]!, id: 's2', index: 1, startMs: 4000 },
      ],
    }
    expect(alignmentLine(p)).toContain('Picture 2 (from Shot 2)')
  })

  it('liczy numer ostatniego ujęcia z indeksów, nie z liczby ujęć', () => {
    const p: Project = {
      ...base, mode: 'L2VA',
      shots: [
        base.shots[0]!,
        { ...base.shots[0]!, id: 's2', index: 4, startMs: 4000 },
      ],
    }
    expect(alignmentLine(p)).toContain('(from [Shot 5])')
  })
})

describe('emitBase', () => {
  it('składa T2VA bez linii instrukcji', () => {
    expect(emitBase(base)).toBe(
      'integrated_multimodal_description: [Shot 1] Live-action, cinematic, a shot.\n' +
      '\n' +
      'overall_soundscape: Rain.\n' +
      '\n' +
      'non_diegetic_music: N/A',
    )
  })

  it('wstawia linię instrukcji i pustą linię przed polami', () => {
    const out = emitBase({ ...base, mode: 'I2VA' })
    const lines = out.split('\n')
    expect(lines[0]).toContain('is fully referenced.')
    expect(lines[1]).toBe('')
    expect(lines[2]).toContain('integrated_multimodal_description:')
  })

  it('łączy ujęcia jedną spacją w jednym akapicie', () => {
    const p: Project = {
      ...base,
      shots: [
        base.shots[0]!,
        {
          ...base.shots[0]!, id: 's2', index: 1, startMs: 5000,
          body: [{ kind: 'text', text: 'another shot.' }],
        },
      ],
    }
    expect(emitBase(p)).toContain(
      'a shot. [Shot 2] At 00:05.000, the camera cuts to another shot.',
    )
  })
})
