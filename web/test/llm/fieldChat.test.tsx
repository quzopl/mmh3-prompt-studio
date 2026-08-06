import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FieldChat } from '../../src/llm/FieldChat.js'
import type { ChatTarget } from '../../src/llm/chatApi.js'
import { useProject } from '../../src/store/projectStore.js'
import { baseProject, emptyShot } from '../timeline/fixtures.js'

/**
 * Okno rozmowy o polu (zadanie 6). `fetch` mockowany po parze `METODA URL`, tak
 * jak w `web/test/llm/unloadButton.test.tsx`; `web/test/setup.ts` ustawia język
 * na polski, więc selektory szukają polskich nazw dostępności.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

type Handler = (init?: RequestInit) => Response | Promise<Response>

function routedFetch(handlers: Record<string, Handler>): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const key = `${method} ${url}`
    const handler = handlers[key]
    if (!handler) throw new Error(`Brak mocka dla ${key}`)
    return handler(init)
  })
}

/** Odpowiedź SSE trasy `/api/llm/run` — ten sam kształt, który buduje
 *  `server/src/routes/llm.ts`: jedno zdarzenie `done` z ładunkiem JSON. */
const runStream = (payload: unknown): Response => new Response(
  `event: done\ndata: ${JSON.stringify(payload)}\n\n`,
  { headers: { 'content-type': 'text/event-stream' } },
)

const styleOp = {
  kind: 'setStyle',
  id: 'op-1',
  label: 'Zmiana pola z rozmowy z modelem.',
  text: 'Live-action, rain',
}

const withHistory = {
  threads: [{
    key: 'style',
    target: { kind: 'style' },
    messages: [
      { role: 'user', text: 'dodaj deszcz' },
      { role: 'assistant', text: 'Dodałem deszcz.', english: 'Live-action, rain' },
    ],
  }],
}

const target: ChatTarget = { kind: 'style' }

/** `PatchReview` zwraca `null`, dopóki w sklepie nie ma projektu — bez tego
 *  posiewu test „przegląd operacji" mierzyłby brak projektu, nie brak przeglądu. */
const loadProject = (): void => {
  useProject.getState().load('p', baseProject([emptyShot('base-shot', 0, 0)]))
}

afterEach(() => {
  vi.unstubAllGlobals()
  useProject.setState({
    slug: null, project: null, past: [], future: [], dirty: false,
    lastCoalesceKey: null, prompt: '', tokens: [], diagnostics: [],
  })
})

describe('FieldChat', () => {
  it('pokazuje zapisaną historię wątku po otwarciu', async () => {
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/projects/p/chats': () => json(withHistory),
    }))
    render(<FieldChat slug="p" target={target} onClose={() => {}} />)

    expect(await screen.findByText('dodaj deszcz')).toBeInTheDocument()
    expect(await screen.findByText('Dodałem deszcz.')).toBeInTheDocument()
  })

  it('wątek innego pola nie wycieka do tego okna', async () => {
    // Serwer zwraca wyłącznie wątek pola audio; okno pyta o styl.
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/projects/p/chats': () => json({
        threads: [{
          key: 'audio:overallSoundscape',
          target: { kind: 'audio', field: 'overallSoundscape' },
          messages: [{ role: 'user', text: 'cudza rozmowa' }],
        }],
      }),
    }))
    render(<FieldChat slug="p" target={target} onClose={() => {}} />)

    expect(await screen.findByText(/dodaj deszcz i zimne światło/)).toBeInTheDocument()
    expect(screen.queryByText('cudza rozmowa')).not.toBeInTheDocument()
  })

  it('pusty wątek pokazuje podpowiedź, nie pustkę', async () => {
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/projects/p/chats': () => json({ threads: [] }),
    }))
    render(<FieldChat slug="p" target={target} onClose={() => {}} />)

    expect(await screen.findByText(/dodaj deszcz i zimne światło/)).toBeInTheDocument()
  })

  it('przycisk wysyłki jest wyłączony, dopóki pole jest puste', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/projects/p/chats': () => json({ threads: [] }),
    }))
    render(<FieldChat slug="p" target={target} onClose={() => {}} />)

    // `ActionButton` nie jest natywnym `<button>` (spacja przeciekałaby do
    // skrótu odtwarzania), więc stan „wyłączony" niesie `aria-disabled`.
    const send = await screen.findByRole('button', { name: /wyślij/i })
    expect(send).toHaveAttribute('aria-disabled', 'true')

    await user.type(screen.getByLabelText(/twoje polecenie/i), 'dodaj deszcz')
    expect(send).toHaveAttribute('aria-disabled', 'false')
  })

  it('odpowiedź z propozycją pokazuje przegląd operacji', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/projects/p/chats': () => json({ threads: [] }),
      'POST /api/llm/run': () => runStream({ reply: 'Dodałem deszcz.', patch: { ops: [styleOp] } }),
    }))
    loadProject()
    render(<FieldChat slug="p" target={target} onClose={() => {}} />)

    await user.type(await screen.findByLabelText(/twoje polecenie/i), 'dodaj deszcz')
    await user.click(screen.getByRole('button', { name: /wyślij/i }))

    expect(await screen.findByText('Dodałem deszcz.')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /zatwierdź/i })).toBeInTheDocument()
    })
  })

  it('odpowiedź bez propozycji mówi wprost, że nic nie zmienia', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/projects/p/chats': () => json({ threads: [] }),
      'POST /api/llm/run': () => runStream({ reply: 'Wyjaśniam.', patch: { ops: [] } }),
    }))
    loadProject()
    render(<FieldChat slug="p" target={target} onClose={() => {}} />)

    await user.type(await screen.findByLabelText(/twoje polecenie/i), 'czym różni się push in?')
    await user.click(screen.getByRole('button', { name: /wyślij/i }))

    expect(await screen.findByText(/niczego nie zmienia/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /zatwierdź/i })).not.toBeInTheDocument()
  })

  it('dwie tury pod rząd dają dwie odpowiedzi, nie jedną i nie trzy', async () => {
    const user = userEvent.setup()
    let call = 0
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/projects/p/chats': () => json({ threads: [] }),
      'POST /api/llm/run': () => {
        call += 1
        return runStream({ reply: `odpowiedź ${call}`, patch: { ops: [] } })
      },
    }))
    render(<FieldChat slug="p" target={target} onClose={() => {}} />)

    const box = await screen.findByLabelText(/twoje polecenie/i)
    await user.type(box, 'dodaj deszcz')
    await user.click(screen.getByRole('button', { name: /wyślij/i }))
    await screen.findByText('odpowiedź 1')

    await user.type(box, 'mocniej')
    await user.click(screen.getByRole('button', { name: /wyślij/i }))
    await screen.findByText('odpowiedź 2')

    // Licznik czasu przerysowuje okno co 100 ms — gdyby dopisanie tury
    // zależało od przerysowania, a nie od zakończenia biegu, liczba
    // odpowiedzi rosłaby po tym oczekiwaniu.
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(screen.getAllByText(/^odpowiedź [12]$/)).toHaveLength(2)
  })

  it('czyszczenie rozmowy woła DELETE i opróżnia listę tur', async () => {
    const user = userEvent.setup()
    const deleted: string[] = []
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/projects/p/chats': () => json(withHistory),
      'DELETE /api/projects/p/chats/style': () => {
        deleted.push('style')
        return new Response(null, { status: 204 })
      },
    }))
    render(<FieldChat slug="p" target={target} onClose={() => {}} />)

    await screen.findByText('dodaj deszcz')
    await user.click(screen.getByRole('button', { name: /wyczyść rozmowę/i }))

    expect(deleted).toEqual(['style'])
    await waitFor(() => {
      expect(screen.queryByText('dodaj deszcz')).not.toBeInTheDocument()
    })
  })

  it('zamknięcie zgłasza się właścicielowi okna', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    vi.stubGlobal('fetch', routedFetch({
      'GET /api/projects/p/chats': () => json({ threads: [] }),
    }))
    render(<FieldChat slug="p" target={target} onClose={onClose} />)

    await user.click(await screen.findByRole('button', { name: /zamknij/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
