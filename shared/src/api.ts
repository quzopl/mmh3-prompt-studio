import type { Project } from './model/types.js'
import type { Token } from './model/refs.js'
import { compile } from './compile/compile.js'
import { validate } from './validate/validate.js'
import { registerAllRules } from './validate/rules/index.js'
import type { Diagnostic } from './validate/types.js'

export { registerAllRules }

export interface PromptResult {
  text: string
  tokens: Token[]
  diagnostics: Diagnostic[]
}

/** Jedyne wejście dla aplikacji: kompiluje projekt i uruchamia pełny zestaw reguł. */
export function buildPrompt(project: Project): PromptResult {
  registerAllRules()
  const compiled = compile(project)
  return { ...compiled, diagnostics: validate(project, compiled) }
}

/** Ostrzeżenia i wskazówki nie blokują eksportu — blokują tylko błędy. */
export function isExportReady(diagnostics: Diagnostic[]): boolean {
  return !diagnostics.some(d => d.severity === 'error')
}
