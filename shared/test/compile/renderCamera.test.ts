import { describe, it, expect } from 'vitest'
import { renderCameraMove } from '../../src/compile/renderCamera.js'
import { CAMERA_MOTIONS } from '../../src/vocab/camera.js'
import type { CameraMove } from '../../src/model/types.js'

const move = (over: Partial<CameraMove>): CameraMove => ({
  id: 'c1', type: 'push-in', startMs: 0, endMs: 1000, ...over,
})

describe('słownik kamery', () => {
  it('zawiera 20 wartości w 12 kategoriach', () => {
    expect(CAMERA_MOTIONS).toHaveLength(20)
    expect(new Set(CAMERA_MOTIONS.map(m => m.category)).size).toBe(12)
  })
})

describe('renderCameraMove', () => {
  it('składa typ, amplitudę i prędkość', () => {
    expect(renderCameraMove(move({ type: 'push-in', amplitude: 'small', speed: 'slow' })))
      .toBe('The camera pushes in with small amplitude at slow speed')
  })

  it('dokleja cel frazy', () => {
    expect(renderCameraMove(move({
      type: 'push-in', amplitude: 'small', speed: 'slow',
      target: 'toward the folded letter in her hands',
    }))).toBe('The camera pushes in with small amplitude at slow speed toward the folded letter in her hands')
  })

  it('pomija amplitudę i prędkość, gdy nie podano', () => {
    expect(renderCameraMove(move({ type: 'static', target: 'as the runner exits the frame' })))
      .toBe('The camera holds a static shot as the runner exits the frame')
  })

  it('renderuje pan right z dużą amplitudą i szybko', () => {
    expect(renderCameraMove(move({ type: 'pan-right', amplitude: 'large', speed: 'fast' })))
      .toBe('The camera pans right with large amplitude at fast speed')
  })

  it('renderuje truck right', () => {
    expect(renderCameraMove(move({ type: 'truck-right', amplitude: 'small', speed: 'slow' })))
      .toBe('The camera trucks right with small amplitude at slow speed')
  })

  it('renderuje pull out', () => {
    expect(renderCameraMove(move({ type: 'pull-out', amplitude: 'small', speed: 'slow' })))
      .toBe('The camera pulls out with small amplitude at slow speed')
  })

  it('customPhrase nadpisuje całość', () => {
    expect(renderCameraMove(move({ customPhrase: 'The lens drifts sideways' })))
      .toBe('The lens drifts sideways')
  })
})
