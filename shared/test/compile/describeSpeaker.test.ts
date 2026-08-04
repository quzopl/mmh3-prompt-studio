import { describe, it, expect } from 'vitest'
import { describeSpeaker } from '../../src/compile/describeSpeaker.js'
import type { Speaker } from '../../src/model/types.js'

const baker: Speaker = {
  id: 'sp1', code: 'S1', characterType: 'baker', age: 'middle-aged', gender: 'male',
  pitch: 'low', timbre: 'slightly raspy', rate: 'calm', accent: 'neutral', onScreen: true,
  fullDescriptor: 'the middle-aged baker with a calm, slightly raspy voice',
  shortDescriptor: 'the baker',
}

describe('describeSpeaker', () => {
  it('odtwarza opis z przykładu guide dla kompletu pól', () => {
    expect(describeSpeaker(baker).full)
      .toBe('the middle-aged baker with a calm, slightly raspy voice')
  })

  it('buduje krótki opis z typu postaci', () => {
    expect(describeSpeaker(baker).short).toBe('the baker')
  })

  it('pomija puste pola zamiast zostawiać dziury', () => {
    const sparse: Speaker = { ...baker, age: '', rate: '', timbre: '' }
    expect(describeSpeaker(sparse).full).toBe('the baker')
  })

  it('radzi sobie z samą barwą głosu', () => {
    const onlyTimbre: Speaker = { ...baker, age: '', rate: '' }
    expect(describeSpeaker(onlyTimbre).full).toBe('the baker with a slightly raspy voice')
  })

  it('zwraca pusty opis, gdy nie ma nawet typu postaci', () => {
    const empty: Speaker = { ...baker, characterType: '', age: '', rate: '', timbre: '' }
    expect(describeSpeaker(empty).full).toBe('')
    expect(describeSpeaker(empty).short).toBe('')
  })
})
