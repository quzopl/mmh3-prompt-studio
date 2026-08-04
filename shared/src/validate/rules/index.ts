import { defineRule, type Rule } from '../types.js'
import { registerRules } from '../registry.js'
import { timeRules } from './time.js'
import { cameraRules } from './camera.js'
import { speechRules } from './speech.js'
import { audioRules } from './audio.js'
import { refRules } from './ref.js'
import { anchorRules } from './anchors.js'

/**
 * Reguła-znacznik. Nigdy nie odpala się sama — diagnostykę o tym identyfikatorze
 * wystawia `buildPrompt`, gdy kompilacja przerwie się na uszkodzonym modelu.
 * Istnieje w rejestrze, żeby wyszukanie metadanych po `ruleId` (cytat z guide'a
 * w panelu walidacji) nie natrafiło na dziurę.
 */
export const compileFailedRule: Rule = defineRule({
  id: 'COMPILE_FAILED',
  severity: 'error',
  guideRef: 'spójność modelu',
  run: () => [],
})

let registered = false

/** Rejestruje wszystkie rodziny reguł. Wielokrotne wywołanie nic nie zmienia. */
export function registerAllRules(): void {
  if (registered) return
  registerRules([
    ...timeRules, ...cameraRules, ...speechRules,
    ...audioRules, ...refRules, ...anchorRules, compileFailedRule,
  ])
  registered = true
}
