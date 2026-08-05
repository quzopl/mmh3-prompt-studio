import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useLlmRun, type UseLlmRunResult, type LlmRunRequest } from '../../src/llm/useLlmRun.js'
import { useLang } from '../../src/i18n/useT.js'

/**
 * Zadanie 9: `useLlmRun` rozmawia z trasą `POST /api/llm/run` przez
 * `text/event-stream` (`chunk`, `done`, `error`) — testy mockują `fetch` tak,
 * jak reszta repo mockuje odpowiedzi HTTP (patrz `openai.test.ts` po stronie
 * serwera), ale ciałem odpowiedzi jest tu sterowany z testu `ReadableStream`,
 * żeby dało się obserwować stan MIĘDZY kawałkami, nie tylko na samym końcu.
 */

beforeEach(() => {
  useLang.setState({ lang: 'pl' })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** Strumień sterowany ręcznie z testu — `send` wpycha kolejne zdarzenie SSE
 * dopiero, gdy test o to poprosi, więc stan haka między kawałkami (w trakcie
 * `running`, przed `done`) jest czymś, co da się faktycznie zaobserwować,
 * zamiast zgadywać z gotowej, zamkniętej odpowiedzi. */
function controllableStream() {
  let ref: ReadableStreamDefaultController<Uint8Array> | null = null
  const stream = new ReadableStream<Uint8Array>({ start: controller => { ref = controller } })
  const encoder = new TextEncoder()
  const send = (event: string, data: unknown): void => {
    // `cancel()` na czytniku zamyka strumień pod spodem (zob. WHATWG Streams)
    // — próba wepchnięcia kolejnego kawałka po przerwaniu rzuca, tak jak
    // rzuciłoby prawdziwe pisanie do gniazda, którego już nie ma. Test na
    // zachowanie PO przerwaniu chce właśnie to sprawdzić, więc traktujemy to
    // tak samo jak serwer traktuje pisanie po przerwaniu — po cichu nic.
    try {
      ref?.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    } catch {
      // strumień już zamknięty przez `reader.cancel()` — nic do wysłania
    }
  }
  const close = (): void => ref?.close()
  return { stream, send, close }
}

/** Odpowiednik kilku ticków mikrozadań — wystarczy, żeby pętla czytająca
 * strumień w `useLlmRun` (kilka zagnieżdżonych `await`) zdążyła przetworzyć
 * kawałek właśnie wepchnięty przez `send()` i wywołać `setState`. Nie zależy
 * od żadnego zegara (prawdziwego ani sterowanego), więc działa identycznie
 * pod `vi.useFakeTimers()` i bez niego. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

function Harness({ box }: { box: { current: UseLlmRunResult | null } }) {
  box.current = useLlmRun()
  return null
}

function currentOf(box: { current: UseLlmRunResult | null }): UseLlmRunResult {
  if (box.current === null) throw new Error('useLlmRun jeszcze nie zamontowany')
  return box.current
}

const request: LlmRunRequest = { task: 'structure', projectSlug: 'test-projekt', ideaA: 'a', ideaB: 'b' }

describe('useLlmRun — status i treść', () => {
  it('status przechodzi idle → running → done, tekst rośnie z kawałków, łatka przychodzi dopiero w "done"', async () => {
    const { stream, send, close } = controllableStream()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)

    expect(currentOf(box).status).toBe('idle')

    act(() => currentOf(box).run(request))
    expect(currentOf(box).status).toBe('running')

    await act(async () => {
      send('chunk', { text: 'Kobieta ' })
      await flush()
    })
    expect(currentOf(box).text).toBe('Kobieta ')
    // Kawałki płyną, ale łatka jeszcze nie istnieje — buduje się dopiero po
    // zamknięciu strumienia (brief zadania 9), nigdy w jego trakcie.
    expect(currentOf(box).patch).toBeNull()

    await act(async () => {
      send('chunk', { text: 'czeka.' })
      await flush()
    })
    expect(currentOf(box).text).toBe('Kobieta czeka.')

    await act(async () => {
      send('done', {
        patch: { ops: [{ kind: 'setStyle', id: '1', label: 'styl', text: 'x' }] },
        promptTokens: 11,
        completionTokens: 22,
        repaired: false,
      })
      close()
      await flush()
    })

    expect(currentOf(box).status).toBe('done')
    expect(currentOf(box).patch).toEqual({ ops: [{ kind: 'setStyle', id: '1', label: 'styl', text: 'x' }] })
  })

  it('tokens rośnie z każdym przyjętym kawałkiem, a na końcu przyjmuje dokładną wartość z serwera', async () => {
    const { stream, send, close } = controllableStream()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)

    act(() => currentOf(box).run(request))
    expect(currentOf(box).tokens).toBe(0)

    await act(async () => { send('chunk', { text: 'a' }); await flush() })
    expect(currentOf(box).tokens).toBe(1)

    await act(async () => { send('chunk', { text: 'b' }); await flush() })
    expect(currentOf(box).tokens).toBe(2)

    await act(async () => {
      send('done', { patch: { ops: [] }, promptTokens: 5, completionTokens: 99, repaired: false })
      close()
      await flush()
    })
    expect(currentOf(box).tokens).toBe(99)
  })
})

describe('useLlmRun — anulowanie', () => {
  it("cancel w trakcie daje status: 'cancelled' i przerywa połączenie (sygnał przekazany do fetch zostaje przerwany)", async () => {
    // Strumień, który nigdy nic nie wysyła — model wciąż "myśli", dokładnie
    // sytuacja, w której użytkownik naciska anuluj.
    const { stream } = controllableStream()
    let capturedSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      capturedSignal = init.signal ?? undefined
      return new Response(stream)
    }))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)

    act(() => currentOf(box).run(request))
    await act(async () => { await flush() })
    expect(currentOf(box).status).toBe('running')
    expect(capturedSignal?.aborted).toBe(false)

    await act(async () => {
      currentOf(box).cancel()
      await flush()
    })

    expect(currentOf(box).status).toBe('cancelled')
    // To jest sprawdzian „nie zostaje otwarte połączenie": ten sam sygnał,
    // który poszedł do `fetch`, musi być przerwany — inaczej żądanie do
    // serwera (a przez niego do modelu) leciałoby dalej mimo `cancel()`.
    expect(capturedSignal?.aborted).toBe(true)
  })

  it('kawałki wysłane PO cancel() nie zmieniają już tekstu — nic nie pisze po przerwaniu', async () => {
    const { stream, send } = controllableStream()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)

    act(() => currentOf(box).run(request))
    await act(async () => {
      send('chunk', { text: 'przed' })
      await flush()
    })
    expect(currentOf(box).text).toBe('przed')

    await act(async () => {
      currentOf(box).cancel()
      await flush()
    })
    const textAtCancel = currentOf(box).text

    await act(async () => {
      send('chunk', { text: 'po anulowaniu — nie powinno dotrzeć' })
      await flush()
    })
    expect(currentOf(box).text).toBe(textAtCancel)
    expect(currentOf(box).status).toBe('cancelled')
  })

  it('drugie wywołanie run() przed zakończeniem pierwszego nie pozwala spóźnionemu przerwaniu starego biegu nadpisać stanu nowego', async () => {
    // `run()` przerywa poprzedni bieg sam z siebie (zanim zdąży to zrobić
    // użytkownik przyciskiem „anuluj"), ale to przerwanie rozstrzyga się
    // asynchronicznie — pętla czytająca starego biegu musi jeszcze zauważyć
    // `signal.aborted`. Gdyby nic tego nie pilnowało, spóźniony `onCancelled`
    // starego biegu nadpisałby `status` nowego biegu na `'cancelled'` mimo że
    // nowy bieg wciąż trwa (albo już się skończył sukcesem).
    const first = controllableStream()
    const second = controllableStream()
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1
      return new Response(call === 1 ? first.stream : second.stream)
    }))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)

    act(() => currentOf(box).run(request))
    await act(async () => { await flush() })
    expect(currentOf(box).status).toBe('running')

    // Drugie wywołanie run() — jeszcze zanim pierwszy bieg się domknął.
    // Wewnątrz `run()` synchronicznie przerywa pierwszy sterownik, ale jego
    // pętla czytająca (nasłuch na `abort`, `reader.cancel()`, kolejne
    // mikrozadania) dogania się dopiero w `flush()` poniżej.
    await act(async () => {
      currentOf(box).run(request)
      await flush()
    })
    expect(currentOf(box).status).toBe('running')

    await act(async () => {
      second.send('done', { patch: { ops: [] }, promptTokens: 1, completionTokens: 3, repaired: false })
      second.close()
      await flush()
    })

    // Gdyby stary bieg zdążył nadpisać stan, `status` byłby `'cancelled'`
    // zamiast `'done'`, a liczniki (tokens/elapsedMs) pochodziłyby z jego
    // (zerowego) przerwania zamiast z prawdziwej odpowiedzi drugiego biegu.
    expect(currentOf(box).status).toBe('done')
    expect(currentOf(box).tokens).toBe(3)
    expect(currentOf(box).patch).toEqual({ ops: [] })
  })
})

describe('useLlmRun — elapsedMs (zegar sterowany, nie prawdziwy czas)', () => {
  it('rośnie w trakcie działania i zatrzymuje się dokładnie na końcu', async () => {
    vi.useFakeTimers()
    const { stream, send, close } = controllableStream()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)

    act(() => currentOf(box).run(request))
    expect(currentOf(box).elapsedMs).toBe(0)

    act(() => { vi.advanceTimersByTime(300) })
    expect(currentOf(box).elapsedMs).toBeGreaterThanOrEqual(300)

    act(() => { vi.advanceTimersByTime(200) })
    expect(currentOf(box).elapsedMs).toBeGreaterThanOrEqual(500)

    await act(async () => {
      send('done', { patch: { ops: [] }, promptTokens: 1, completionTokens: 1, repaired: false })
      close()
      await flush()
    })
    expect(currentOf(box).status).toBe('done')
    const finalElapsed = currentOf(box).elapsedMs
    expect(finalElapsed).toBeGreaterThanOrEqual(500)

    // Po zakończeniu zegar stoi — dalszy upływ czasu nie zmienia już `elapsedMs`.
    act(() => { vi.advanceTimersByTime(1000) })
    expect(currentOf(box).elapsedMs).toBe(finalElapsed)
  })
})

describe('useLlmRun — błędy', () => {
  it("błąd serwera (zanim strumień w ogóle wystartował) daje status: 'error' z komunikatem, nie pustkę", async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Model nie jest skonfigurowany' }), { status: 409 })))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)

    await act(async () => {
      currentOf(box).run(request)
      await flush()
    })

    expect(currentOf(box).status).toBe('error')
    expect(currentOf(box).error).toBe('Model nie jest skonfigurowany')
  })

  it('zdarzenie "error" w środku strumienia też daje status error z komunikatem — nie cichnie', async () => {
    const { stream, send, close } = controllableStream()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)

    act(() => currentOf(box).run(request))
    await act(async () => {
      send('chunk', { text: 'coś tam' })
      await flush()
    })

    await act(async () => {
      send('error', { error: 'Zadanie „struktura ujęć": odpowiedź modelu nie jest poprawnym JSON-em.' })
      close()
      await flush()
    })

    expect(currentOf(box).status).toBe('error')
    expect(currentOf(box).error).toBe('Zadanie „struktura ujęć": odpowiedź modelu nie jest poprawnym JSON-em.')
    // Tekst sprzed błędu zostaje widoczny — użytkownik widzi, co model zdążył powiedzieć.
    expect(currentOf(box).text).toBe('coś tam')
  })

  it('sieć niedostępna (fetch rzuca) daje status error z polskim komunikatem', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)

    await act(async () => {
      currentOf(box).run(request)
      await flush()
    })

    expect(currentOf(box).status).toBe('error')
    expect(currentOf(box).error).toBe('Nie udało się połączyć z serwerem.')
  })
})
