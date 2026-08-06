import { realpath } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

const DIACRITICS: Record<string, string> = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
}

/**
 * Sprowadza nazwę projektu do bezpiecznej nazwy katalogu.
 * Wynik nigdy nie zawiera separatorów ścieżki ani kropek wiodących, więc
 * nie da się nim wyjść poza katalog danych.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, ch => DIACRITICS[ch] ?? ch)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!slug) throw new Error(`Z nazwy "${name}" nie da się zbudować nazwy katalogu`)
  return slug
}

/**
 * Druga linia obrony. Trasy walidują kształt sluga, ale katalog danych jest
 * zbyt cenny, żeby polegać na jednym sprawdzeniu — `deleteProject` kasuje
 * rekurencyjnie.
 */
export function assertInsideRoot(root: string, candidate: string): void {
  const rel = relative(root, candidate)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Ścieżka "${candidate}" wychodzi poza katalogiem danych`)
  }
}

/**
 * Kontrola po rozwiązaniu dowiązań. `assertInsideRoot` porównuje ścieżki
 * leksykalnie, więc dowiązanie symboliczne o nazwie zgodnej ze schematem
 * wygląda dla niego na wnętrze projektu, a system plików prowadzi gdzie indziej.
 * Wymaga istniejącego pliku, dlatego używamy jej tylko na ścieżkach odczytu.
 */
export async function assertRealPathInside(root: string, candidate: string): Promise<void> {
  const realRoot = await realpath(root)
  const realCandidate = await realpath(candidate)
  assertInsideRoot(realRoot, realCandidate)
}

export const projectDir = (root: string, slug: string): string => join(root, slug)
export const projectFile = (root: string, slug: string): string =>
  join(projectDir(root, slug), 'project.json')
export const chatsFile = (root: string, slug: string): string =>
  join(projectDir(root, slug), 'chats.json')
export const assetsDir = (root: string, slug: string): string =>
  join(projectDir(root, slug), 'assets')
export const exportsDir = (root: string, slug: string): string =>
  join(projectDir(root, slug), 'exports')
