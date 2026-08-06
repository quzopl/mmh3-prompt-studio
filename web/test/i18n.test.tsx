import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { DICT } from '../src/i18n/dict.js'
import { useT, readInitialLang, useLang } from '../src/i18n/useT.js'

beforeEach(() => {
  localStorage.clear()
  useLang.setState({ lang: 'pl' })
})

describe('słownik', () => {
  it('ma komplet kluczy w obu językach', () => {
    expect(Object.keys(DICT.en).sort()).toEqual(Object.keys(DICT.pl).sort())
  })

  it('nie zostawia pustych tłumaczeń', () => {
    for (const lang of ['pl', 'en'] as const) {
      for (const [key, value] of Object.entries(DICT[lang])) {
        expect(value.trim(), `${lang}.${key}`).not.toBe('')
      }
    }
  })
})

describe('useT', () => {
  it('tłumaczy na język bieżący', () => {
    const { result } = renderHook(() => useT())
    expect(result.current('app.title')).toBe('MMH3 Prompt Studio')
    expect(result.current('projects.new')).toBe('Nowy projekt')
  })

  it('przełącza język', () => {
    const { result: t } = renderHook(() => useT())
    const { result: lang } = renderHook(() => useLang())
    act(() => lang.current.setLang('en'))
    expect(t.current('projects.new')).toBe('New project')
  })

  it('podstawia zmienne', () => {
    const { result } = renderHook(() => useT())
    expect(result.current('validation.count', { count: 3 })).toContain('3')
  })

  it('zwraca klucz, gdy tłumaczenie nie istnieje', () => {
    const { result } = renderHook(() => useT())
    expect(result.current('nie.ma.takiego' as never)).toBe('nie.ma.takiego')
  })

  it('zapamiętuje wybór języka między sesjami', () => {
    const { result } = renderHook(() => useLang())
    act(() => result.current.setLang('en'))
    expect(localStorage.getItem('mmh3.lang')).toBe('en')
  })
})

describe('domyślny język', () => {
  /**
   * Reszta pakietu przypina język jawnie (`web/test/setup.ts`), żeby selektory
   * po polskich nazwach dostępności nie zależały od tej wartości. Ten test jest
   * jedynym miejscem, które ją sprawdza — bez niego zmiana domyślnego języka
   * przechodziłaby przez cały pakiet niezauważona.
   */
  it('bez zapisanego wyboru interfejs startuje po angielsku', () => {
    localStorage.removeItem('mmh3.lang')
    expect(readInitialLang()).toBe('en')
  })

  it('zapisany wybór wygrywa z domyślnym', () => {
    localStorage.setItem('mmh3.lang', 'pl')
    expect(readInitialLang()).toBe('pl')
  })

  it('śmieć w pamięci przeglądarki nie wywraca startu — wraca domyślny', () => {
    localStorage.setItem('mmh3.lang', 'klingoński')
    expect(readInitialLang()).toBe('en')
  })
})
