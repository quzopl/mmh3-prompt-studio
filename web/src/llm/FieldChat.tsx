import { useEffect, useState } from 'react'
import type { ProjectPatch } from '@mmh3/shared'
import { useLang, useT } from '../i18n/useT.js'
import { PatchReview } from './PatchReview.js'
import { ActionButton, LabelledField, inputClass } from './ActionButton.js'
import { useLlmRun } from './useLlmRun.js'
import { clearChat, fetchChats, threadKeyFor, type ChatTarget } from './chatApi.js'

/**
 * Rozmowa o JEDNYM polu projektu (zadanie 6). Zastępuje jednostrzałową
 * redakcję: pierwsza tura robi to samo, co robiła ona, a każda następna ma
 * dostęp do poprzednich, więc „mocniej" albo „mniej deszczu" ma się do czego
 * odnieść.
 *
 * Okno NIE zapisuje niczego do projektu samo. Odpowiedź modelu rozpada się na
 * dwie rzeczy o różnym losie: proza (`reply`) jest do przeczytania i zostaje w
 * historii, a propozycja zmiany pola idzie przez `PatchReview` — jedyne
 * miejsce w całej aplikacji, gdzie treść wymyślona przez model może trafić do
 * projektu, i to wyłącznie po jawnym zaznaczeniu operacji.
 *
 * Historię wczytujemy z serwera, a nie budujemy wyłącznie lokalnie: to serwer
 * jest właścicielem `chats.json` i to on dopisuje turę po udanym zapytaniu
 * (`server/src/routes/llm.ts`). Lokalna lista jest kopią do pokazania, nie
 * źródłem prawdy — dlatego po ponownym otwarciu okna widać to samo, co widzi
 * serwer, także po restarcie aplikacji.
 */

interface Turn {
  role: 'user' | 'assistant'
  text: string
  /** Tylko dla tury modelu: łatka, którą przyniosła. Tury wczytane z historii
   *  jej nie mają — łatka żyje tyle, co bieg zadania, bo po zastosowaniu
   *  operacji projekt już się zmienił i „przed" w przeglądzie byłoby kłamstwem. */
  patch?: ProjectPatch
}

export function FieldChat({
  slug, target, onClose,
}: { slug: string; target: ChatTarget; onClose: () => void }) {
  const t = useT()
  const run = useLlmRun()
  // Proza od modelu ma być w języku, który użytkownik wybrał przełącznikiem —
  // nie w tym, który model sobie wywnioskuje z treści polecenia.
  const lang = useLang(state => state.lang)
  const key = threadKeyFor(target)

  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const busy = run.status === 'running'

  useEffect(() => {
    let cancelled = false
    void fetchChats(slug).then(threads => {
      if (cancelled) return
      const thread = threads.find(item => item.key === key)
      setTurns((thread?.messages ?? []).map(message => ({ role: message.role, text: message.text })))
    })
    return () => { cancelled = true }
  }, [slug, key])

  // Tura modelu dopisuje się, gdy bieg się kończy. Zależności efektu zmieniają
  // się dokładnie raz na bieg (`useLlmRun` zeruje `reply` i `patch` na starcie,
  // a ustawia je w zdarzeniu `done`), więc samo przerysowanie okna — licznik
  // czasu tyka co 100 ms — efektu nie powtarza.
  //
  // Pierwsza wersja miała tu jeszcze straż na `useRef` z odciskiem odpowiedzi.
  // Weryfikacja odwrotna pokazała, że jest martwa: usunięcie jej nie psuło
  // żadnego testu, bo nie ma przebiegu, w którym efekt odpala się dwa razy z
  // tym samym wynikiem. Straż, której nie da się zmusić do działania, to nie
  // ostrożność — to kod, który następny czytelnik będzie musiał zrozumieć bez
  // powodu.
  useEffect(() => {
    if (run.status !== 'done' || run.reply === null) return
    setTurns(current => [
      ...current,
      { role: 'assistant', text: run.reply ?? '', patch: run.patch ?? { ops: [] } },
    ])
  }, [run.status, run.reply, run.patch])

  const send = (): void => {
    const message = draft.trim()
    if (message === '' || busy) return
    setTurns(current => [...current, { role: 'user', text: message }])
    setDraft('')
    run.run({ task: 'fieldChat', projectSlug: slug, target, message, replyLanguage: lang })
  }

  const clear = (): void => {
    void clearChat(slug, key).then(() => { setTurns([]) })
  }

  return (
    <section
      role="dialog"
      aria-label={t('llm.chatTitle')}
      className="flex flex-col gap-2 rounded border border-neutral-700 bg-neutral-950 p-2 text-sm"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wide text-neutral-500">{t('llm.chatTitle')}</h3>
        <div className="flex gap-2">
          <ActionButton label={t('llm.chatClear')} onClick={clear} />
          <ActionButton label={t('llm.chatClose')} onClick={onClose} />
        </div>
      </div>

      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        {turns.length === 0 && (
          <p className="text-xs text-neutral-500">{t('llm.chatEmpty')}</p>
        )}
        {turns.map((turn, index) => (
          <div key={index} className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-neutral-500">
              {turn.role === 'user' ? t('llm.chatYou') : t('llm.chatModel')}
            </span>
            <p className="whitespace-pre-wrap break-words text-sm">{turn.text}</p>
            {turn.patch !== undefined && (
              turn.patch.ops.length > 0
                ? <PatchReview patch={turn.patch} />
                : <p className="text-xs text-neutral-500">{t('llm.chatNoChange')}</p>
            )}
          </div>
        ))}
      </div>

      <LabelledField label={t('llm.chatMessage')}>
        <textarea
          className={inputClass}
          rows={2}
          value={draft}
          disabled={busy}
          onChange={event => setDraft(event.target.value)}
        />
      </LabelledField>

      <div className="flex items-center gap-2">
        <ActionButton
          label={t('llm.chatSend')}
          onClick={send}
          disabled={draft.trim() === '' || busy}
        />
        {busy && <ActionButton label={t('common.cancel')} onClick={run.cancel} />}
        {run.status === 'error' && run.error && (
          <span className="text-xs text-red-400">{run.error}</span>
        )}
      </div>
    </section>
  )
}
