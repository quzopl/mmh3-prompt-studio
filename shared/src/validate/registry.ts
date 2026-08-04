import type { Rule } from './types.js'

const rules: Rule[] = []

export function registerRules(newRules: Rule[]): void {
  for (const rule of newRules) {
    if (rules.some(r => r.id === rule.id)) {
      throw new Error(`Reguła o identyfikatorze ${rule.id} jest już zarejestrowana`)
    }
    rules.push(rule)
  }
}

export function allRules(): Rule[] {
  return [...rules]
}
