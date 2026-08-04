import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { slugify, projectDir } from '../../src/storage/paths.js'
import {
  createProject, listProjects, readProject, writeProject, deleteProject,
} from '../../src/storage/projectStore.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmh3-test-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('slugify', () => {
  it('sprowadza nazwę do bezpiecznej postaci', () => {
    expect(slugify('Piekarnia o świcie')).toBe('piekarnia-o-swicie')
    expect(slugify('  Test   123  ')).toBe('test-123')
    expect(slugify('Ćma/Żubr\\Łoś')).toBe('cma-zubr-los')
  })

  it('odrzuca nazwę, z której nic nie zostaje', () => {
    expect(() => slugify('///')).toThrow(/nazw/i)
  })

  it('nie pozwala wyjść poza katalog danych', () => {
    expect(slugify('../../etc/passwd')).toBe('etc-passwd')
  })
})

describe('createProject', () => {
  it('tworzy katalog, plik projektu i podkatalogi', async () => {
    const { slug, project } = await createProject(root, 'Piekarnia o świcie', 'T2VA')
    expect(slug).toBe('piekarnia-o-swicie')
    expect(project.name).toBe('Piekarnia o świcie')
    expect(project.mode).toBe('T2VA')
    expect(project.video.durationMs).toBe(8000)
    expect(project.shots).toHaveLength(1)
    expect(project.shots[0]!.index).toBe(0)
    expect(project.shots[0]!.startMs).toBe(0)

    const raw = await readFile(join(projectDir(root, slug), 'project.json'), 'utf8')
    expect(JSON.parse(raw).name).toBe('Piekarnia o świcie')
  })

  it('odrzuca drugi projekt o tej samej nazwie', async () => {
    await createProject(root, 'Duplikat', 'T2VA')
    await expect(createProject(root, 'Duplikat', 'T2VA')).rejects.toThrow(/istnieje/i)
  })
})

describe('listProjects', () => {
  it('zwraca pustą listę dla pustego katalogu', async () => {
    expect(await listProjects(root)).toEqual([])
  })

  it('wypisuje projekty od ostatnio zmienionego', async () => {
    // Odstepy sa konieczne: sortowanie opiera sie na czasie modyfikacji pliku,
    // ktorego rozdzielczosc na niektorych systemach plikow wynosi milisekundy.
    const wait = () => new Promise(resolve => setTimeout(resolve, 10))
    const first = await createProject(root, 'Pierwszy', 'T2VA')
    await wait()
    await createProject(root, 'Drugi', 'REF')
    await wait()
    await createProject(root, 'Trzeci', 'I2VA')
    await wait()
    await writeProject(root, first.slug, { ...first.project, name: 'Pierwszy' })

    const list = await listProjects(root)
    expect(list.map(p => p.slug)).toEqual(['pierwszy', 'trzeci', 'drugi'])
  })

  it('pomija katalogi bez pliku projektu zamiast się wywracać', async () => {
    await createProject(root, 'Poprawny', 'T2VA')
    await mkdir(join(root, 'smiec'), { recursive: true })
    expect((await listProjects(root)).map(p => p.slug)).toEqual(['poprawny'])
  })
})

describe('readProject', () => {
  it('waliduje wczytany plik schematem', async () => {
    const { slug } = await createProject(root, 'Uszkodzony', 'T2VA')
    await writeFile(join(projectDir(root, slug), 'project.json'), '{"schemaVersion":1}', 'utf8')
    await expect(readProject(root, slug)).rejects.toThrow()
  })

  it('zgłasza czytelny błąd dla nieistniejącego projektu', async () => {
    await expect(readProject(root, 'nie-ma')).rejects.toThrow(/nie istnieje/i)
  })
})

describe('writeProject', () => {
  it('nadpisuje projekt i odświeża czas modyfikacji pliku', async () => {
    const { slug, project } = await createProject(root, 'Zapis', 'T2VA')
    const before = (await listProjects(root))[0]!.updatedAt
    await new Promise(resolve => setTimeout(resolve, 10))
    await writeProject(root, slug, { ...project, name: 'Zapis 2' })
    const reloaded = await readProject(root, slug)
    expect(reloaded.name).toBe('Zapis 2')
    expect((await listProjects(root))[0]!.updatedAt >= before).toBe(true)
  })
})

describe('deleteProject', () => {
  it('usuwa projekt wraz z katalogiem', async () => {
    const { slug } = await createProject(root, 'Do usuniecia', 'T2VA')
    await deleteProject(root, slug)
    expect(await listProjects(root)).toEqual([])
  })

  it('zgłasza błąd dla nieistniejącego projektu', async () => {
    await expect(deleteProject(root, 'nie-ma')).rejects.toThrow(/nie istnieje/i)
  })
})
