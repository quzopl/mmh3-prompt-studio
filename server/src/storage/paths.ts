import { join } from 'node:path'

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

export const projectDir = (root: string, slug: string): string => join(root, slug)
export const projectFile = (root: string, slug: string): string =>
  join(projectDir(root, slug), 'project.json')
export const assetsDir = (root: string, slug: string): string =>
  join(projectDir(root, slug), 'assets')
export const exportsDir = (root: string, slug: string): string =>
  join(projectDir(root, slug), 'exports')
