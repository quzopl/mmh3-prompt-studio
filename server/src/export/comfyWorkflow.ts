type Node = Record<string, unknown>

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Wstawia prompt do wskazanego pola węzła workflow ComfyUI.
 * Zwraca nowy obiekt — wejściowy zostaje nietknięty, żeby zapisany na dysku
 * szablon nie zmieniał się przy eksporcie.
 */
export function injectPrompt(
  workflow: unknown,
  nodeId: string,
  field: string,
  prompt: string,
): Record<string, unknown> {
  if (!isPlainObject(workflow)) {
    throw new Error('Workflow musi być obiektem JSON z węzłami pod kluczami')
  }

  const node = workflow[nodeId]
  if (!isPlainObject(node)) {
    throw new Error(`Workflow nie zawiera węzła o identyfikatorze "${nodeId}"`)
  }

  const target: Node = isPlainObject(node.inputs) ? node.inputs : node
  if (!Object.prototype.hasOwnProperty.call(target, field)) {
    throw new Error(`Węzeł "${nodeId}" nie ma pola "${field}"`)
  }

  const patchedTarget = { ...target, [field]: prompt }
  const patchedNode = isPlainObject(node.inputs)
    ? { ...node, inputs: patchedTarget }
    : patchedTarget

  return { ...workflow, [nodeId]: patchedNode }
}
