import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Label } from '@mmh3/shared'
import { readProject } from '../../src/storage/projectStore.js'
import { newProject } from '../fixtures/newProject.js'

let root = ''

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mmh3-repair-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

const label = (id: string, index: number): Label => ({
  id, kind: 'subject', index, assetIds: [], definition: 'x', role: 'y', standalone: false,
})

describe('readProject naprawia powtórzone identyfikatory', () => {
  it('otwiera projekt z dwoma ujęciami o tym samym id i nadaje drugiemu nowe', async () => {
    const project = newProject()
    const first = project.shots[0]
    if (!first) throw new Error('fixture bez ujęć')
    const dir = join(root, 'zepsuty')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'project.json'),
      JSON.stringify({ ...project, shots: [first, { ...first, startMs: 4000 }] }),
    )

    const loaded = await readProject(root, 'zepsuty')

    expect(loaded.shots).toHaveLength(2)
    expect(new Set(loaded.shots.map(s => s.id)).size).toBe(2)
    expect(loaded.shots[0]?.id).toBe(first.id)
  })

  it('nie tworzy kolizji, gdy sufiks, którego użyłaby naprawa, już istnieje w pliku', async () => {
    // Plik już zawiera 'x' i 'x-dup2' (np. po wcześniejszej naprawie), a teraz
    // dochodzi drugie 'x'. Naiwne doklejenie '-dup2' nadałoby dwóm etykietom
    // ten sam identyfikator — naprawa musi szukać dalej, aż trafi na wolny.
    const project = newProject()
    const dir = join(root, 'sufiksy')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'project.json'),
      JSON.stringify({ ...project, labels: [label('x', 1), label('x-dup2', 2), label('x', 3)] }),
    )

    const loaded = await readProject(root, 'sufiksy')

    const ids = loaded.labels.map(l => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['x', 'x-dup2', 'x-dup3'])
  })

  it('nie przepisuje referencji przy zmianie id — po naprawie wskazują jednoznacznie na ocalały egzemplarz', async () => {
    // Naprawa zmienia tylko `id` w rodzinie, w której wykryła duplikat — nie
    // przeszukuje reszty projektu w poszukiwaniu miejsc, które mogły na ten
    // identyfikator wskazywać (shot.labelRefs, segmenty 'label', ref.retention).
    // To decyzja świadoma: obie zduplikowane etykiety i tak były nierozróżnialne
    // dla każdej referencji trzymającej wspólne id, więc po naprawie referencja
    // jednoznacznie trafia w ocalały pierwszy egzemplarz, a drugi (przemianowany)
    // staje się nieużywany, ale projekt pozostaje spójny i otwiera się bez błędu.
    const project = newProject()
    const first = project.shots[0]
    if (!first) throw new Error('fixture bez ujęć')
    const shotWithRef = {
      ...first,
      labelRefs: ['dup'],
      body: [{ kind: 'label', labelId: 'dup', bracketed: false }],
    }
    const dir = join(root, 'referencje')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'project.json'),
      JSON.stringify({
        ...project,
        shots: [shotWithRef],
        labels: [label('dup', 1), label('dup', 2)],
      }),
    )

    const loaded = await readProject(root, 'referencje')

    expect(loaded.labels.map(l => l.id)).toEqual(['dup', 'dup-dup2'])
    expect(loaded.shots[0]?.labelRefs).toEqual(['dup'])
  })
})
