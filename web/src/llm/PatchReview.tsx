import { useState } from 'react'
import { applyOps, describeOp, type PatchOp, type Project, type ProjectPatch } from '@mmh3/shared'
import { useT, type Translate } from '../i18n/useT.js'
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
 * ROZSTRZYGNIĘCIE co do „łatka może być nieaktualna" (brief zadania 11): ten
 * komponent NIE trzyma zamrożonej migawki projektu sprzed przeglądu i nie ma
 * osobnego trybu „zablokowane, bo projekt się zmienił". Zamiast tego:
 *
 * - `describeOp` czyta projekt PRZEZ SELEKTOR (`useProject`), więc „przed"
 *   pokazywane w każdym wierszu to zawsze BIEŻĄCA wartość, nie ta sprzed
 *   otwarcia przeglądu — jeśli ktoś edytuje projekt ręcznie, mając łatkę na
 *   ekranie, widać to natychmiast w treści diffu, zamiast po cichu stosować
 *   coś nieaktualnego.
 * - Zatwierdzenie woła `useProject.getState().apply`, które samo czyta
 *   NAJŚWIEŻSZY projekt w momencie kliknięcia (`get()` w środku, patrz
 *   `projectStore.ts`) — nie domknięcie sprzed wyboru operacji.
 * - Operacja, której cel zniknął w międzyczasie (usunięte ujęcie, mówca,
 *   etykieta…), ma to już wprost powiedziane w `describeOp` („operacja się
 *   nie zastosuje — …", `shared/src/patch/describe.ts`) — a `applyOps`
 *   (zadanie 4) taką operację cicho pomija, oddając projekt bez zmian. Diff
 *   nigdy nie kłamie o tym, co się stanie, więc nie ma osobnej rzeczy do
 *   zablokowania: zastosowanie zawsze robi dokładnie to, co pokazuje ekran w
 *   chwili kliknięcia „Zatwierdź".
 *
 * Innymi słowy: „nieaktualność" nie jest tu stanem do wykrycia raz i
 * zablokowania — jest czymś, czego nie ma, bo opis i zastosowanie zawsze
 * patrzą na to samo, bieżące źródło prawdy.
 */

/**
 * Pole wyboru zbudowane ręcznie (`role="checkbox"`), nie `<input>` — stan
 * zaznaczenia ma być stylowany tak samo jak reszta panelu LLM. To NIE jest
 * już natywny formularz, więc lekcja z brief-u wraca (`ActionButton` w
 * `LlmPanel.tsx`, klip w `ShotTrack.tsx`): bez własnej obsługi Enter/Spacji z
 * `preventDefault`/`stopPropagation`, spacja naciśnięta na tym wierszu
 * poleciałaby też do globalnego `useTimelineShortcuts` na `window` i
 * przełączyła odtwarzanie w tle. Sprawdzone testem w `patchReview.test.tsx`.
 */
function OpCheckbox({
  label, checked, disabled, onToggle,
}: { label: string; checked: boolean; disabled: boolean; onToggle: () => void }) {
  const activate = (): void => { if (!disabled) onToggle() }
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={activate}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        activate()
      }}
      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
        checked ? 'border-sky-500 bg-sky-600' : 'border-neutral-600 bg-neutral-900'
      } ${disabled ? 'opacity-40' : 'cursor-pointer'}`}
    >
      {checked && <span className="text-[10px] leading-none text-white">✓</span>}
    </div>
  )
}

/** Ten sam wzorzec klawiatury co `OpCheckbox` wyżej — przycisk „Zatwierdź" jest równie podatny na wyciek spacji. */
function ConfirmButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  const activate = (): void => { if (!disabled) onClick() }
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={activate}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        activate()
      }}
      className={`self-start rounded border px-3 py-1 text-xs ${
        disabled
          ? 'pointer-events-none border-neutral-700 opacity-40'
          : 'cursor-pointer border-emerald-600 text-emerald-300 hover:border-emerald-400'
      }`}
    >
      {label}
    </div>
  )
}

function OpRow({
  op, project, checked, disabled, onToggle, t,
}: { op: PatchOp; project: Project; checked: boolean; disabled: boolean; onToggle: () => void; t: Translate }) {
  const described = describeOp(project, op)
  return (
    <div className="flex items-start gap-2 border-b border-neutral-800 py-2 last:border-0">
      <OpCheckbox label={op.label} checked={checked} disabled={disabled} onToggle={onToggle} />
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-neutral-200">{op.label}</span>
        <span className="text-[11px] text-neutral-500">{t('patchReview.before')}: {described.before}</span>
        <span className="text-[11px] text-neutral-400">{t('patchReview.after')}: {described.after}</span>
      </div>
    </div>
  )
}

export function PatchReview({ patch }: { patch: ProjectPatch }) {
  const t = useT()
  const project = useProject(state => state.project)
  const apply = useProject(state => state.apply)
  // Domyślnie PUSTY zbiór — przyjęcie operacji ma być jawną decyzją, nigdy
  // brakiem sprzeciwu (rozstrzygnięcie zapisane w `progress.md` planu).
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  // `null` dopóki użytkownik nie kliknął „Zatwierdź" ani razu; potem liczba
  // operacji, które BYŁY zaznaczone w chwili kliknięcia. Blokuje ponowne
  // zatwierdzenie tej samej łatki (jedno kliknięcie to jedna decyzja) i daje
  // czytelne potwierdzenie zamiast cichego zniknięcia listy.
  const [appliedCount, setAppliedCount] = useState<number | null>(null)

  if (project === null) return null

  const locked = appliedCount !== null

  const toggle = (id: string): void => {
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const onConfirm = (): void => {
    const chosen = patch.ops.filter(op => selected.has(op.id))
    // Jedno wywołanie `apply` niesie WSZYSTKIE wybrane operacje naraz —
    // niezależnie od ich liczby, to jeden wpis w historii cofania (albo
    // żaden, jeśli `chosen` jest puste: `applyOps`/`normalizeProject`
    // oddają wtedy dokładnie ten sam obiekt projektu, a `useProject.apply`
    // odrzuca krok, który nie zmienia referencji — patrz `projectStore.ts`).
    apply(current => {
      const next = applyOps(current, chosen)
      return normalizeProject(next, next.shots)
    })
    setAppliedCount(chosen.length)
  }

  return (
    <section aria-label={t('patchReview.title')} className="flex flex-col gap-2 border-t border-neutral-800 pt-2">
      <span className="text-xs uppercase tracking-wide text-neutral-500">{t('patchReview.title')}</span>
      {patch.ops.length === 0 ? (
        <p className="text-xs text-neutral-500">{t('patchReview.empty')}</p>
      ) : (
        <>
          <div className="flex flex-col">
            {patch.ops.map(op => (
              <OpRow
                key={op.id}
                op={op}
                project={project}
                checked={selected.has(op.id)}
                disabled={locked}
                onToggle={() => toggle(op.id)}
                t={t}
              />
            ))}
          </div>
          <ConfirmButton label={t('patchReview.confirm')} disabled={locked} onClick={onConfirm} />
        </>
      )}
      {appliedCount !== null && (
        <p className="text-xs text-emerald-400">{t('patchReview.applied', { count: appliedCount })}</p>
      )}
    </section>
  )
}
