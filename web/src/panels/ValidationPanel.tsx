import { useId } from 'react'
import { isExportReady, type Severity } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { useSelection } from '../store/selectionStore.js'
import { isCriticStale, useCritic } from '../store/criticStore.js'
import { useLang, useT, type Translate } from '../i18n/useT.js'

const SEVERITY_STYLE: Record<Severity, string> = {
  error: 'border-red-800 text-red-300',
  warning: 'border-amber-800 text-amber-300',
  hint: 'border-neutral-700 text-neutral-400',
}

/**
 * Wiersz uwagi krytyka — `role="button"` z jawną obsługą klawiatury zamiast
 * natywnego `<button>`. Ta sama usterka co w czterech zadaniach poprzedniego
 * planu (`AudioBedTracks.tsx`, `ScreenTextTrack.tsx`, `LlmPanel.tsx`…):
 * natywny przycisk puszcza `keydown` spacji dalej do `window`, gdzie
 * `useTimelineShortcuts` tą samą spacją przełącza odtwarzanie.
 * `preventDefault`/`stopPropagation` lecą na Enterze i spacji, zanim w ogóle
 * zapadnie decyzja o aktywacji.
 */
function CriticNoteRow({
  message, severity, stale, sourceLabel, staleLabel, onActivate,
}: {
  message: string
  severity: Severity
  stale: boolean
  sourceLabel: string
  staleLabel: string
  onActivate: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        onActivate()
      }}
      className={`w-full cursor-pointer rounded border-l-2 px-2 py-1 text-left text-sm hover:bg-neutral-900 ${SEVERITY_STYLE[severity]}`}
    >
      <span className="block">{message}</span>
      <span className="mt-0.5 block font-mono text-[10px] text-neutral-500">
        {sourceLabel}
        {stale ? ` · ${staleLabel}` : ''}
      </span>
    </div>
  )
}

/**
 * Nagłówek grupy uwag krytyka — GRUPA JEST NIEOBECNA, nie pusta, gdy uwag
 * nie ma: pusta sekcja z nagłówkiem sugerowałaby brak czegoś, co powinno
 * tam być (brief zadania 12), więc wywołujący w ogóle nie renderuje tego
 * komponentu, jeśli `notes` jest puste — patrz `ValidationPanel` niżej.
 *
 * Nagłówek jest PRAWDZIWYM elementem `<h3>`, nie akapitem — inaczej
 * nawigacja czytnika ekranu po nagłówkach i po landmarkach nie widziałaby
 * tej grupy w ogóle, mimo że cały sens zadania 12 to WIDOCZNE oddzielenie
 * dowodliwych reguł od opinii modelu (round 1 recenzji). `role="group"` +
 * `aria-labelledby` wiąże listę z nagłówkiem, więc grupa istnieje w drzewie
 * dostępności, nie tylko na ekranie. `useId()` (nie stały string) chroni
 * przed kolizją identyfikatorów, gdyby kiedyś panel wyrenderował się więcej
 * niż raz naraz.
 */
function CriticNotesGroup({ t }: { t: Translate }) {
  const notes = useCritic(state => state.notes)
  const capturedProject = useCritic(state => state.capturedProject)
  const project = useProject(state => state.project)
  const select = useSelection(state => state.select)
  const stale = isCriticStale(capturedProject, project)
  const headingId = useId()

  if (notes.length === 0) return null

  return (
    <div className="mt-4" role="group" aria-labelledby={headingId}>
      <h3 id={headingId} className="mb-2 text-xs uppercase tracking-wide text-neutral-500">
        {t('validation.criticTitle')}
      </h3>
      <ul className="flex flex-col gap-1">
        {notes.map((note, index) => (
          <li key={`${note.ref.kind}-${note.ref.id}-${index}`}>
            <CriticNoteRow
              message={note.message}
              severity={note.severity}
              stale={stale}
              sourceLabel={t('validation.criticSource')}
              staleLabel={t('validation.criticStale')}
              onActivate={() => select(note.ref)}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ValidationPanel() {
  const t = useT()
  const lang = useLang(state => state.lang)
  const diagnostics = useProject(state => state.diagnostics)
  const select = useSelection(state => state.select)
  const rulesHeadingId = useId()

  return (
    <section aria-label={t('editor.validation')} className="h-full overflow-auto p-3">
      {/* Grupa reguł deterministycznych — `<h3>` prawdziwy, nie akapit, z tego
          samego powodu co nagłówek `CriticNotesGroup` niżej: druga połowa tej
          samej naprawy (round 1 recenzji), inaczej asymetria plain/heading
          między dwiema grupami wyglądałaby na zamierzoną. */}
      <div role="group" aria-labelledby={rulesHeadingId}>
        <h3 id={rulesHeadingId} className="mb-2 text-xs uppercase tracking-wide text-neutral-500">
          {isExportReady(diagnostics)
            ? t('validation.ready')
            : t('validation.count', { count: diagnostics.length })}
        </h3>

        {diagnostics.length === 0 && (
          <p className="text-sm text-neutral-400">{t('validation.none')}</p>
        )}

        <ul className="flex flex-col gap-1">
          {diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.ruleId}-${index}`}>
              <button
                type="button"
                onClick={() => select(diagnostic.ref)}
                className={`w-full rounded border-l-2 px-2 py-1 text-left text-sm hover:bg-neutral-900 ${SEVERITY_STYLE[diagnostic.severity]}`}
              >
                <span className="block">{lang === 'pl' ? diagnostic.message : diagnostic.messageEn}</span>
                <span className="mt-0.5 block font-mono text-[10px] text-neutral-500">
                  {diagnostic.ruleId} · {t('validation.source')}: {diagnostic.guideRef}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Grupa uwag krytyka — osobna od reguł powyżej: własny nagłówek, własna
          lista, nigdy nie wymieszana z diagnostyką. Uwaga modelu jest opinią,
          nie dowodliwym faktem jak reguła (zob. brief), więc nie liczy się do
          licznika problemów nad diagnostyką ani do `isExportReady` — obie
          liczą wyłącznie `diagnostics`, których ta grupa nigdy nie dotyka. */}
      <CriticNotesGroup t={t} />
    </section>
  )
}
