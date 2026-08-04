import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseProject, type Mode, type Project } from '@mmh3/shared'
import { assertInsideRoot, assetsDir, exportsDir, projectDir, projectFile, slugify } from './paths.js'
import { newProject } from './newProject.js'

export interface ProjectSummary {
  slug: string
  name: string
  mode: Mode
  updatedAt: string
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function projectExists(root: string, slug: string): Promise<boolean> {
  assertInsideRoot(root, projectDir(root, slug))
  return exists(projectFile(root, slug))
}

export async function createProject(
  root: string,
  name: string,
  mode: Mode,
): Promise<{ slug: string; project: Project }> {
  const slug = slugify(name)
  if (await exists(projectDir(root, slug))) {
    throw new Error(`Projekt o nazwie "${name}" już istnieje`)
  }
  await mkdir(assetsDir(root, slug), { recursive: true })
  await mkdir(exportsDir(root, slug), { recursive: true })
  const project = newProject(name, mode, slug)
  await writeProject(root, slug, project)
  return { slug, project }
}

/**
 * Zapisy tego samego projektu ustawiają się w kolejkę. Bez tego dwaj piszący
 * dzielą jeden plik tymczasowy: pierwszy zdąży z rename, a drugi dostanie
 * ENOENT. Kolejka jest per slug, więc różne projekty nadal zapisują się równolegle.
 */
const writeQueues = new Map<string, Promise<void>>()

export async function writeProject(root: string, slug: string, project: Project): Promise<void> {
  assertInsideRoot(root, projectDir(root, slug))
  const previous = writeQueues.get(slug) ?? Promise.resolve()
  const current = previous
    .catch(() => undefined)
    .then(() => writeProjectNow(root, slug, project))
  writeQueues.set(slug, current)
  try {
    await current
  } finally {
    if (writeQueues.get(slug) === current) writeQueues.delete(slug)
  }
}

async function writeProjectNow(root: string, slug: string, project: Project): Promise<void> {
  await mkdir(projectDir(root, slug), { recursive: true })
  // Zapis przez plik tymczasowy i rename: `writeFile` najpierw obcina plik, więc
  // przerwanie procesu w trakcie któregokolwiek z zapisów co 800 ms zostawiłoby
  // obcięty `project.json`. `rename` w obrębie jednego systemu plików jest
  // atomowe — czytelnik widzi albo poprzednią, albo nową całość, nigdy połowę.
  const target = projectFile(root, slug)
  const temporary = `${target}.tmp`
  await writeFile(temporary, `${JSON.stringify(project, null, 2)}\n`, 'utf8')
  await rename(temporary, target)
}

export async function readProject(root: string, slug: string): Promise<Project> {
  assertInsideRoot(root, projectDir(root, slug))
  const path = projectFile(root, slug)
  if (!await exists(path)) throw new Error(`Projekt "${slug}" nie istnieje`)
  return parseProject(JSON.parse(await readFile(path, 'utf8')))
}

export async function listProjects(root: string): Promise<ProjectSummary[]> {
  if (!await exists(root)) return []
  const entries = await readdir(root, { withFileTypes: true })
  const summaries: ProjectSummary[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = projectFile(root, entry.name)
    if (!await exists(path)) continue
    try {
      const project = parseProject(JSON.parse(await readFile(path, 'utf8')))
      const info = await stat(path)
      summaries.push({
        slug: entry.name,
        name: project.name,
        mode: project.mode,
        updatedAt: info.mtime.toISOString(),
      })
    } catch {
      // Uszkodzony plik nie może wywrócić listy pozostałych projektów.
      continue
    }
  }

  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function deleteProject(root: string, slug: string): Promise<void> {
  const dir = projectDir(root, slug)
  assertInsideRoot(root, dir)
  if (!await exists(dir)) throw new Error(`Projekt "${slug}" nie istnieje`)
  await rm(dir, { recursive: true, force: true })
}
