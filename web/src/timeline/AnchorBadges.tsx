import type { Anchor, Mode } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { useT } from '../i18n/useT.js'

/**
 * Zgodne z regułą walidatora ANCHOR_REQUIRED (shared/src/validate/rules/anchors.ts):
 * I2VA wymaga 'picture-first', FL2VA obu, L2VA 'picture-last'. T2VA nie zna kotwic.
 * REF nie jest tam w ogóle sprawdzany (obrazy w REF to nie wymóg tej reguły), ale
 * `keyframe` istnieje w modelu i schemacie właśnie dla tego trybu — udostępniamy go,
 * żeby REF też miał sposób oznaczenia klatki kluczowej.
 */
const BY_MODE: Record<Mode, Anchor[]> = {
  T2VA: [],
  I2VA: ['picture-first'],
  FL2VA: ['picture-first', 'picture-last'],
  L2VA: ['picture-last'],
  REF: ['keyframe'],
}

/** Które kotwice mają sens w danym trybie — reszta byłaby szumem na klipie. */
export const anchorsForMode = (mode: Mode): Anchor[] => BY_MODE[mode]

const LABEL_KEY: Record<Anchor, 'anchor.picture-first' | 'anchor.picture-last' | 'anchor.keyframe'> = {
  'picture-first': 'anchor.picture-first',
  'picture-last': 'anchor.picture-last',
  keyframe: 'anchor.keyframe',
}

/**
 * Odznaki kotwic na klipie. Przełączenie to edycja dokumentu, więc wchodzi do
 * historii cofania jak każda inna — bez `coalesceKey`, żeby dwa kolejne kliknięcia
 * (np. włącz pierwszą i ostatnią klatkę w FL2VA) zostały osobnymi wpisami, a nie
 * scaliły się w jeden. Zdjęcie ostatniej wymaganej kotwicy jest dozwolone: walidator
 * i tak zgłosi ANCHOR_REQUIRED, a niepozwolenie użytkownikowi cofnąć własnego
 * kliknięcia byłoby gorsze niż chwilowo niepoprawny projekt.
 */
export function AnchorBadges({ shotId, anchors }: { shotId: string; anchors: Anchor[] }) {
  const t = useT()
  const mode = useProject(state => state.project?.mode)
  const apply = useProject(state => state.apply)

  if (!mode) return null
  const available = anchorsForMode(mode)
  if (available.length === 0) return null

  const toggle = (anchor: Anchor) => apply(current => ({
    ...current,
    shots: current.shots.map(shot => {
      if (shot.id !== shotId) return shot
      const has = shot.anchors.includes(anchor)
      return {
        ...shot,
        anchors: has
          ? shot.anchors.filter(candidate => candidate !== anchor)
          : [...shot.anchors, anchor],
      }
    }),
  }))

  return (
    <span className="absolute bottom-0 right-1 z-10 flex gap-1">
      {available.map(anchor => {
        const active = anchors.includes(anchor)
        const name = t(LABEL_KEY[anchor])
        return (
          <button
            key={anchor}
            type="button"
            aria-pressed={active}
            aria-label={t('anchor.toggle', { name })}
            title={name}
            onClick={event => {
              event.stopPropagation()
              toggle(anchor)
            }}
            className={`rounded px-1 text-[9px] leading-4 ${
              active ? 'bg-amber-500 text-neutral-950' : 'bg-neutral-800 text-neutral-400'
            }`}
          >
            {anchor === 'picture-last' ? '⇥' : anchor === 'picture-first' ? '⇤' : '◆'}
          </button>
        )
      })}
    </span>
  )
}
