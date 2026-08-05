import { useState } from 'react'
import {
  applyOps, describeOp,
  type DescribedValue, type InapplicableReason, type PatchOp, type Project, type ProjectPatch,
} from '@mmh3/shared'
import { useT, type Translate } from '../i18n/useT.js'
import type { TKey } from '../i18n/dict.js'
import { useProject } from '../store/projectStore.js'
import { normalizeProject } from '../timeline/normalizeProject.js'

/**
 * Przegląd łatki z wybiórczym przyjmowaniem operacji (zadanie 11) — jedyne
 * miejsce w całej aplikacji, gdzie treść wymyślona przez model językowy może
 * trafić do projektu. Nic nie stosuje się samo: każda operacja ma własne pole
 * wyboru, domyślnie żadna nie jest zaznaczona (przyjęcie ma być decyzją, nie
 * brakiem sprzeciwu), a zatwierdzenie stosuje wyłącznie te, które użytkownik
 * jawnie zaznaczył.
 *
 * ROZSTRZYGNIĘCIE co do „łatka może być nieaktualna" (potwierdzone przez
 * recenzenta w fix round 1/5 — bez zmian): `describeOp` czyta projekt PRZEZ
 * SELEKTOR (`useProject`), więc „przed" pokazywane w każdym wierszu to
 * zawsze BIEŻĄCA wartość. Zatwierdzenie woła `useProject.getState().apply`,
 * które samo czyta najświeższy projekt w chwili kliknięcia. Operacja, której
 * cel zniknął w międzyczasie, ma to wprost powiedziane przez `describeOp`
 * (`status: 'inapplicable'`) i `applyOps` cicho ją pomija.
 *
 * FIX ROUND 1/5 — trzy zmiany zachowania ponad pierwszą wersję:
 * 1. Zatwierdzone operacje ZNIKAJĄ z listy (`remaining`), reszta zostaje
 *    selekcjonowalna — wcześniejsza wersja blokowała CAŁY ekran po jednym
 *    kliknięciu „Zatwierdź" (nawet pustym), więc pomyłkowe odznaczenie i
 *    ponowne kliknięcie nie dawało wyjścia poza ponowne uruchomienie
 *    zadania, które wyrzuca akurat przejrzaną łatkę. Podwójne kliknięcie
 *    „Zatwierdź" zaraz po sobie NIE dubluje zastosowania: `chosen` liczy się
 *    jako `remaining.filter(op => selected.has(op.id))`, więc operacja
 *    usunięta z `remaining` po pierwszym zatwierdzeniu nie może trafić do
 *    `chosen` w kolejnym wywołaniu; a nawet gdyby (dwa kliknięcia złapane w
 *    JEDNĄ, jeszcze niezatwierdzoną partię reakcji Reacta), `applyOps` na
 *    wartości już zastosowanej zwraca dokładnie ten sam obiekt referencyjnie
 *    (`shared/src/patch/apply.ts`) — poza `replaceShots`, gdzie porównanie
 *    jest celowo referencyjne na tablicy `shots` (zadanie 4), nie głębokie:
 *    dwa zastosowania tej samej operacji `replaceShots` w JEDNEJ,
 *    niescommitowanej partii mogłyby zadziałać dwukrotnie. Prawdziwe, osobne
 *    zdarzenia klawiatury/myszy tego nie produkują — dług zapisany jako
 *    punkt 21, `docs/superpowers/specs/2026-08-04-uwagi-do-planu-2.md`.
 * 2. Puste zaznaczenie kończy `onConfirm` NATYCHMIAST — zero wywołań
 *    `apply`, zero wpisu w historii, zero komunikatu. To samo dotyczy
 *    zaznaczenia niepustego, które okazuje się nie zmieniać niczego (np.
 *    jedyny wybrany cel zniknął w międzyczasie) — `normalizeProject` biegnie
 *    WYŁĄCZNIE wtedy, gdy którakolwiek wybrana operacja faktycznie coś
 *    zmieniła, więc pusty (albo bezskuteczny) wybór nie odkłada mimowolnie
 *    migawki z przeliczonymi zaokrągleniami klatek/introdukcjami mówców na
 *    projekcie, który wcale nie był znormalizowany.
 * 3. Komunikat po zatwierdzeniu liczy operacje, które `applyOps` FAKTYCZNIE
 *    zmieniło (licznik przyrostowy w pętli wewnątrz `apply`), nie liczbę
 *    zaznaczonych — inaczej „2 zaznaczone, 1 nieaktualna" pokazywałoby się
 *    jako „zastosowano 2 operacje".
 */

/** Wartość jednej kolumny diffu — patrz `DescribedValue` w `shared/src/patch/describe.ts`. */
function renderValue(value: DescribedValue, t: Translate): string {
  switch (value.kind) {
    case 'text': return value.text
    case 'empty': return t('patchReview.notDescribed')
    case 'shotCount': return t('patchReview.shotCount', { count: value.count })
    case 'shotSummary':
      return t('patchReview.shotSummary', { added: value.added, removed: value.removed, altered: value.altered })
  }
}

const REASON_KEY: Record<InapplicableReason['kind'], TKey> = {
  missingShot: 'patchReview.reasonMissingShot',
  missingSegment: 'patchReview.reasonMissingSegment',
  wrongSegmentKind: 'patchReview.reasonWrongSegmentKind',
  missingSpeaker: 'patchReview.reasonMissingSpeaker',
  missingLabel: 'patchReview.reasonMissingLabel',
  missingRetentionEntry: 'patchReview.reasonMissingRetentionEntry',
}

function renderReason(reason: InapplicableReason, t: Translate): string {
  return reason.kind === 'wrongSegmentKind'
    ? t(REASON_KEY.wrongSegmentKind, { kind: reason.segmentKind })
    : t(REASON_KEY[reason.kind])
}

/**
 * Kategoria liczebnika (1 / 2–4 poza 12–14 / reszta, reguła polska) — `useT`
 * nie ma wbudowanej obsługi liczby mnogiej (płaski słownik klucz→szablon),
 * więc ekran sam wybiera, KTÓRY klucz użyć; treść samych kluczy (PL i EN) już
 * różni się w `dict.ts`, tak jak przy każdym innym kluczu z wariantami. Fix
 * round 1/5, zadanie 11, punkt 7: „1 operacji"/„1 operations applied" były
 * gramatycznie złe w obu językach dla policzalnych 1 i 2–4.
 */
type PluralCategory = 'one' | 'few' | 'many'

function pluralCategory(count: number): PluralCategory {
  if (count === 1) return 'one'
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'few'
  return 'many'
}

const APPLIED_KEY: Record<PluralCategory, TKey> = {
  one: 'patchReview.appliedOne',
  few: 'patchReview.appliedFew',
  many: 'patchReview.appliedMany',
}

/**
 * Pole wyboru zbudowane ręcznie (`role="checkbox"`), nie `<input>` — stan
 * zaznaczenia ma być stylowany tak samo jak reszta panelu LLM. To NIE jest
 * już natywny formularz, więc lekcja z brief-u wraca (`ActionButton` w
 * `LlmPanel.tsx`, klip w `ShotTrack.tsx`): bez własnej obsługi Enter/Spacji z
 * `preventDefault`/`stopPropagation`, spacja naciśnięta na tym wierszu
 * poleciałaby też do globalnego `useTimelineShortcuts` na `window` i
 * przełączyła odtwarzanie w tle. Sprawdzone testem w `patchReview.test.tsx`
 * — dla OBU klawiszy, na OBU rolach (pole wyboru i przycisk), bo fix round
 * 1/5 (punkt 4) wykazał, że pierwsza wersja miała pokrytą tylko przekątną.
 */
function OpCheckbox({
  label, checked, onToggle,
}: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        onToggle()
      }}
      className={`mt-0.5 flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border ${
        checked ? 'border-sky-500 bg-sky-600' : 'border-neutral-600 bg-neutral-900'
      }`}
    >
      {checked && <span className="text-[10px] leading-none text-white">✓</span>}
    </div>
  )
}

/** Ten sam wzorzec klawiatury co `OpCheckbox` wyżej — przycisk „Zatwierdź" jest równie podatny na wyciek spacji. */
function ConfirmButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      className="cursor-pointer self-start rounded border border-emerald-600 px-3 py-1 text-xs text-emerald-300 hover:border-emerald-400"
    >
      {label}
    </div>
  )
}

function OpRow({
  op, project, checked, onToggle, t,
}: { op: PatchOp; project: Project; checked: boolean; onToggle: () => void; t: Translate }) {
  const described = describeOp(project, op)
  return (
    <div className="flex items-start gap-2 border-b border-neutral-800 py-2 last:border-0">
      <OpCheckbox label={op.label} checked={checked} onToggle={onToggle} />
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-neutral-200">{op.label}</span>
        {described.status === 'inapplicable' ? (
          // Jeden wiersz ostrzeżenia, NIE dwa identyczne wiersze „przed"/„po"
          // — fix round 1/5, punkt 7: powtórzone zdanie w obu kolumnach
          // czytało się jak usterka renderowania, nie jak sygnał.
          <span className="text-[11px] text-amber-400">⚠ {renderReason(described.reason, t)}</span>
        ) : (
          <>
            <span className="text-[11px] text-neutral-500">{t('patchReview.before')}: {renderValue(described.before, t)}</span>
            <span className="text-[11px] text-neutral-400">{t('patchReview.after')}: {renderValue(described.after, t)}</span>
          </>
        )}
      </div>
    </div>
  )
}

export function PatchReview({ patch }: { patch: ProjectPatch }) {
  const t = useT()
  const project = useProject(state => state.project)
  const apply = useProject(state => state.apply)
  // Operacje jeszcze nierozpatrzone — zatwierdzona operacja znika stąd (fix
  // round 1/5, punkt 2), zamiast blokować cały ekran. Startuje jako kopia
  // `patch.ops`; `patch` nie zmienia się pod tym samym zamontowaniem
  // komponentu (`LlmPanel` montuje `PatchReview` na nowo dla każdego nowego
  // biegu zadania), więc inicjalizacja `useState` raz przy montowaniu jest
  // wystarczająca.
  const [remaining, setRemaining] = useState<PatchOp[]>(() => patch.ops)
  // Domyślnie PUSTY zbiór — przyjęcie operacji ma być jawną decyzją, nigdy
  // brakiem sprzeciwu.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  // `null` dopóki żadne zatwierdzenie jeszcze nie nastąpiło; potem liczba
  // operacji, które OSTATNIE zatwierdzenie FAKTYCZNIE zmieniło (nie liczba
  // zaznaczonych — fix round 1/5, punkt 5).
  const [lastApplied, setLastApplied] = useState<number | null>(null)

  if (project === null) return null

  const toggle = (id: string): void => {
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const onConfirm = (): void => {
    const chosen = remaining.filter(op => selected.has(op.id))
    // Nic zaznaczone → nic się nie dzieje: zero wywołań `apply`, zero wpisu w
    // historii, zero komunikatu (fix round 1/5, punkt 3 — dosłownie).
    if (chosen.length === 0) return

    let changed = 0
    apply(current => {
      let working = current
      for (const op of chosen) {
        const next = applyOps(working, [op])
        if (next !== working) changed += 1
        working = next
      }
      // Żadna z zaznaczonych operacji faktycznie niczego nie zmieniła (np.
      // jedyny wybrany cel zniknął w międzyczasie) — `normalizeProject` NIE
      // biegnie: na projekcie, który jeszcze nie był znormalizowany, zrobiłby
      // to teraz, jako efekt uboczny decyzji, która sama w sobie nic nie
      // zmieniła (fix round 1/5, punkt 3, ten sam mechanizm co przy pustym
      // zaznaczeniu).
      if (working === current) return current
      return normalizeProject(working, working.shots)
    })

    setRemaining(previous => previous.filter(op => !selected.has(op.id)))
    setSelected(new Set())
    setLastApplied(changed)
  }

  return (
    <section aria-label={t('patchReview.title')} className="flex flex-col gap-2 border-t border-neutral-800 pt-2">
      <span className="text-xs uppercase tracking-wide text-neutral-500">{t('patchReview.title')}</span>
      {patch.ops.length === 0 ? (
        <p className="text-xs text-neutral-500">{t('patchReview.empty')}</p>
      ) : remaining.length === 0 ? (
        <p className="text-xs text-neutral-500">{t('patchReview.allReviewed')}</p>
      ) : (
        <>
          <div className="flex flex-col">
            {remaining.map(op => (
              <OpRow key={op.id} op={op} project={project} checked={selected.has(op.id)} onToggle={() => toggle(op.id)} t={t} />
            ))}
          </div>
          <ConfirmButton label={t('patchReview.confirm')} onClick={onConfirm} />
        </>
      )}
      {lastApplied !== null && (
        <p className="text-xs text-emerald-400">{t(APPLIED_KEY[pluralCategory(lastApplied)], { count: lastApplied })}</p>
      )}
    </section>
  )
}
