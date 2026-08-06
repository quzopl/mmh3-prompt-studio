import { describe, it, expect } from 'vitest'
import { newProject } from '../../fixtures/newProject.js'
import {
  fieldChatTaskFor, fieldChatToPatch, fieldLabelFor, type FieldChatInput,
} from '../../../src/llm/tasks/fieldChat.js'

const style = { kind: 'style' } as const

describe('fieldChatTaskFor — schemat odpowiedzi', () => {
  it('sama proza bez propozycji zmiany jest poprawną odpowiedzią', () => {
    const parsed = fieldChatTaskFor(style).schema.safeParse({ reply: 'Wyjaśniam różnicę.' })
    expect(parsed.success).toBe(true)
  })

  it('pusta proza jest odrzucona — tura bez odpowiedzi dla człowieka nie ma po co istnieć', () => {
    expect(fieldChatTaskFor(style).schema.safeParse({ reply: '' }).success).toBe(false)
  })

  it('propozycja dla pola audio dziedziczy limit zdań', () => {
    const task = fieldChatTaskFor({ kind: 'audio', field: 'nonDiegeticMusic' })
    // MUSIC_SENTENCES dopuszcza 1–3 zdania.
    expect(task.schema.safeParse({ reply: 'ok', english: 'One. Two. Three.' }).success).toBe(true)
    expect(task.schema.safeParse({ reply: 'ok', english: 'One. Two. Three. Four.' }).success)
      .toBe(false)
  })

  it('propozycja dla pola audio odrzuca blok dialogowy', () => {
    const task = fieldChatTaskFor({ kind: 'audio', field: 'overallSoundscape' })
    expect(task.schema.safeParse({ reply: 'ok', english: 'Rain falls. <d>[English] Hi.</d>' }).success)
      .toBe(false)
  })

  it('to samo zdanie przechodzi dla pola bez limitu — reguła należy do POLA, nie do zadania', () => {
    // Ta sama treść, która wyżej odpadła dla `nonDiegeticMusic`. Gdyby limit
    // zdań był wpisany w zadanie zamiast pochodzić z `fieldTextSchema(target)`,
    // odpadłaby też tutaj.
    expect(fieldChatTaskFor(style).schema.safeParse({ reply: 'ok', english: 'One. Two. Three. Four.' }).success)
      .toBe(true)
  })
})

describe('fieldChatTaskFor — wiadomości', () => {
  const buildFor = (history: FieldChatInput['history']) =>
    fieldChatTaskFor(style).buildMessages({
      fieldLabel: 'visual style',
      current: 'Live-action',
      history,
      message: 'mocniej',
    } satisfies FieldChatInput)

  it('historia trafia do promptu jako osobne tury, w kolejności i z rolami', () => {
    const messages = buildFor([
      { role: 'user', text: 'dodaj deszcz' },
      { role: 'assistant', text: 'Dodałem deszcz.' },
    ])
    expect(messages.map(m => m.role)).toEqual(['system', 'user', 'user', 'assistant', 'user'])
    expect(messages[2]?.content).toBe('dodaj deszcz')
    expect(messages[3]?.content).toBe('Dodałem deszcz.')
    expect(messages[4]?.content).toBe('mocniej')
  })

  it('pusta historia daje trzy wiadomości: system, stan pola, polecenie', () => {
    expect(buildFor([]).map(m => m.role)).toEqual(['system', 'user', 'user'])
  })

  it('prompt systemowy niesie cztery rodziny efektów', () => {
    const system = buildFor([])[0]?.content.toLowerCase() ?? ''
    for (const family of ['lighting', 'weather', 'material', 'speed']) {
      expect(system).toContain(family)
    }
  })

  it('prompt systemowy zakazuje słów nastroju, wymieniając je z nazwy', () => {
    const system = buildFor([])[0]?.content ?? ''
    expect(system).toContain('melancholic')
    expect(system).toContain('dramatic')
  })

  it('bieżąca treść pola i jego nazwa trafiają do pierwszej wiadomości użytkownika', () => {
    const first = buildFor([])[1]?.content ?? ''
    expect(first).toContain('visual style')
    expect(first).toContain('Live-action')
  })

  it('puste polecenie jest odrzucone przez schemat wejścia', () => {
    expect(() => fieldChatTaskFor(style).buildMessages({
      fieldLabel: 'visual style', current: '', history: [], message: '',
    })).toThrow()
  })
})

describe('fieldChatToPatch', () => {
  it('brak propozycji daje pustą listę operacji', () => {
    expect(fieldChatToPatch({ reply: 'tylko odpowiadam' }, style, newProject()).ops).toEqual([])
  })

  it('propozycja identyczna z bieżącą treścią nie tworzy operacji', () => {
    const project = { ...newProject(), style: 'Live-action' }
    expect(fieldChatToPatch({ reply: 'ok', english: '  Live-action  ' }, style, project).ops)
      .toEqual([])
  })

  it('cel, którego nie da się rozwiązać w projekcie, nie tworzy operacji', () => {
    const target = { kind: 'speaker', speakerId: 'nie-istnieje', field: 'fullDescriptor' } as const
    expect(fieldChatToPatch({ reply: 'ok', english: 'A calm voice' }, target, newProject()).ops)
      .toEqual([])
  })

  it('propozycja zmiany daje jedną operację z etykietą rozmowy, nie redakcji', () => {
    const project = { ...newProject(), style: 'Live-action' }
    const ops = fieldChatToPatch({ reply: 'ok', english: 'Live-action, rain' }, style, project).ops
    expect(ops).toHaveLength(1)
    expect(ops[0]?.kind).toBe('setStyle')
    expect(ops[0]?.label).toContain('rozmowy')
    expect(ops[0]?.label).not.toContain('Redakcja')
  })
})

describe('fieldLabelFor', () => {
  it('nazywa pole po angielsku, bo trafia do promptu', () => {
    expect(fieldLabelFor(style)).toBe('visual style')
    expect(fieldLabelFor({ kind: 'audio', field: 'overallSoundscape' })).toBe('overall soundscape')
    expect(fieldLabelFor({ kind: 'audio', field: 'nonDiegeticMusic' })).toBe('non-diegetic music')
    expect(fieldLabelFor({ kind: 'shotText', shotId: 's1', segmentIndex: 0 })).toBe('shot description')
  })
})
