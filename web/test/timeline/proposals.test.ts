import { describe, expect, it } from 'vitest'
import { applyProposal, dialogueProposals } from '../../src/timeline/proposals.js'
import { baseProject, emptyShot, lineFixture } from './fixtures.js'

const withDialogue = (startMs: number, endMs: number, extra: Partial<ReturnType<typeof lineFixture>> = {}) =>
  baseProject([
    { ...emptyShot('a', 0, 0), dialogue: [{ ...lineFixture('d1', ['s1'], 'tekst', startMs, endMs), ...extra }] },
    emptyShot('b', 1, 4000),
  ])

describe('dialogueProposals', () => {
  it('proponuje scenetrans dla kwestii przechodzącej przez cięcie', () => {
    const result = dialogueProposals(withDialogue(3000, 5000))
    expect(result).toContainEqual({ eventId: 'd1', kind: 'scenetrans' })
  })

  it('nie proponuje scenetrans, gdy kwestia mieści się w jednym ujęciu', () => {
    expect(dialogueProposals(withDialogue(1000, 2000))).toEqual([])
  })

  it('nie proponuje scenetrans, gdy oba znaczniki już stoją', () => {
    const result = dialogueProposals(withDialogue(3000, 5000, { sceneTransBefore: true, sceneTransAfter: true }))
    expect(result.some(p => p.kind === 'scenetrans')).toBe(false)
  })

  it('proponuje cutoff dla kwestii wystającej poza materiał', () => {
    const result = dialogueProposals(withDialogue(7000, 9000))
    expect(result).toContainEqual({ eventId: 'd1', kind: 'cutoff' })
  })

  it('nie proponuje cutoff, gdy znacznik już stoi', () => {
    const result = dialogueProposals(withDialogue(7000, 9000, { cutoff: true }))
    expect(result.some(p => p.kind === 'cutoff')).toBe(false)
  })

  it('kwestia kończąca się dokładnie na końcu materiału nie wystaje', () => {
    expect(dialogueProposals(withDialogue(7000, 8000)).some(p => p.kind === 'cutoff')).toBe(false)
  })
})

describe('applyProposal', () => {
  it('scenetrans ustawia oba znaczniki', () => {
    const next = applyProposal(withDialogue(3000, 5000), { eventId: 'd1', kind: 'scenetrans' })
    const event = next.shots.flatMap(s => s.dialogue).find(e => e.id === 'd1')
    expect(event?.sceneTransBefore).toBe(true)
    expect(event?.sceneTransAfter).toBe(true)
  })

  it('cutoff ustawia swój znacznik i nie rusza pozostałych', () => {
    const next = applyProposal(withDialogue(7000, 9000), { eventId: 'd1', kind: 'cutoff' })
    const event = next.shots.flatMap(s => s.dialogue).find(e => e.id === 'd1')
    expect(event?.cutoff).toBe(true)
    expect(event?.sceneTransBefore).toBe(false)
  })

  it('propozycja o nieznanym identyfikatorze zwraca ten sam obiekt', () => {
    const project = withDialogue(1000, 2000)
    expect(applyProposal(project, { eventId: 'brak', kind: 'cutoff' })).toBe(project)
  })
})
