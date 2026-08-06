import { z } from 'zod'

/**
 * Język, w którym model ma pisać PROZĘ DLA CZŁOWIEKA — komentarz rozmowy
 * (`fieldChat`) i uwagi krytyka (`critic`). Nie dotyczy treści pól projektu:
 * te są zawsze po angielsku, bo czyta je model wideo, nie człowiek.
 *
 * Bierze się z interfejsu, nie ze zgadywania. Pierwsza wersja promptu rozmowy
 * mówiła „in the language they wrote in" — instrukcja, którą model musi
 * WYWNIOSKOWAĆ z treści polecenia. Uruchomienie na serwerze pokazało, jak to
 * wychodzi: na polskie „styl: komedia slapstickowa…" model odpisał po
 * angielsku. Jeden konkretny język podany wprost jest instrukcją, nie
 * zagadką — a przeglądarka i tak wie, który to, bo użytkownik wybrał go
 * przełącznikiem PL/EN.
 *
 * Jedna definicja dla obu zadań. Krytyk nie miał o języku ANI SŁOWA i
 * odpowiadał, jak mu wyszło — dokładnie ta klasa usterki, która w tym projekcie
 * wracała trzy razy: strażnik postawiony w jednych drzwiach, gdy drzwi jest
 * kilka.
 */
export const ReplyLanguageSchema = z.enum(['pl', 'en'])

export type ReplyLanguage = z.infer<typeof ReplyLanguageSchema>

/** Domyślnie angielski — tyle samo mówi domyślny język interfejsu
 *  (`readInitialLang` w `web/src/i18n/useT.ts`). */
export const DEFAULT_REPLY_LANGUAGE: ReplyLanguage = 'en'

/**
 * Zdanie do promptu systemowego. `field` nazywa pole odpowiedzi, w którym ta
 * proza ma się znaleźć — „reply" w rozmowie, „message" u krytyka — żeby model
 * nie miał wątpliwości, że chodzi o TĘ jedną wartość, a nie o całą odpowiedź.
 */
export function replyLanguageRule(language: ReplyLanguage, field: string): string {
  const name = language === 'pl' ? 'Polish' : 'English'
  return `Write every "${field}" value in ${name}, whatever language the input `
    + `is in. This is the only text a human reads; every other value you return `
    + `is written in English for a video model.`
}
