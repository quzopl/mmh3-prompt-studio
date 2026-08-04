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

/**
 * Które kotwice mają sens na danym ujęciu — reszta byłaby szumem na klipie albo,
 * gorzej, pułapką. ANCHOR_REQUIRED zapala się, gdy kotwica istnieje gdziekolwiek
 * w projekcie, ale sąsiednia reguła L2VA_ANCHOR_LAST_SHOT (ten sam plik) wymaga
 * dodatkowo, żeby siedziała akurat na ostatnim ujęciu. Bez `isLastShot` odznaka
 * na środkowym klipie w L2VA gasiłaby jedną regułę i od razu włączała drugą, nie
 * podpowiadając, które ujęcie było właściwe — więc na ujęciach innych niż ostatnie
 * w L2VA kotwicy w ogóle nie oferujemy. FL2VA zostaje bez zmian: żadna reguła nie
 * ogranicza, które ujęcie niesie parę kotwic, a jego główny przypadek to i tak
 * pojedyncze ujęcie.
 */
export function anchorsForShot(mode: Mode, isLastShot: boolean): Anchor[] {
  if (mode === 'L2VA' && !isLastShot) return []
  return BY_MODE[mode]
}

/** Odznaka do wyrysowania: kotwica plus to, czy tryb ją na tym ujęciu proponuje. */
export interface AnchorBadge {
  anchor: Anchor
  offered: boolean
}

/**
 * Suma kotwic, które tryb oferuje na tym ujęciu, i tych, które ujęcie
 * faktycznie niesie. Sama lista oferowanych nie wystarczy: kotwicę wolno
 * ustawić, a potem zmienić warunki, na których była oferowana — wystarczy
 * podzielić jedyne ujęcie w L2VA, żeby `picture-last` została na ujęciu, które
 * przestało być ostatnie. Wtedy kotwica dalej siedzi w modelu, blokuje eksport
 * regułą L2VA_ANCHOR_LAST_SHOT, a żadna kontrolka w aplikacji jej nie zdejmie
 * — inspektor pola kotwic nie ma. Zasada z zadania 8 jest w tym miejscu ta
 * sama: użytkownik zawsze musi móc cofnąć własne kliknięcie. Tryb nadal nie
 * PROPONUJE kotwicy, która do niego nie należy — pozostałość jest oznaczona
 * `offered: false` i wygląda inaczej, żeby nie udawała poprawnego wyboru.
 */
export function anchorBadges(mode: Mode, isLastShot: boolean, anchors: Anchor[]): AnchorBadge[] {
  const offered = anchorsForShot(mode, isLastShot)
  return [
    ...offered.map(anchor => ({ anchor, offered: true })),
    // `Set` na wypadek powtórzeń w modelu — schemat ich nie zabrania, a dwie
    // odznaki o tym samym kluczu byłyby błędem Reacta.
    ...[...new Set(anchors)]
      .filter(anchor => !offered.includes(anchor))
      .map(anchor => ({ anchor, offered: false })),
  ]
}

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
export function AnchorBadges({
  shotId, anchors, shotNumber, isLastShot,
}: {
  shotId: string
  anchors: Anchor[]
  /** Numer ujęcia liczony od 1 — dla nazwy dostępności, nie do logiki. */
  shotNumber: number
  isLastShot: boolean
}) {
  const t = useT()
  const mode = useProject(state => state.project?.mode)
  const apply = useProject(state => state.apply)

  if (!mode) return null
  const badges = anchorBadges(mode, isLastShot, anchors)
  if (badges.length === 0) return null

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
      {badges.map(({ anchor, offered }) => {
        const active = anchors.includes(anchor)
        const name = t(LABEL_KEY[anchor])
        const label = t(offered ? 'anchor.toggle' : 'anchor.stale', { name, number: shotNumber })
        return (
          <button
            key={anchor}
            type="button"
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={event => {
              event.stopPropagation()
              toggle(anchor)
            }}
            onKeyDown={event => {
              // Przycisk aktywuje się natywnie na Enter/Spację (to zwykły <button>),
              // ale samo zdarzenie keydown bez zatrzymania i tak poleciałoby dalej do
              // globalnego `useTimelineShortcuts` na `window` — tam spacja przełącza
              // odtwarzanie. Nie wołamy `preventDefault`: natywna aktywacja ma zajść.
              if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
            }}
            // Pozostałość po trybie ma własny kolor ostrzegawczy — ustawiona
            // kotwica spoza trybu nie może wyglądać jak poprawny wybór.
            className={`rounded px-1 text-[9px] leading-4 ${
              !offered
                ? 'bg-rose-800 text-rose-100 line-through'
                : active ? 'bg-amber-500 text-neutral-950' : 'bg-neutral-800 text-neutral-400'
            }`}
          >
            {anchor === 'picture-last' ? '⇥' : anchor === 'picture-first' ? '⇤' : '◆'}
          </button>
        )
      })}
    </span>
  )
}
