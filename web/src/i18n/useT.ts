import { create } from 'zustand'
import { DICT, type Lang, type TKey } from './dict.js'

const STORAGE_KEY = 'mmh3.lang'

const initialLang = (): Lang => {
  const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
  return stored === 'en' || stored === 'pl' ? stored : 'pl'
}

interface LangState {
  lang: Lang
  setLang: (lang: Lang) => void
}

export const useLang = create<LangState>(set => ({
  lang: initialLang(),
  setLang: lang => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, lang)
    set({ lang })
  },
}))

export type Translate = (key: TKey, vars?: Record<string, string | number>) => string

/** Tłumaczenie z podstawieniem zmiennych w nawiasach klamrowych. */
export function useT(): Translate {
  const lang = useLang(state => state.lang)
  return (key, vars) => {
    const template = DICT[lang][key]
    if (template === undefined) return key
    if (!vars) return template
    return Object.entries(vars).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      template,
    )
  }
}
