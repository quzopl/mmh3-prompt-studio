import { describe, it, expect } from 'vitest'
import { fieldOp, fieldTextSchema } from '../../../src/llm/tasks/fieldTarget.js'

describe('fieldOp — operacja dla wskazanego pola', () => {
  it('etykieta jest parametrem, nie wpisana na stałe', () => {
    const op = fieldOp({ kind: 'style' }, 'Live-action', 'Etykieta z czatu.')
    expect(op.kind).toBe('setStyle')
    expect(op.label).toBe('Etykieta z czatu.')
    expect(op.kind === 'setStyle' && op.text).toBe('Live-action')
  })

  it('każdy z czterech celów daje operację swojego rodzaju', () => {
    expect(fieldOp({ kind: 'audio', field: 'nonDiegeticMusic' }, 'x', 'l').kind).toBe('setAudio')
    expect(fieldOp({ kind: 'speaker', speakerId: 's-1', field: 'shortDescriptor' }, 'x', 'l').kind)
      .toBe('setSpeakerDescriptor')
    expect(fieldOp({ kind: 'shotText', shotId: 'sh-1', segmentIndex: 0 }, 'x', 'l').kind)
      .toBe('setShotText')
  })

  it('identyfikatory operacji są różne dla dwóch wywołań', () => {
    const a = fieldOp({ kind: 'style' }, 'x', 'l')
    const b = fieldOp({ kind: 'style' }, 'x', 'l')
    expect(a.id).not.toBe(b.id)
  })
})

describe('fieldTextSchema — reguła treści zależna od pola', () => {
  it('pole audio dziedziczy limit zdań', () => {
    const schema = fieldTextSchema({ kind: 'audio', field: 'nonDiegeticMusic' })
    // MUSIC_SENTENCES dopuszcza 1–3 zdania.
    expect(schema.safeParse('One. Two. Three.').success).toBe(true)
    expect(schema.safeParse('One. Two. Three. Four.').success).toBe(false)
  })

  it('pole audio odrzuca blok dialogowy', () => {
    const schema = fieldTextSchema({ kind: 'audio', field: 'overallSoundscape' })
    expect(schema.safeParse('Rain falls. <d>[English] Hello.</d>').success).toBe(false)
  })

  it('pozostałe cele to zwykła proza bez limitu zdań', () => {
    const schema = fieldTextSchema({ kind: 'style' })
    expect(schema.safeParse('One. Two. Three. Four. Five.').success).toBe(true)
  })
})
