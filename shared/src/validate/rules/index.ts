import { registerRules } from '../registry.js'
import { timeRules } from './time.js'
import { cameraRules } from './camera.js'
import { speechRules } from './speech.js'
import { audioRules } from './audio.js'
import { refRules } from './ref.js'
import { anchorRules } from './anchors.js'

let registered = false

/** Rejestruje wszystkie rodziny reguł. Wielokrotne wywołanie nic nie zmienia. */
export function registerAllRules(): void {
  if (registered) return
  registerRules([
    ...timeRules, ...cameraRules, ...speechRules,
    ...audioRules, ...refRules, ...anchorRules,
  ])
  registered = true
}
