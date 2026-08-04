import type { Project } from '../model/types.js'
import type { CompiledPrompt } from '../compile/compile.js'
import type { Diagnostic, Rule, Severity } from './types.js'
import { allRules } from './registry.js'

const ORDER: Record<Severity, number> = { error: 0, warning: 1, hint: 2 }

export function validateWith(
  rules: Rule[],
  project: Project,
  compiled: CompiledPrompt,
): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const rule of rules) {
    try {
      out.push(...rule.run({ project, compiled }))
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      out.push({
        ruleId: rule.id,
        severity: 'error',
        message: `Reguła ${rule.id} zgłosiła wyjątek: ${detail}`,
        messageEn: `Rule ${rule.id} threw: ${detail}`,
        ref: { kind: 'project', id: project.id },
        guideRef: rule.guideRef,
      })
    }
  }
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
}

export function validate(project: Project, compiled: CompiledPrompt): Diagnostic[] {
  return validateWith(allRules(), project, compiled)
}
