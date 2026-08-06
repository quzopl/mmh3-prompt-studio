import type { ReactNode } from 'react'

/**
 * Przycisk sterowalny klawiaturą bez natywnego `<button>`. Natywny przycisk
 * puszcza zdarzenie `keydown` spacji dalej do `window` — a tam
 * `useTimelineShortcuts` tą samą spacją przełącza odtwarzanie. Cztery zadania
 * poprzedniego planu wypuściły dokładnie ten błąd (patrz `ShotTrack.tsx` po
 * ten sam wzorzec). `preventDefault`/`stopPropagation` lecą na Enterze i
 * spacji, zanim decyzja o aktywacji w ogóle zapadnie.
 */
export function ActionButton({
  label, onClick, disabled = false, pressed,
}: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  const activate = (): void => { if (!disabled) onClick() }
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-pressed={pressed}
      onClick={activate}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        activate()
      }}
      className={`rounded border px-2 py-1 text-xs ${
        pressed ? 'border-sky-600 bg-sky-950 text-sky-100' : 'border-neutral-700 hover:border-neutral-500'
      } ${disabled ? 'pointer-events-none opacity-40' : 'cursor-pointer'}`}
    >
      {label}
    </div>
  )
}

/**
 * Wspólny styl pola formularza w panelu i w oknie rozmowy — jedna definicja,
 * żeby oba wyglądały tak samo także po zmianie.
 */
export const inputClass = 'w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm'

export function LabelledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block text-neutral-500">{label}</span>
      {children}
    </label>
  )
}
