import type { Project } from '../model/types.js'
import type { ObjectRef } from '../model/refs.js'
import type { CompiledPrompt } from '../compile/compile.js'

export type Severity = 'error' | 'warning' | 'hint'

export interface Diagnostic {
  ruleId: string
  severity: Severity
  /** Komunikat po polsku. */
  message: string
  /** Komunikat po angielsku. */
  messageEn: string
  ref: ObjectRef
  /** Odwołanie do sekcji guide'a, np. "guide_base §4.3". */
  guideRef: string
}

export interface RuleContext {
  project: Project
  compiled: CompiledPrompt
}

export interface Rule {
  id: string
  severity: Severity
  guideRef: string
  run(ctx: RuleContext): Diagnostic[]
}

export function defineRule(rule: Rule): Rule {
  return rule
}

export function makeDiagnostic(
  rule: Pick<Rule, 'id' | 'severity' | 'guideRef'>,
  ref: ObjectRef,
  message: string,
  messageEn: string,
): Diagnostic {
  return {
    ruleId: rule.id,
    severity: rule.severity,
    message,
    messageEn,
    ref,
    guideRef: rule.guideRef,
  }
}
