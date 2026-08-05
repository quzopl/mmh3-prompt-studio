/**
 * Kolejny identyfikator w rodzinie — z MAKSIMUM istniejących numerów, nie z
 * ich liczby. Numeracja po liczbie wraca do wcześniejszej wartości po
 * usunięciu obiektu i produkuje duplikat, a duplikat sprawia, że gest
 * wymierzony w jeden obiekt trafia we wszystkie o tym samym identyfikatorze —
 * zmierzone w recenzji Planu 3 na czasach cięcia.
 *
 * UWAGA na `\d` w tym wzorcu: w template literalu JS `\d` nie jest metaznakiem
 * cyfry — nierozpoznana sekwencja ucieczki oddaje sam znak `d` (sprawdzone
 * w node: `` `\d` === 'd' ``), więc wzorzec musi użyć podwójnego backslasha
 * (`\\d`). Brief zadania 14 podawał wersję z pojedynczym `\d` — z nią
 * `pattern` dopasowywałby tylko literalne „...-d", nigdy istniejące id, więc
 * `highest` zawsze zostawałby na 0 i KAŻDE wywołanie zwracałoby ten sam
 * identyfikator (np. dwa kolejne ruchy kamery dostałyby oba `move-1`) —
 * dokładnie duplikat, przed którym ostrzega akapit wyżej. Test „dwa ruchy
 * dodane w tym samym miejscu mają różne identyfikatory" łapie to czerwonym.
 *
 * Wystawione w osobnym module (recenzja końcowa, znalezisko 6): rodzina
 * kwestii dialogowych miała DWIE funkcje liczące następny numer —
 * `nextId('line', …)` w `createOnTrack.ts` i `nextDialogueNumber` w
 * `proposals.ts`, każda z własnym wzorcem (zakotwiczonym vs. samą końcówką) i
 * własnym prefiksem. Dopóki prefiksy się różniły, kolizja była niemożliwa
 * przypadkiem, nie z konstrukcji; po ujednoliceniu rodziny dwa niezależne
 * liczniki natychmiast wyprodukowałyby ten sam identyfikator. Moduł jest
 * osobny (a nie eksport z `createOnTrack.ts`), bo `proposals.ts` jest
 * importowane PRZEZ `createOnTrack.ts` — eksport w drugą stronę zamknąłby
 * cykl importów.
 */
export function nextId(prefix: string, existing: string[]): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`)
  const highest = existing.reduce((best, id) => {
    const match = pattern.exec(id)
    const value = match?.[1] === undefined ? 0 : Number.parseInt(match[1], 10)
    return Number.isFinite(value) && value > best ? value : best
  }, 0)
  return `${prefix}-${highest + 1}`
}

/** Prefiks rodziny kwestii dialogowych — jedna nazwa dla obu dróg tworzenia. */
export const DIALOGUE_ID_PREFIX = 'line'
