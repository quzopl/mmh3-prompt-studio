import { describe, expect, it } from 'vitest'
import { applyOps } from '../../src/patch/apply.js'
import { describeOp } from '../../src/patch/describe.js'
import { newProject } from '../fixtures/newProject.js'
import type { PatchOp } from '../../src/patch/types.js'
import type { Speaker } from '../../src/model/types.js'

const project = () => newProject()

const speaker: Speaker = {
  id: 'sp1', code: 'S1', characterType: 'woman', age: '30s', gender: 'female',
  pitch: 'mid', timbre: 'warm', rate: 'even', accent: 'neutral', onScreen: true,
  fullDescriptor: 'a woman in a blue coat', shortDescriptor: '',
}

describe('applyOps', () => {
  it('pusta lista zwraca ten sam obiekt', () => {
    const p = project()
    expect(applyOps(p, [])).toBe(p)
  })

  it('setAudio zmienia wskazane pole i nie rusza drugiego', () => {
    const next = applyOps(project(), [
      { kind: 'setAudio', id: 'o1', label: 'x', field: 'overallSoundscape', text: 'rain on glass' },
    ])
    expect(next.audio.overallSoundscape).toBe('rain on glass')
    expect(next.audio.nonDiegeticMusic).toBe(project().audio.nonDiegeticMusic)
  })

  it('operacja o nieznanym celu zwraca projekt bez zmian', () => {
    const p = project()
    expect(applyOps(p, [
      { kind: 'setSpeakerDescriptor', id: 'o1', label: 'x', speakerId: 'brak', field: 'fullDescriptor', text: 'y' },
    ])).toBe(p)
  })

  it('operacje stosują się w kolejności', () => {
    const next = applyOps(project(), [
      { kind: 'setStyle', id: 'o1', label: 'x', text: 'pierwszy' },
      { kind: 'setStyle', id: 'o2', label: 'y', text: 'drugi' },
    ])
    expect(next.style).toBe('drugi')
  })

  it('setShotText poza zakresem segmentów nic nie psuje', () => {
    const p = project()
    const shotId = p.shots[0]?.id ?? ''
    expect(applyOps(p, [
      { kind: 'setShotText', id: 'o1', label: 'x', shotId, segmentIndex: 99, text: 'y' },
    ])).toBe(p)
  })

  it('setShotText na segmencie innego rodzaju niż tekst nic nie zmienia', () => {
    const base = project()
    const shotId = base.shots[0]?.id ?? ''
    const p = {
      ...base,
      shots: [
        { ...(base.shots[0] ?? { id: shotId }), body: [{ kind: 'camera', moveId: 'm1' }] },
      ],
    } as typeof base
    expect(applyOps(p, [
      { kind: 'setShotText', id: 'o1', label: 'x', shotId, segmentIndex: 0, text: 'nie powinno się zapisać' },
    ])).toBe(p)
  })

  it('replaceShots podmienia całą listę', () => {
    const p = project()
    const shots = [{ ...(p.shots[0] ?? { id: 'a' }), composition: 'nowe' }] as typeof p.shots
    expect(applyOps(p, [{ kind: 'replaceShots', id: 'o1', label: 'x', shots }]).shots[0]).toBeDefined()
  })
})

describe('describeOp', () => {
  it('opisuje zmianę pola dźwięku po obu stronach', () => {
    const op: PatchOp = { kind: 'setAudio', id: 'o1', label: 'x', field: 'overallSoundscape', text: 'nowe' }
    const described = describeOp(project(), op)
    expect(described.after).toContain('nowe')
  })

  it('pusta wartość czyta się jako nieopisana, nie jako pusty ciąg', () => {
    const p = project()
    expect(p.audio.overallSoundscape).toBe('')
    const withEmptyBefore = describeOp(p, {
      kind: 'setAudio', id: 'o1', label: 'x', field: 'overallSoundscape', text: 'deszcz na szybie',
    })
    expect(withEmptyBefore.before).not.toBe('')
    const withEmptyAfter = describeOp(p, {
      kind: 'setStyle', id: 'o2', label: 'x', text: '',
    })
    expect(withEmptyAfter.after).not.toBe('')
  })

  it('setStyle pokazuje prawdziwą bieżącą wartość jako "przed"', () => {
    const p = project()
    const described = describeOp(p, { kind: 'setStyle', id: 'o1', label: 'x', text: 'nowy styl' })
    expect(described.before).toBe(p.style)
    expect(described.after).toBe('nowy styl')
  })

  it('setSpeakerDescriptor pokazuje prawdziwy opis mówcy jako "przed"', () => {
    const p = { ...project(), speakers: [speaker] }
    const described = describeOp(p, {
      kind: 'setSpeakerDescriptor', id: 'o1', label: 'x', speakerId: 'sp1', field: 'fullDescriptor', text: 'nowy opis',
    })
    expect(described.before).toBe('a woman in a blue coat')
    expect(described.after).toBe('nowy opis')
  })

  it('setShotText pokazuje bieżący i proponowany tekst segmentu', () => {
    const base = project()
    const shotId = base.shots[0]?.id ?? ''
    const p = {
      ...base,
      shots: [{ ...(base.shots[0] ?? { id: shotId }), body: [{ kind: 'text', text: 'stary tekst' }] }],
    } as typeof base
    const described = describeOp(p, {
      kind: 'setShotText', id: 'o1', label: 'x', shotId, segmentIndex: 0, text: 'nowy tekst',
    })
    expect(described.before).toBe('stary tekst')
    expect(described.after).toBe('nowy tekst')
  })

  it('setShotText na segmencie innego rodzaju niż tekst mówi to wprost zamiast pokazywać diff', () => {
    const base = project()
    const shotId = base.shots[0]?.id ?? ''
    const p = {
      ...base,
      shots: [{ ...(base.shots[0] ?? { id: shotId }), body: [{ kind: 'camera', moveId: 'm1' }] }],
    } as typeof base
    const described = describeOp(p, {
      kind: 'setShotText', id: 'o1', label: 'x', shotId, segmentIndex: 0, text: 'nie zastosuje się',
    })
    expect(described.before).toBe(described.after)
    expect(described.before).not.toBe('')
    expect(described.before).not.toBe('nie zastosuje się')
  })

  it('replaceShots przy równej liczbie ujęć pokazuje, ile faktycznie się różni', () => {
    const p = project()
    const original = p.shots[0]
    if (original === undefined) throw new Error('fixture bez ujęcia')
    const shots = [{ ...original, composition: 'zupełnie inna kompozycja' }]
    const described = describeOp(p, { kind: 'replaceShots', id: 'o1', label: 'x', shots })
    expect(described.before).toContain('1')
    expect(described.after).toContain('1')
    expect(described.after).toContain('zmienionych: 1')
  })
})
