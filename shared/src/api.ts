import type { Project } from './model/types.js'
import type { Token } from './model/refs.js'
import { compile, type CompiledPrompt } from './compile/compile.js'
import { validate } from './validate/validate.js'
import { compileFailedRule, registerAllRules } from './validate/rules/index.js'
import { makeDiagnostic } from './validate/types.js'
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
  let compiled: CompiledPrompt
  let compileFailure: string | null = null
  try {
    compiled = compile(project)
  } catch (err) {
    // Model z wiszącą referencją jest uszkodzony, ale to właśnie wtedy
    // walidator ma najwięcej do powiedzenia — nie wolno go ubiec wyjątkiem.
    compiled = { text: '', tokens: [] }
    compileFailure = err instanceof Error ? err.message : String(err)
  }
  const diagnostics = validate(project, compiled)
  if (compileFailure) {
    diagnostics.unshift(makeDiagnostic(
      compileFailedRule,
      { kind: 'project', id: project.id },
      `Kompilacja przerwana: ${compileFailure}`,
      `Compilation aborted: ${compileFailure}`,
    ))
  }
  return { ...compiled, diagnostics }
}

/** Ostrzeżenia i wskazówki nie blokują eksportu — blokują tylko błędy. */
export function isExportReady(diagnostics: Diagnostic[]): boolean {
  return !diagnostics.some(d => d.severity === 'error')
}
