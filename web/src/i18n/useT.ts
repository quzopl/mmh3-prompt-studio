import { create } from 'zustand'
import { DICT, type Lang, type TKey } from './dict.js'

const STORAGE_KEY = 'mmh3.lang'

/**
 * Angielski jest domyślny, bo prompt i tak wychodzi po angielsku, a
 * dokumentacja projektu jest angielska. Polski zostaje pełnoprawnym wyborem —
 * raz wybrany, wraca po przeładowaniu, bo siedzi w `localStorage`.
 *
 * Testy NIE mogą polegać na tej wartości. Pakiet jednostkowy przypina język
 * jawnie w `web/test/setup.ts`, a scenariusze e2e klikają przełącznik na
 * starcie — inaczej zmiana tej jednej linii wywracałaby dwadzieścia kilka
 * plików testowych, a selektor po nazwie dostępności przestawałby cokolwiek
 * znajdować zamiast paść z sensownym komunikatem.
 */
export const readInitialLang = (): Lang => {
  const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
  return stored === 'en' || stored === 'pl' ? stored : 'en'
}

interface LangState {
  lang: Lang
  setLang: (lang: Lang) => void
}

export const useLang = create<LangState>(set => ({
  lang: readInitialLang(),
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
