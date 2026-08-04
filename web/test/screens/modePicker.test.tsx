import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModePicker } from '../../src/screens/ModePicker.js'
import { MODE_INFO } from '../../src/i18n/modes.js'
import { useLang } from '../../src/i18n/useT.js'

beforeEach(() => useLang.setState({ lang: 'pl' }))

describe('MODE_INFO', () => {
  it('opisuje wszystkie pięć trybów w obu językach', () => {
    for (const mode of ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF'] as const) {
      for (const lang of ['pl', 'en'] as const) {
        const info = MODE_INFO[mode][lang]
        expect(info.title.trim(), `${mode}.${lang}.title`).not.toBe('')
        expect(info.give.trim(), `${mode}.${lang}.give`).not.toBe('')
        expect(info.anchor.trim(), `${mode}.${lang}.anchor`).not.toBe('')
        expect(info.when.trim(), `${mode}.${lang}.when`).not.toBe('')
        expect(info.note.trim(), `${mode}.${lang}.note`).not.toBe('')
      }
    }
  })
})

describe('ModePicker', () => {
  it('pokazuje wszystkie tryby z opisami', () => {
    render(<ModePicker onPick={vi.fn()} />)
    for (const mode of ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF']) {
      // Kotwica jest konieczna: "FL2VA" zawiera "L2VA" jako podciąg, więc
      // niezakotwiczone wyrażenie trafiłoby w dwa przyciski naraz. Nazwa
      // dostępna przycisku zaczyna się od kodu trybu.
      expect(screen.getByRole('button', { name: new RegExp(`^${mode}`) })).toBeInTheDocument()
    }
    expect(screen.getByText(/jedyny tryb bez linii alignmentu/i)).toBeInTheDocument()
  })

  it('zgłasza wybrany tryb', async () => {
    const onPick = vi.fn()
    render(<ModePicker onPick={onPick} />)
    await userEvent.click(screen.getByRole('button', { name: /^FL2VA/ }))
    expect(onPick).toHaveBeenCalledWith('FL2VA')
  })

  it('przełącza opisy na angielski razem z językiem interfejsu', () => {
    useLang.setState({ lang: 'en' })
    render(<ModePicker onPick={vi.fn()} />)
    expect(screen.getByText(/the only mode without an alignment line/i)).toBeInTheDocument()
  })
})
