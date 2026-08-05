import { describe, expect, it } from 'vitest'
import { applyOps } from '../../src/patch/apply.js'
import { describeOp } from '../../src/patch/describe.js'
import { newProject } from '../fixtures/newProject.js'
import type { PatchOp } from '../../src/patch/types.js'
import type { Label, RetentionEntry, Shot, Speaker } from '../../src/model/types.js'

const project = () => newProject()

const speaker: Speaker = {
  id: 'sp1', code: 'S1', characterType: 'woman', age: '30s', gender: 'female',
  pitch: 'mid', timbre: 'warm', rate: 'even', accent: 'neutral', onScreen: true,
  fullDescriptor: 'a woman in a blue coat', shortDescriptor: '',
}

const label: Label = {
  id: 'lab1', kind: 'subject', index: 1, assetIds: [],
  definition: 'a woman in a blue coat, 30s', role: 'main character', standalone: true,
}

const retentionEntry: RetentionEntry = {
  id: 'ret1', labelId: 'lab1', scope: '', marker: 'fully_preserved', note: 'coat and face must stay identical',
}

/** Ujęcie z minimalnym, poprawnym kształtem — do nadpisywania w pojedynczych testach. */
const shotStub = (overrides: Partial<Shot> = {}): Shot => ({
  id: 'stub', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
  composition: '', body: [], cameraMoves: [], dialogue: [], screenText: [], diegeticSfx: [],
  labelRefs: [], anchors: [],
  ...overrides,
})

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

  it('setAudio z tą samą wartością zwraca ten sam obiekt', () => {
    const p = project()
    expect(applyOps(p, [
      { kind: 'setAudio', id: 'o1', label: 'x', field: 'nonDiegeticMusic', text: p.audio.nonDiegeticMusic },
    ])).toBe(p)
  })

  it('setAudio z inną wartością zwraca nowy obiekt', () => {
    const p = project()
    const next = applyOps(p, [
      { kind: 'setAudio', id: 'o1', label: 'x', field: 'nonDiegeticMusic', text: 'cicho' },
    ])
    expect(next).not.toBe(p)
    expect(next.audio.nonDiegeticMusic).toBe('cicho')
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

  it('setStyle z tą samą wartością zwraca ten sam obiekt', () => {
    const p = project()
    expect(applyOps(p, [{ kind: 'setStyle', id: 'o1', label: 'x', text: p.style }])).toBe(p)
  })

  it('setStyle z inną wartością zwraca nowy obiekt', () => {
    const p = project()
    const next = applyOps(p, [{ kind: 'setStyle', id: 'o1', label: 'x', text: 'inny styl' }])
    expect(next).not.toBe(p)
    expect(next.style).toBe('inny styl')
  })

  it('setSpeakerDescriptor z tym samym opisem zwraca ten sam obiekt', () => {
    const p = { ...project(), speakers: [speaker] }
    expect(applyOps(p, [
      {
        kind: 'setSpeakerDescriptor', id: 'o1', label: 'x',
        speakerId: speaker.id, field: 'fullDescriptor', text: speaker.fullDescriptor,
      },
    ])).toBe(p)
  })

  it('setSpeakerDescriptor z innym opisem zwraca nowy obiekt', () => {
    const p = { ...project(), speakers: [speaker] }
    const next = applyOps(p, [
      {
        kind: 'setSpeakerDescriptor', id: 'o1', label: 'x',
        speakerId: speaker.id, field: 'fullDescriptor', text: 'inny opis',
      },
    ])
    expect(next).not.toBe(p)
    expect(next.speakers[0]?.fullDescriptor).toBe('inny opis')
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

  it('setShotText z tą samą treścią zwraca ten sam obiekt', () => {
    const base = project()
    const shotId = base.shots[0]?.id ?? ''
    const p = {
      ...base,
      shots: [{ ...(base.shots[0] ?? shotStub()), body: [{ kind: 'text', text: 'stary tekst' }] }],
    } as typeof base
    expect(applyOps(p, [
      { kind: 'setShotText', id: 'o1', label: 'x', shotId, segmentIndex: 0, text: 'stary tekst' },
    ])).toBe(p)
  })

  it('setShotText z inną treścią zapisuje nowy tekst', () => {
    const base = project()
    const shotId = base.shots[0]?.id ?? ''
    const p = {
      ...base,
      shots: [{ ...(base.shots[0] ?? shotStub()), body: [{ kind: 'text', text: 'stary tekst' }] }],
    } as typeof base
    const next = applyOps(p, [
      { kind: 'setShotText', id: 'o1', label: 'x', shotId, segmentIndex: 0, text: 'nowy tekst' },
    ])
    expect(next).not.toBe(p)
    expect(next.shots[0]?.body[0]).toEqual({ kind: 'text', text: 'nowy tekst' })
  })

  it('setLabelField z tą samą treścią zwraca ten sam obiekt', () => {
    const p = { ...project(), labels: [label] }
    expect(applyOps(p, [
      { kind: 'setLabelField', id: 'o1', label: 'x', labelId: label.id, field: 'definition', text: label.definition },
    ])).toBe(p)
  })

  it('setLabelField z inną treścią zapisuje ją w polu wskazanym przez "field", nie rusza drugiego', () => {
    const p = { ...project(), labels: [label] }
    const next = applyOps(p, [
      { kind: 'setLabelField', id: 'o1', label: 'x', labelId: label.id, field: 'role', text: 'the protagonist' },
    ])
    expect(next).not.toBe(p)
    expect(next.labels[0]?.role).toBe('the protagonist')
    expect(next.labels[0]?.definition).toBe(label.definition)
  })

  it('setLabelField wskazujący nieistniejącą etykietę zwraca projekt bez zmian', () => {
    const p = { ...project(), labels: [label] }
    expect(applyOps(p, [
      { kind: 'setLabelField', id: 'o1', label: 'x', labelId: 'brak', field: 'definition', text: 'y' },
    ])).toBe(p)
  })

  it('setRetentionText (scope: summary) z tą samą treścią zwraca ten sam obiekt', () => {
    const p = project()
    expect(applyOps(p, [
      { kind: 'setRetentionText', id: 'o1', label: 'x', scope: { kind: 'summary' }, text: p.ref.summaryText },
    ])).toBe(p)
  })

  it('setRetentionText (scope: summary) z inną treścią podmienia ref.summaryText', () => {
    const p = project()
    const next = applyOps(p, [
      { kind: 'setRetentionText', id: 'o1', label: 'x', scope: { kind: 'summary' }, text: 'preserve the coat and face' },
    ])
    expect(next).not.toBe(p)
    expect(next.ref.summaryText).toBe('preserve the coat and face')
  })

  it('setRetentionText (scope: entry) z tą samą treścią zwraca ten sam obiekt', () => {
    const p = { ...project(), ref: { ...project().ref, retention: [retentionEntry] } }
    expect(applyOps(p, [
      {
        kind: 'setRetentionText', id: 'o1', label: 'x',
        scope: { kind: 'entry', entryId: retentionEntry.id }, text: retentionEntry.note,
      },
    ])).toBe(p)
  })

  it('setRetentionText (scope: entry) z inną treścią podmienia note wskazanego wpisu, nie rusza reszty wpisu', () => {
    const p = { ...project(), ref: { ...project().ref, retention: [retentionEntry] } }
    const next = applyOps(p, [
      {
        kind: 'setRetentionText', id: 'o1', label: 'x',
        scope: { kind: 'entry', entryId: retentionEntry.id }, text: 'new note',
      },
    ])
    expect(next).not.toBe(p)
    expect(next.ref.retention[0]?.note).toBe('new note')
    expect(next.ref.retention[0]?.marker).toBe(retentionEntry.marker)
  })

  it('setRetentionText (scope: entry) wskazujący nieistniejący wpis zwraca projekt bez zmian', () => {
    const p = { ...project(), ref: { ...project().ref, retention: [retentionEntry] } }
    expect(applyOps(p, [
      { kind: 'setRetentionText', id: 'o1', label: 'x', scope: { kind: 'entry', entryId: 'brak' }, text: 'y' },
    ])).toBe(p)
  })

  it('replaceShots z tą samą referencją tablicy ujęć zwraca ten sam obiekt', () => {
    const p = project()
    expect(applyOps(p, [{ kind: 'replaceShots', id: 'o1', label: 'x', shots: p.shots }])).toBe(p)
  })

  it('replaceShots podmienia całą listę na jakościowo inną — inna liczba i inna treść', () => {
    const p = project()
    const shots: Shot[] = [
      shotStub({ id: 'new-a', composition: 'zupełnie nowe pierwsze ujęcie' }),
      shotStub({ id: 'new-b', composition: 'zupełnie nowe drugie ujęcie' }),
    ]
    const next = applyOps(p, [{ kind: 'replaceShots', id: 'o1', label: 'x', shots }])
    expect(next).not.toBe(p)
    expect(next.shots).toHaveLength(2)
    expect(next.shots[0]?.composition).toBe('zupełnie nowe pierwsze ujęcie')
    expect(next.shots[1]?.composition).toBe('zupełnie nowe drugie ujęcie')
  })
})

describe('describeOp', () => {
  it('opisuje zmianę pola dźwięku po obu stronach', () => {
    const op: PatchOp = { kind: 'setAudio', id: 'o1', label: 'x', field: 'overallSoundscape', text: 'nowe' }
    const described = describeOp(project(), op)
    expect(described.after).toContain('nowe')
  })

  it('pusta wartość czyta się jako dosłowny placeholder, nie jako pusty ciąg', () => {
    const p = project()
    expect(p.audio.overallSoundscape).toBe('')
    const withEmptyBefore = describeOp(p, {
      kind: 'setAudio', id: 'o1', label: 'x', field: 'overallSoundscape', text: 'deszcz na szybie',
    })
    expect(withEmptyBefore.before).toBe('(nieopisane)')
    const withEmptyAfter = describeOp(p, {
      kind: 'setStyle', id: 'o2', label: 'x', text: '',
    })
    expect(withEmptyAfter.after).toBe('(nieopisane)')
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

  it('setShotText poza zakresem segmentów i na złym rodzaju segmentu mówią różne rzeczy', () => {
    const base = project()
    const shotId = base.shots[0]?.id ?? ''
    const outOfRange = describeOp(base, {
      kind: 'setShotText', id: 'o1', label: 'x', shotId, segmentIndex: 99, text: 'y',
    })
    const wrongKindProject = {
      ...base,
      shots: [{ ...(base.shots[0] ?? { id: shotId }), body: [{ kind: 'camera', moveId: 'm1' }] }],
    } as typeof base
    const wrongKind = describeOp(wrongKindProject, {
      kind: 'setShotText', id: 'o1', label: 'x', shotId, segmentIndex: 0, text: 'y',
    })
    expect(outOfRange.before).not.toBe(wrongKind.before)
  })

  it('setLabelField pokazuje prawdziwą treść etykiety jako "przed"', () => {
    const p = { ...project(), labels: [label] }
    const described = describeOp(p, {
      kind: 'setLabelField', id: 'o1', label: 'x', labelId: label.id, field: 'definition', text: 'nowa definicja',
    })
    expect(described.before).toBe(label.definition)
    expect(described.after).toBe('nowa definicja')
  })

  it('setLabelField wskazujący nieistniejącą etykietę mówi to wprost zamiast pokazywać diff', () => {
    const p = { ...project(), labels: [label] }
    const described = describeOp(p, {
      kind: 'setLabelField', id: 'o1', label: 'x', labelId: 'brak', field: 'definition', text: 'y',
    })
    expect(described.before).toBe(described.after)
    expect(described.before).not.toBe('')
    expect(described.before).not.toBe('y')
  })

  it('setRetentionText (scope: summary) pokazuje prawdziwe ref.summaryText jako "przed"', () => {
    const p = { ...project(), ref: { ...project().ref, summaryText: 'stare podsumowanie' } }
    const described = describeOp(p, {
      kind: 'setRetentionText', id: 'o1', label: 'x', scope: { kind: 'summary' }, text: 'nowe podsumowanie',
    })
    expect(described.before).toBe('stare podsumowanie')
    expect(described.after).toBe('nowe podsumowanie')
  })

  it('setRetentionText (scope: entry) pokazuje prawdziwe note wpisu jako "przed"', () => {
    const p = { ...project(), ref: { ...project().ref, retention: [retentionEntry] } }
    const described = describeOp(p, {
      kind: 'setRetentionText', id: 'o1', label: 'x',
      scope: { kind: 'entry', entryId: retentionEntry.id }, text: 'nowa notatka',
    })
    expect(described.before).toBe(retentionEntry.note)
    expect(described.after).toBe('nowa notatka')
  })

  it('setRetentionText (scope: entry) wskazujący nieistniejący wpis mówi to wprost zamiast pokazywać diff', () => {
    const p = { ...project(), ref: { ...project().ref, retention: [retentionEntry] } }
    const described = describeOp(p, {
      kind: 'setRetentionText', id: 'o1', label: 'x', scope: { kind: 'entry', entryId: 'brak' }, text: 'y',
    })
    expect(described.before).toBe(described.after)
    expect(described.before).not.toBe('')
    expect(described.before).not.toBe('y')
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
