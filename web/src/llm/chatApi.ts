/**
 * Klient dwóch tras wątków rozmowy (`server/src/routes/projects.ts`). Typy są
 * tu zadeklarowane osobno, a nie zaimportowane z serwera, bo granica
 * `server/`/`web/` nie jest przekraczalna w tę stronę — tak samo jak cele
 * redakcji, które `LlmPanel` buduje po swojej stronie jako zwykłe obiekty.
 */

/** Ten sam kształt, który zapisuje `threadKey` po stronie serwera. */
export type ChatTarget =
  | { kind: 'style' }
  | { kind: 'shotText'; shotId: string; segmentIndex: number }
  | { kind: 'audio'; field: 'overallSoundscape' | 'nonDiegeticMusic' }
  | { kind: 'speaker'; speakerId: string; field: 'fullDescriptor' | 'shortDescriptor' }

export interface ChatMessageRecord {
  role: 'user' | 'assistant'
  text: string
  english?: string
}

export interface ChatThread {
  key: string
  target: ChatTarget
  messages: ChatMessageRecord[]
}

/**
 * Klucz wątku liczony po stronie klienta tą samą regułą, co `threadKey` w
 * `server/src/llm/chatStore.ts`. Dwie definicje tej samej reguły to koszt
 * granicy pakietów — ale rozjazd jest wykrywalny: okno rozmowy pokazałoby
 * pustą historię przy zapisanym wątku, a `web/e2e/fieldChat.spec.ts` sprawdza
 * dokładnie ten przebieg na prawdziwej przeglądarce.
 */
export function threadKeyFor(target: ChatTarget): string {
  switch (target.kind) {
    case 'style':
      return 'style'
    case 'audio':
      return `audio:${target.field}`
    case 'speaker':
      return `speaker:${target.speakerId}:${target.field}`
    case 'shotText':
      return `shot:${target.shotId}:${target.segmentIndex}`
  }
}

const isThread = (value: unknown): value is ChatThread => {
  if (typeof value !== 'object' || value === null) return false
  const thread = value as { key?: unknown; messages?: unknown }
  return typeof thread.key === 'string' && Array.isArray(thread.messages)
}

/**
 * Brak wątków, nieistniejący projekt i błąd sieci dają tu tę samą pustą listę:
 * okno rozmowy ma się otworzyć i pozwolić pisać niezależnie od tego, czy udało
 * się wczytać historię. Historia jest wygodą, a nie warunkiem rozmowy.
 */
export async function fetchChats(slug: string): Promise<ChatThread[]> {
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/chats`)
    if (!response.ok) return []
    const data = await response.json() as { threads?: unknown }
    return Array.isArray(data.threads) ? data.threads.filter(isThread) : []
  } catch {
    return []
  }
}

export async function clearChat(slug: string, key: string): Promise<void> {
  await fetch(
    `/api/projects/${encodeURIComponent(slug)}/chats/${encodeURIComponent(key)}`,
    { method: 'DELETE' },
  )
}
