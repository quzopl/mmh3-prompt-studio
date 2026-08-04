import type { Project } from '../model/types.js'
import type { Token } from '../model/refs.js'
import { emitBase } from './emitBase.js'
import { emitRef } from './emitRef.js'
import { buildTokens } from './tokens.js'

export interface CompiledPrompt {
  text: string
  tokens: Token[]
}

export function compile(project: Project): CompiledPrompt {
  const text = project.mode === 'REF' ? emitRef(project) : emitBase(project)
  return { text, tokens: buildTokens(project, text) }
}
