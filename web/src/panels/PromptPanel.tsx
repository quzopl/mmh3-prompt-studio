import { useState, type ReactNode } from 'react'
import type { ObjectRef } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { same, useSelection } from '../store/selectionStore.js'
import { useT } from '../i18n/useT.js'
import { ActionButton } from '../llm/ActionButton.js'

/**
 * Kopiowanie bez `navigator.clipboard`. `document.execCommand('copy')` jest
 * oznaczone jako przestarzałe, ale to JEDYNA droga, która działa po zwykłym
 * HTTP — a tak właśnie wystawiona jest ta aplikacja na maszynie z modelem
 * (`0.0.0.0`, bez certyfikatu). Nowoczesne API zostaje jako pierwszy wybór;
 * ta funkcja jest tym, co ratuje przycisk w prawdziwym środowisku.
 */
function copyViaTextarea(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  // Poza ekranem, ale NIE `display:none` ani `hidden` — element niewidoczny
  // dla układu strony nie da się zaznaczyć, a bez zaznaczenia `execCommand`
  // nie ma czego skopiować.
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  area.setAttribute('readonly', 'true')
  document.body.appendChild(area)
  try {
    area.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(area)
  }
}

export function PromptPanel() {
  const t = useT()
  const prompt = useProject(state => state.prompt)
  const tokens = useProject(state => state.tokens)
  // `state.selected` (nie `state.isSelected`) — jak w ShotTrack: getter ma
  // stałą referencję między wywołaniami `set`, więc subskrypcja na nim nigdy
  // nie wykryłaby zmiany zaznaczenia dokonanej gdzie indziej (np. kliknięciem
  // klipu na osi czasu), a token nie podświetliłby się bez ponownego montowania.
  const selected = useSelection(state => state.selected)
  const select = useSelection(state => state.select)
  const isSelected = (ref: ObjectRef) => selected.some(candidate => same(candidate, ref))

  const [note, setNote] = useState<string | null>(null)

  /**
   * `navigator.clipboard` wymaga bezpiecznego kontekstu (HTTPS albo
   * localhost). Ta aplikacja bywa wystawiona po zwykłym HTTP na adres w sieci —
   * dokładnie tak stoi na serwerze testowym — więc API bywa NIEOBECNE albo
   * odrzuca zapis. Zamiast udawać sukces, mówimy wprost, co zrobić ręcznie.
   */
  const copy = (): void => {
    void (async () => {
      try {
        if (navigator.clipboard === undefined) throw new Error('brak clipboard API')
        await navigator.clipboard.writeText(prompt)
        setNote(t('prompt.copied'))
        return
      } catch {
        // Droga zapasowa niżej. Bez niej przycisk kopiowania byłby martwy
        // dokładnie tam, gdzie ta aplikacja realnie stoi.
      }
      setNote(copyViaTextarea(prompt) ? t('prompt.copied') : t('prompt.copyFailed'))
    })()
  }

  const ordered = [...tokens].sort((a, b) => a.start - b.start)
  const pieces: ReactNode[] = []
  let cursor = 0

  ordered.forEach((token, index) => {
    if (token.start < cursor) return
    if (token.start > cursor) {
      pieces.push(<span key={`t${index}`}>{prompt.slice(cursor, token.start)}</span>)
    }
    const label = prompt.slice(token.start, token.end)
    pieces.push(
      <button
        key={`k${index}`}
        type="button"
        onClick={() => select(token.ref)}
        aria-current={isSelected(token.ref) ? 'true' : undefined}
        className={`rounded px-0.5 ${
          isSelected(token.ref) ? 'bg-sky-700 text-white' : 'hover:bg-neutral-700'
        }`}
      >
        {label}
      </button>,
    )
    cursor = token.end
  })

  if (cursor < prompt.length) pieces.push(<span key="rest">{prompt.slice(cursor)}</span>)

  return (
    <section aria-label={t('editor.prompt')} className="flex h-full flex-col overflow-hidden">
      {/*
        Kopiowanie zaznaczeniem myszy w tym panelu NIE DZIAŁA i nie da się tego
        obejść stylami: każdy token promptu jest `<button>`, żeby klik wybierał
        obiekt na osi czasu, więc przeciągnięcie kursorem trafia w przyciski,
        a nie w tekst. Skoro sami odebraliśmy zaznaczanie, musimy dać kopiowanie
        wprost — inaczej jedyną drogą po gotowy prompt jest pobranie pliku .txt
        z panelu eksportu, czego użytkownik na serwerze nie znalazł.
      */}
      <div className="flex items-center justify-end gap-2 border-b border-neutral-800 px-3 py-1">
        {note !== null && <span className="text-[11px] text-neutral-400">{note}</span>}
        <ActionButton label={t('prompt.copy')} onClick={copy} disabled={prompt === ''} />
      </div>
      <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed">
        {pieces}
      </pre>
    </section>
  )
}
