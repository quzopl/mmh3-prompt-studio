/**
 * Projekt sprzed zaostrzenia `ProjectSchema` (patrz `schema.ts`) mógł mieć
 * powtórzone identyfikatory — do Planu 4 `splitAtMs` numerował po liczbie
 * ujęć, więc identyfikator wracał po usunięciu. Odrzucenie takiego pliku
 * zostawiłoby użytkownika bez sposobu na jego otwarcie, więc pierwszy
 * z duplikatów zachowuje swój identyfikator, a każdy następny dostaje nowy
 * z sufiksem. Naprawa działa na surowym JSON-ie, bo musi zajść przed
 * walidacją — stąd `unknown` na wejściu i wyjściu, nie `Project`.
 *
 * Mieszka przy schemacie, nie w `server/`: każdy konsument, który parsuje
 * `project.json` z dysku, musi przez nią przejść, żeby stare pliki dało się
 * otworzyć — dotyczy to zarówno magazynu serwera (`projectStore.ts`), jak
 * i CLI (`cli.ts`), które parsuje pliki niezależnie od serwera.
 *
 * Naprawa zmienia tylko `id` w obrębie własnej rodziny — nie przepisuje
 * miejsc, które mogły na przemianowany identyfikator wskazywać
 * (`shot.labelRefs`, segmenty `label`/`camera`/`dialogue`, `ref.retention`).
 * To decyzja świadoma: przy duplikacie żadna referencja i tak nie mogła
 * odróżnić, o który z dwóch obiektów chodzi, więc po naprawie jednoznacznie
 * trafia w ocalały pierwszy egzemplarz pod starym id, a kolejne stają się
 * nieużywane, ale projekt jest spójny i otwiera się bez błędu — lepsze niż
 * odrzucenie pliku, i nie gorsze niż stan sprzed naprawy.
 */
export function repairDuplicateIds(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw
  const project = raw as Record<string, unknown>
  const repaired: Record<string, unknown> = { ...project }

  for (const family of ['shots', 'labels', 'speakers', 'assets']) {
    const list = project[family]
    if (!Array.isArray(list)) continue
    const seen = new Set<string>()
    repaired[family] = list.map(entry => {
      if (typeof entry !== 'object' || entry === null) return entry
      const record = entry as Record<string, unknown>
      const id = record['id']
      if (typeof id !== 'string') return entry
      if (!seen.has(id)) { seen.add(id); return entry }
      let candidate = id
      let suffix = 2
      while (seen.has(candidate)) { candidate = `${id}-dup${suffix}`; suffix += 1 }
      seen.add(candidate)
      return { ...record, id: candidate }
    })
  }
  return repaired
}
