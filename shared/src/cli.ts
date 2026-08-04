import { readFileSync } from 'node:fs'
import { parseProject } from './model/schema.js'
import { buildPrompt, isExportReady } from './api.js'

const path = process.argv[2]
if (!path) {
  console.error('Użycie: mmh3c <ścieżka/project.json>')
  process.exit(2)
}

const project = parseProject(JSON.parse(readFileSync(path, 'utf8')))
const { text, diagnostics } = buildPrompt(project)

console.log(text)

if (diagnostics.length > 0) {
  console.error('')
  console.error(`Diagnostyka (${diagnostics.length}):`)
  for (const d of diagnostics) {
    console.error(`  [${d.severity}] ${d.ruleId} (${d.ref.kind}:${d.ref.id}) — ${d.message}`)
    console.error(`      źródło: ${d.guideRef}`)
  }
}

process.exit(isExportReady(diagnostics) ? 0 : 1)
