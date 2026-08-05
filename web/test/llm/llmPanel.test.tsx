import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project } from '@mmh3/shared'
import { LlmPanel } from '../../src/llm/LlmPanel.js'
import { useProject } from '../../src/store/projectStore.js'
import { usePlayhead } from '../../src/store/playheadStore.js'
import { useCritic } from '../../src/store/criticStore.js'
import { useTimelineShortcuts } from '../../src/timeline/useTimelineShortcuts.js'
import { useLang } from '../../src/i18n/useT.js'

/**
 * Zadanie 10: panel LLM. Konwencja mockowania `fetch` po URL-u i metodzie —
 * jedna trasa (`/api/llm/settings`) obsługuje zarówno `GET`, jak i `PUT`, więc
 * router musi rozróżniać metodę, nie tylko adres.
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

/** Ten sam kształt co `LlmSettings` z `web/src/llm/settingsApi.ts` — testy
 * budują warianty z różnym `mode`, więc typ musi być unią, nie literałem
 * wywnioskowanym z jednej stałej. */
interface TestSettings {
  mode: 'off' | 'endpoint' | 'managed'
  endpoint: { baseUrl: string; apiKey: string; model: string }
  managed: { serverBinary: string; modelPath: string; gpuLayers: number; contextSize: number }
}

const settingsOff: TestSettings = {
  mode: 'off',
  endpoint: { baseUrl: '', apiKey: '', model: '' },
  managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 8192 },
}

const settingsEndpoint: TestSettings = {
  mode: 'endpoint',
  endpoint: { baseUrl: 'http://localhost:1234/v1', apiKey: '', model: 'qwen' },
  managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 8192 },
}

const managedStopped = { status: 'stopped' as const, logs: [], port: 0 }

/** Handlery domyślne dla `GET` obu tras odczytu, wspólne dla większości
 * testów — panel woła je obie przy montowaniu, niezależnie od tego, co test
 * właściwie sprawdza. */
const baseHandlers = (settings: TestSettings = settingsOff): Record<string, Handler> => ({
  'GET /api/llm/settings': () => json(settings),
  'GET /api/llm/managed/state': () => json(managedStopped),
})

/** Strumień sterowany ręcznie z testu — ten sam wzorzec co
 * `web/test/llm/useLlmRun.test.tsx`, bo panel woła trasę `POST /api/llm/run`
 * przez ten sam hak (`useLlmRun`). */
function controllableStream() {
  let ref: ReadableStreamDefaultController<Uint8Array> | null = null
  const stream = new ReadableStream<Uint8Array>({ start: controller => { ref = controller } })
  const encoder = new TextEncoder()
  const send = (event: string, data: unknown): void => {
    try {
      ref?.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    } catch {
      // strumień już zamknięty przez `reader.cancel()` — nic do wysłania
    }
  }
  const close = (): void => { try { ref?.close() } catch { /* już zamknięty */ } }
  return { stream, send, close }
}

const project: Project = {
  schemaVersion: 1, id: 'p', name: 'Test', mode: 'REF',
  video: { durationMs: 8000, fps: 24, aspect: '16:9', resolution: '768p' },
  style: 'Sitcom', assets: [],
  labels: [],
  speakers: [
    {
      id: 'sp-1', code: 'S1', characterType: 'kobieta', age: '30', gender: 'kobieta',
      pitch: 'średni', timbre: 'ciepły', rate: 'średnie', accent: 'brak',
      onScreen: true, fullDescriptor: 'a woman', shortDescriptor: 'she',
    },
  ],
  shots: [{
    id: 'shot-1', index: 0, startMs: 0, cutType: 'cut', cutPhrase: 'the camera cuts to',
    composition: '', body: [], cameraMoves: [], dialogue: [],
    screenText: [], diegeticSfx: [], labelRefs: [], anchors: [],
  }],
  audio: { overallSoundscape: 'Room tone.', nonDiegeticMusic: 'N/A' },
  ref: { taskTypes: [], summaryText: '', retention: [] },
}

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
  useProject.getState().load('test-projekt', project)
  usePlayhead.getState().reset()
  useCritic.setState({ notes: [], capturedProject: null })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Montuje panel z dostawcą już skonfigurowanym (`endpoint`, `baseUrl`
 * ustawiony) i czeka, aż to dotrze do interfejsu — pierwszy przycisk zadania
 * staje się aktywny. Trasa `POST /api/llm/run` domyślnie odpowiada zwykłym
 * JSON-em (nie strumieniem) — wystarczające dla testów sprawdzających
 * WYŁĄCZNIE treść wysłanego żądania, nie przebieg zadania. */
async function renderReady(settings: TestSettings = settingsEndpoint) {
  const calls: Array<Record<string, unknown>> = []
  const handlers = {
    ...baseHandlers(settings),
    'POST /api/llm/run': (init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return json({})
    },
  }
  vi.stubGlobal('fetch', routedFetch(handlers))
  render(<LlmPanel />)
  const user = userEvent.setup()
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Podpowiedź audio' })).toHaveAttribute('aria-disabled', 'false')
  })
  return { user, calls }
}

describe('LlmPanel — stan bez skonfigurowanego modelu', () => {
  it('w trybie wyłączonym pięć przycisków zadań jest nieaktywnych i widać wyjaśnienie', async () => {
    vi.stubGlobal('fetch', routedFetch(baseHandlers(settingsOff)))
    render(<LlmPanel />)

    await screen.findByText('Model nie jest skonfigurowany')

    for (const name of [
      'Struktura z pomysłu', 'Redakcja PL→EN', 'Podpowiedź audio', 'Krytyk', 'Tłumaczenie całego projektu',
    ]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-disabled', 'true')
    }
  })

  it('po ustawieniu endpointu przyciski (poza strukturą bez pomysłu) stają się aktywne', async () => {
    await renderReady()

    expect(screen.getByRole('button', { name: 'Krytyk' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('button', { name: 'Redakcja PL→EN' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('button', { name: 'Tłumaczenie całego projektu' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.queryByText('Model nie jest skonfigurowany')).not.toBeInTheDocument()

    // Struktura ma własną, dodatkową bramkę — bez dwóch zdań pomysłu przycisk
    // zostaje nieaktywny mimo skonfigurowanego dostawcy.
    expect(screen.getByRole('button', { name: 'Struktura z pomysłu' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('tryb zarządzany bez wystawionego serwera (status inny niż ready) nie odblokowuje zadań', async () => {
    const settingsManaged = {
      mode: 'managed' as const,
      endpoint: { baseUrl: '', apiKey: '', model: '' },
      managed: { serverBinary: '/bin/llama', modelPath: '/models/m.gguf', gpuLayers: 10, contextSize: 8192 },
    }
    vi.stubGlobal('fetch', routedFetch(baseHandlers(settingsManaged)))
    render(<LlmPanel />)

    await screen.findByText('Model nie jest skonfigurowany')
    expect(screen.getByRole('button', { name: 'Podpowiedź audio' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('sieć niedostępna przy wczytywaniu ustawień pokazuje komunikat zamiast wisieć bez odpowiedzi nieobsłużonym odrzuceniem', async () => {
    // Dokładnie ten scenariusz psuł `npm test` dla całkiem innych testów
    // (`web/test/screens/editor.test.tsx`, który montuje `Editor` i przez to
    // `LlmPanel`, nie mockując tras LLM) — efekt uboczny nieobsłużonego
    // odrzucenia obietnicy przy montowaniu. Panel ma failować bezpiecznie:
    // zostać przy trybie wyłączonym i pokazać komunikat, nie wywrócić reszty
    // aplikacji.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/llm/managed/state') return json(managedStopped)
      throw new TypeError('Failed to fetch')
    }))
    render(<LlmPanel />)

    expect(await screen.findByText(/Nie udało się wczytać ustawień dostawcy/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Podpowiedź audio' })).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('LlmPanel — klucz API nigdy nie trafia do DOM', () => {
  it('pole klucza jest puste nawet gdy odpowiedź serwera niesie klucz — a jego wartość nie pojawia się nigdzie w wyrenderowanej treści', async () => {
    const LEAKED_SECRET = 'sk-NIGDY-NIE-POKAZUJ-TEGO-W-DOM-98216'
    // Odpowiedź `GET` NIE POWINNA nieść prawdziwego klucza (`redactSettings`
    // po stronie serwera go czyści) — ale panel ma być bezpieczny nawet
    // gdyby to się kiedyś zepsuło: pole nigdy nie wiąże się z wartością z
    // sieci. Test symuluje właśnie tę regresję wprost, żeby to sprawdzić.
    const settings = { ...settingsEndpoint, endpoint: { ...settingsEndpoint.endpoint, apiKey: LEAKED_SECRET } }
    vi.stubGlobal('fetch', routedFetch(baseHandlers(settings)))
    const { container } = render(<LlmPanel />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Podpowiedź audio' })).toHaveAttribute('aria-disabled', 'false')
    })

    const keyField = screen.getByLabelText('Klucz API') as HTMLInputElement
    expect(keyField).toHaveValue('')
    // Nie tylko wartość pola — CAŁA wyrenderowana treść panelu, bo klucz
    // mógłby wyciec gdziekolwiek (etykieta, atrybut, podgląd).
    expect(container.innerHTML).not.toContain(LEAKED_SECRET)
  })
})

describe('LlmPanel — czyszczenie klucza API (fix round 1/5, punkt 1)', () => {
  /** `PUT` przyjmuje trzy znaczenia `apiKey` (`server/src/routes/llm.ts`):
   * niepusty ciąg ustawia, pusty ciąg `''` zostawia obecny bez zmian, `null`
   * czysta go. Zapisany klucz nigdy nie wraca w odpowiedzi `GET`, więc test
   * sprawdza SAMO ŻĄDANIE — to jedyne miejsce, gdzie widać, co panel
   * faktycznie zamierza zrobić z kluczem. */
  async function renderWithPutCapture() {
    const putCalls: Array<Record<string, unknown>> = []
    const handlers = {
      ...baseHandlers(settingsEndpoint),
      'PUT /api/llm/settings': (init?: RequestInit) => {
        putCalls.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return json(settingsEndpoint)
      },
    }
    vi.stubGlobal('fetch', routedFetch(handlers))
    render(<LlmPanel />)
    const user = userEvent.setup()
    // Pole klucza (i sam przycisk „Wyczyść klucz") renderują się tylko w
    // trybie `endpoint` — a to dotarło z sieci, więc to jest wiarygodny
    // sygnał, że ustawienia się już wczytały (w przeciwieństwie do „Zapisz
    // ustawienia", które jest aktywne od razu, niezależnie od stanu).
    await screen.findByLabelText('Klucz API')
    return { user, putCalls }
  }

  const expectedManaged = { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 8192 }

  it('zapis bez dotykania pola klucza wysyła pusty ciąg — "zostaw bez zmian"', async () => {
    const { user, putCalls } = await renderWithPutCapture()
    await user.click(screen.getByRole('button', { name: 'Zapisz ustawienia' }))

    expect(putCalls).toEqual([{
      mode: 'endpoint',
      endpoint: { baseUrl: 'http://localhost:1234/v1', apiKey: '', model: 'qwen' },
      managed: expectedManaged,
    }])
  })

  it('"Wyczyść klucz" wysyła null, pokazuje potwierdzenie, a pole zostaje puste — nie brudnopis sprzed czyszczenia', async () => {
    const { user, putCalls } = await renderWithPutCapture()
    await user.click(screen.getByRole('button', { name: 'Wyczyść klucz' }))

    expect(putCalls).toEqual([{
      mode: 'endpoint',
      endpoint: { baseUrl: 'http://localhost:1234/v1', apiKey: null, model: 'qwen' },
      managed: expectedManaged,
    }])

    expect(await screen.findByText('Klucz wyczyszczony.')).toBeInTheDocument()
    const keyField = screen.getByLabelText('Klucz API') as HTMLInputElement
    expect(keyField).toHaveValue('')
  })

  it('wpisanie nowego znaku po wyczyszczeniu chowa potwierdzenie — nie zostaje jako stały, mylący napis', async () => {
    const { user } = await renderWithPutCapture()
    await user.click(screen.getByRole('button', { name: 'Wyczyść klucz' }))
    expect(await screen.findByText('Klucz wyczyszczony.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Klucz API'), 'x')
    expect(screen.queryByText('Klucz wyczyszczony.')).not.toBeInTheDocument()
  })
})

describe('LlmPanel — uruchamianie zadań: kliknięcie woła trasę z właściwym rodzajem', () => {
  it('"Podpowiedź audio" woła trasę z task=audio i identyfikatorem projektu', async () => {
    const { user, calls } = await renderReady()
    await user.click(screen.getByRole('button', { name: 'Podpowiedź audio' }))
    expect(calls).toEqual([{ task: 'audio', projectSlug: 'test-projekt' }])
  })

  it('"Krytyk" woła trasę z task=critic', async () => {
    const { user, calls } = await renderReady()
    await user.click(screen.getByRole('button', { name: 'Krytyk' }))
    expect(calls).toEqual([{ task: 'critic', projectSlug: 'test-projekt' }])
  })

  it('"Tłumaczenie całego projektu" woła trasę z task=translateAll', async () => {
    const { user, calls } = await renderReady()
    await user.click(screen.getByRole('button', { name: 'Tłumaczenie całego projektu' }))
    expect(calls).toEqual([{ task: 'translateAll', projectSlug: 'test-projekt' }])
  })

  it('"Redakcja PL→EN" woła trasę z task=redact i domyślnym celem stylu', async () => {
    const { user, calls } = await renderReady()
    await user.click(screen.getByRole('button', { name: 'Redakcja PL→EN' }))
    expect(calls).toEqual([{ task: 'redact', projectSlug: 'test-projekt', target: { kind: 'style' } }])
  })

  it('zmiana celu redakcji na mówcę zmienia treść wysyłanego żądania', async () => {
    const { user, calls } = await renderReady()
    await user.selectOptions(screen.getByLabelText('Cel redakcji'), 'speaker:sp-1:fullDescriptor')
    await user.click(screen.getByRole('button', { name: 'Redakcja PL→EN' }))
    expect(calls).toEqual([{
      task: 'redact', projectSlug: 'test-projekt',
      target: { kind: 'speaker', speakerId: 'sp-1', field: 'fullDescriptor' },
    }])
  })

  it('"Struktura z pomysłu" woła trasę z task=structure i treścią dwóch zdań', async () => {
    const { user, calls } = await renderReady()
    await user.type(screen.getByLabelText('Pomysł — zdanie pierwsze'), 'Kobieta wchodzi do pokoju.')
    await user.type(screen.getByLabelText('Pomysł — zdanie drugie'), 'Siada przy oknie.')
    await user.click(screen.getByRole('button', { name: 'Struktura z pomysłu' }))
    expect(calls).toEqual([{
      task: 'structure', projectSlug: 'test-projekt',
      ideaA: 'Kobieta wchodzi do pokoju.', ideaB: 'Siada przy oknie.',
    }])
  })
})

describe('LlmPanel — anulowanie i błędy', () => {
  it('anulowanie w trakcie przywraca panel do stanu spoczynku i blokuje resztę zadań podczas biegu', async () => {
    const { stream, close } = controllableStream()
    const handlers = {
      ...baseHandlers(settingsEndpoint),
      'POST /api/llm/run': () => new Response(stream),
    }
    vi.stubGlobal('fetch', routedFetch(handlers))
    render(<LlmPanel />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Podpowiedź audio' })).toHaveAttribute('aria-disabled', 'false')
    })

    await user.click(screen.getByRole('button', { name: 'Podpowiedź audio' }))
    await screen.findByText(/W toku…/)
    // Zadanie w toku ma zablokować pozostałe przyciski zadań i formularz
    // ustawień — inaczej drugi klik uruchomiłby drugie zadanie na tym samym
    // haku, po cichu przerywając pierwsze. Sam przycisk anulowania zostaje
    // klikalny.
    expect(screen.getByRole('button', { name: 'Krytyk' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Zapisz ustawienia' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Anuluj' })).toHaveAttribute('aria-disabled', 'false')

    await user.click(screen.getByRole('button', { name: 'Anuluj' }))
    close()

    await screen.findByText(/Anulowano/)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Podpowiedź audio' })).toHaveAttribute('aria-disabled', 'false')
    })
    expect(screen.getByRole('button', { name: 'Krytyk' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.queryByRole('button', { name: 'Anuluj' })).not.toBeInTheDocument()
  })

  it('błąd z serwera pokazuje się jako komunikat i nie znika po cichu', async () => {
    const { stream, send, close } = controllableStream()
    const handlers = {
      ...baseHandlers(settingsEndpoint),
      'POST /api/llm/run': () => new Response(stream),
    }
    vi.stubGlobal('fetch', routedFetch(handlers))
    render(<LlmPanel />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Podpowiedź audio' })).toHaveAttribute('aria-disabled', 'false')
    })
    await user.click(screen.getByRole('button', { name: 'Podpowiedź audio' }))
    await screen.findByText(/W toku…/)

    send('error', { error: 'Model odpowiedział błędem walidacji.' })
    close()

    expect(await screen.findByText('Model odpowiedział błędem walidacji.')).toBeInTheDocument()
    expect(screen.getByText(/Błąd$/)).toBeInTheDocument()
  })

  it('brak liczników z serwera pokazuje się jako kreska, nie jako zero', async () => {
    const { stream, send, close } = controllableStream()
    const handlers = {
      ...baseHandlers(settingsEndpoint),
      'POST /api/llm/run': () => new Response(stream),
    }
    vi.stubGlobal('fetch', routedFetch(handlers))
    render(<LlmPanel />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Podpowiedź audio' })).toHaveAttribute('aria-disabled', 'false')
    })
    await user.click(screen.getByRole('button', { name: 'Podpowiedź audio' }))
    await screen.findByText(/W toku…/)

    send('done', { patch: { ops: [] }, promptTokens: null, completionTokens: null, repaired: false })
    close()

    await waitFor(() => {
      expect(screen.getByText(/Tokeny: — \/ —/)).toBeInTheDocument()
    })
  })

  it('licznik naprawdę zerowy pokazuje 0, nie kreskę — fix round 1/5, punkt 2', async () => {
    // Uzupełnienie pary z testem wyżej: `??` i `||` dają identyczny wynik dla
    // `null`, ale rozjeżdżają się dla `0` (`0 || '—'` daje kreskę, `0 ?? '—'`
    // daje `0`). Bez tego testu podmiana operatora nie czerwieniłaby niczego.
    const { stream, send, close } = controllableStream()
    const handlers = {
      ...baseHandlers(settingsEndpoint),
      'POST /api/llm/run': () => new Response(stream),
    }
    vi.stubGlobal('fetch', routedFetch(handlers))
    render(<LlmPanel />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Podpowiedź audio' })).toHaveAttribute('aria-disabled', 'false')
    })
    await user.click(screen.getByRole('button', { name: 'Podpowiedź audio' }))
    await screen.findByText(/W toku…/)

    send('done', { patch: { ops: [] }, promptTokens: 0, completionTokens: 0, repaired: false })
    close()

    await waitFor(() => {
      expect(screen.getByText(/Tokeny: 0 \/ 0/)).toBeInTheDocument()
    })
  })
})

describe('LlmPanel — przegląd łatki jest osiągalny po zakończeniu zadania (zadanie 11; fix round 1/5, punkt 7)', () => {
  // Recenzent: „Nothing tests that the review is reachable at all; replacing
  // its render condition with `false` leaves 501 tests green." Zdarzenie
  // `done` z NIEPUSTĄ łatką musi faktycznie wyrenderować `PatchReview` w
  // drzewie panelu — dotąd żaden test tego nie sprawdzał (istniejące testy
  // `done` niosły `patch: { ops: [] }`, więc `PatchReview` renderował się,
  // ale pokazywał tylko komunikat o pustej łatce, nigdy pole wyboru).
  it('zdarzenie "done" z niepustą łatką pokazuje sekcję przeglądu z polem wyboru operacji', async () => {
    const { stream, send, close } = controllableStream()
    const handlers = {
      ...baseHandlers(settingsEndpoint),
      'POST /api/llm/run': () => new Response(stream),
    }
    vi.stubGlobal('fetch', routedFetch(handlers))
    render(<LlmPanel />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Podpowiedź audio' })).toHaveAttribute('aria-disabled', 'false')
    })
    await user.click(screen.getByRole('button', { name: 'Podpowiedź audio' }))
    await screen.findByText(/W toku…/)

    send('done', {
      patch: { ops: [{ kind: 'setStyle', id: 'op-1', label: 'Nowy styl wizualny', text: 'Neo-noir' }] },
      promptTokens: 10, completionTokens: 5, repaired: false,
    })
    close()

    expect(await screen.findByRole('region', { name: 'Przegląd łatki' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Nowy styl wizualny' })).toBeInTheDocument()
  })
})

describe('LlmPanel — stan zarządzanego serwera (fix round 1/5, punkt 3)', () => {
  it('błąd pobrania stanu zarządzanego serwera pokazuje powód zamiast milczącej kreski', async () => {
    const settingsManaged = {
      mode: 'managed' as const,
      endpoint: { baseUrl: '', apiKey: '', model: '' },
      managed: { serverBinary: '/bin/llama', modelPath: '/models/m.gguf', gpuLayers: 10, contextSize: 8192 },
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/llm/settings') return json(settingsManaged)
      if (url === '/api/llm/managed/state') throw new TypeError('Failed to fetch')
      throw new Error(`Brak mocka dla ${url}`)
    }))
    render(<LlmPanel />)

    // Pola trybu `managed` renderują się dopiero po wczytaniu ustawień —
    // wiarygodny sygnał, że efekt montowania już się rozstrzygnął (obie
    // gałęzie: udana `getSettings`, nieudana `getManagedState`).
    await screen.findByLabelText('Ścieżka binarki serwera')
    expect(await screen.findByText(/Nie udało się pobrać stanu serwera/)).toBeInTheDocument()
    // Kreska bez wyjaśnienia (poprzednie zachowanie) nie pojawia się —
    // komunikat ZASTĘPUJE ją, nie stoi obok niej.
    expect(screen.queryByText(/Stan serwera: —/)).not.toBeInTheDocument()
  })
})

describe('LlmPanel — klawiatura nie wypływa do skrótów osi czasu', () => {
  function ShortcutsHarness() {
    useTimelineShortcuts()
    return null
  }

  it('spacja na przycisku panelu uruchamia zadanie lokalnie i nie przełącza odtwarzania', async () => {
    const calls: Array<Record<string, unknown>> = []
    const handlers = {
      ...baseHandlers(settingsEndpoint),
      'POST /api/llm/run': (init?: RequestInit) => {
        calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return json({})
      },
    }
    vi.stubGlobal('fetch', routedFetch(handlers))
    render(<><LlmPanel /><ShortcutsHarness /></>)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Podpowiedź audio' })).toHaveAttribute('aria-disabled', 'false')
    })
    expect(usePlayhead.getState().playing).toBe(false)

    const audioButton = screen.getByRole('button', { name: 'Podpowiedź audio' })
    audioButton.focus()
    await userEvent.keyboard(' ')

    // Gdyby spacja wypłynęła do globalnego nasłuchu (`useTimelineShortcuts`
    // na `window`), ten sam klawisz przełączyłby odtwarzanie — to jest
    // dokładnie błąd, który cztery zadania Planu 4 wypuściły.
    expect(usePlayhead.getState().playing).toBe(false)
    // Klawisz MUSI zostać obsłużony LOKALNIE — panel faktycznie uruchomił zadanie.
    expect(calls).toEqual([{ task: 'audio', projectSlug: 'test-projekt' }])
  })

  it('enter na przycisku panelu uruchamia zadanie lokalnie i nie przełącza odtwarzania', async () => {
    const calls: Array<Record<string, unknown>> = []
    const handlers = {
      ...baseHandlers(settingsEndpoint),
      'POST /api/llm/run': (init?: RequestInit) => {
        calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return json({})
      },
    }
    vi.stubGlobal('fetch', routedFetch(handlers))
    render(<><LlmPanel /><ShortcutsHarness /></>)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Krytyk' })).toHaveAttribute('aria-disabled', 'false')
    })
    expect(usePlayhead.getState().playing).toBe(false)

    const criticButton = screen.getByRole('button', { name: 'Krytyk' })
    criticButton.focus()
    await userEvent.keyboard('{Enter}')

    expect(usePlayhead.getState().playing).toBe(false)
    expect(calls).toEqual([{ task: 'critic', projectSlug: 'test-projekt' }])
  })
})

describe('LlmPanel — uwagi krytyka trafiają do store\'u panelu walidacji (zadanie 12)', () => {
  it('zakończone zadanie "critic" zapisuje uwagi w useCritic razem z referencją bieżącego projektu', async () => {
    const { stream, send, close } = controllableStream()
    const handlers = {
      ...baseHandlers(settingsEndpoint),
      'POST /api/llm/run': () => new Response(stream),
    }
    vi.stubGlobal('fetch', routedFetch(handlers))
    render(<LlmPanel />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Krytyk' })).toHaveAttribute('aria-disabled', 'false')
    })
    expect(useCritic.getState().notes).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Krytyk' }))
    await screen.findByText(/W toku…/)

    send('done', {
      notes: [{ ref: { kind: 'shot', id: 'shot-1' }, message: 'Test uwaga.', severity: 'hint' }],
      promptTokens: 3, completionTokens: 6, repaired: false,
    })
    close()

    await waitFor(() => {
      expect(useCritic.getState().notes).toEqual([
        { ref: { kind: 'shot', id: 'shot-1' }, message: 'Test uwaga.', severity: 'hint' },
      ])
    })
    // Referencja PROJEKTU w chwili zapisania uwag — dokładnie ta, po której
    // panel walidacji rozpozna nieaktualność przy kolejnej edycji.
    expect(useCritic.getState().capturedProject).toBe(useProject.getState().project)
  })

  it('inne zadanie (np. "audio") nie rusza store\'u uwag krytyka — jego odpowiedź nie niesie notes', async () => {
    const { stream, send, close } = controllableStream()
    const handlers = {
      ...baseHandlers(settingsEndpoint),
      'POST /api/llm/run': () => new Response(stream),
    }
    vi.stubGlobal('fetch', routedFetch(handlers))
    render(<LlmPanel />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Podpowiedź audio' })).toHaveAttribute('aria-disabled', 'false')
    })
    await user.click(screen.getByRole('button', { name: 'Podpowiedź audio' }))
    await screen.findByText(/W toku…/)

    send('done', { patch: { ops: [] }, promptTokens: 1, completionTokens: 1, repaired: false })
    close()

    await waitFor(() => {
      expect(screen.getByText(/Gotowe/)).toBeInTheDocument()
    })
    expect(useCritic.getState().notes).toEqual([])
    expect(useCritic.getState().capturedProject).toBeNull()
  })
})
