import { describe, it, expect } from 'vitest'
import { renderSpeakerSegment } from '../../src/compile/renderSpeaker.js'
import { renderDialogue } from '../../src/compile/renderDialogue.js'
import { labelText } from '../../src/compile/renderLabel.js'
import type { DialogueEvent, Label, Speaker } from '../../src/model/types.js'

const speaker: Speaker = {
  id: 'sp1', code: 'S1', characterType: 'baker', age: 'middle-aged', gender: 'male',
  pitch: 'low', timbre: 'raspy', rate: 'calm', accent: 'neutral', onScreen: true,
  fullDescriptor: 'the middle-aged baker with a calm, slightly raspy voice',
  shortDescriptor: 'the baker',
}

const dlg = (over: Partial<DialogueEvent>): DialogueEvent => ({
  id: 'd1', speakerIds: ['sp1'], verb: 'says', punctuation: ':',
  language: 'English', text: 'First batch of the morning.',
  voiceover: false, sceneTransBefore: false, sceneTransAfter: false,
  cutoff: false, startMs: 0, endMs: 2000, ...over,
})

describe('renderSpeakerSegment', () => {
  it('renderuje pełny opis z ID', () => {
    expect(renderSpeakerSegment({ kind: 'speaker', speakerIds: ['sp1'], form: 'full' }, [speaker]))
      .toBe('the middle-aged baker with a calm, slightly raspy voice (S1)')
  })

  it('renderuje skrócony opis z ID', () => {
    expect(renderSpeakerSegment({ kind: 'speaker', speakerIds: ['sp1'], form: 'short' }, [speaker]))
      .toBe('the baker (S1)')
  })

  it('renderuje samo ID', () => {
    expect(renderSpeakerSegment({ kind: 'speaker', speakerIds: ['sp1'], form: 'idOnly' }, [speaker]))
      .toBe('(S1)')
  })

  it('nadpisanie descriptor ma pierwszeństwo', () => {
    expect(renderSpeakerSegment(
      { kind: 'speaker', speakerIds: ['sp1'], form: 'full', descriptor: 'the young woman with a quiet, breathy voice' },
      [speaker],
    )).toBe('the young woman with a quiet, breathy voice (S1)')
  })

  it('składa złożone ID dla grupy mówiącej jednocześnie', () => {
    const child2: Speaker = { ...speaker, id: 'sp2', code: 'S2' }
    expect(renderSpeakerSegment(
      { kind: 'speaker', speakerIds: ['sp1', 'sp2'], form: 'full', descriptor: 'The two children' },
      [speaker, child2],
    )).toBe('The two children (S1,S2)')
  })
})

describe('renderDialogue', () => {
  it('renderuje zwykłą kwestię z dwukropkiem', () => {
    expect(renderDialogue(dlg({}))).toBe('says: <d>[English] First batch of the morning.</d>')
  })

  it('renderuje kwestię z przecinkiem', () => {
    expect(renderDialogue(dlg({ verb: 'shout together', punctuation: ',', text: 'Wait for us!' })))
      .toBe('shout together, <d>[English] Wait for us!</d>')
  })

  it('renderuje voiceover z dokładną frazą i klauzulą o ustach', () => {
    expect(renderDialogue(dlg({
      voiceover: true, text: 'I still remember that road.',
      lipsClause: 'while his lips remain completely closed.',
    }))).toBe('says in an off-screen voiceover: <d>[English] I still remember that road.</d> while his lips remain completely closed.')
  })

  it('dodaje znacznik cutoff', () => {
    expect(renderDialogue(dlg({ cutoff: true })))
      .toBe('says: <d>[English] First batch of the morning.</d> <cutoff>')
  })

  it('dodaje scenetrans po obu stronach i zdanie o ciągłości', () => {
    expect(renderDialogue(dlg({
      sceneTransBefore: true, sceneTransAfter: true,
      continuityPhrase: 'carries over from the previous shot',
    }))).toBe('<scenetrans> says: <d>[English] First batch of the morning.</d> <scenetrans> carries over from the previous shot')
  })

  it('nie modyfikuje treści verbatim', () => {
    const text = '营业中… "ok"?!'
    expect(renderDialogue(dlg({ language: 'Chinese', text }))).toContain(`<d>[Chinese] ${text}</d>`)
  })

  it('łączy wielu mówców przecinkiem w ID przez segment mówcy, nie tutaj', () => {
    expect(renderDialogue(dlg({ speakerIds: ['sp1', 'sp2'] })))
      .toBe('says: <d>[English] First batch of the morning.</d>')
  })
})

describe('labelText', () => {
  const label = (over: Partial<Label>): Label => ({
    id: 'l1', kind: 'picture', index: 1, assetIds: [], definition: '', role: '',
    standalone: true, ...over,
  })

  it('renderuje w nawiasach kątowych', () => {
    expect(labelText(label({}), true)).toBe('<Picture 1>')
    expect(labelText(label({ kind: 'subject', index: 3 }), true)).toBe('<Subject 3>')
    expect(labelText(label({ kind: 'video', index: 1 }), true)).toBe('<Video 1>')
    expect(labelText(label({ kind: 'audio', index: 2 }), true)).toBe('<Audio 2>')
  })

  it('renderuje bez nawiasów, gdy proza tego wymaga', () => {
    expect(labelText(label({}), false)).toBe('Picture 1')
  })
})
