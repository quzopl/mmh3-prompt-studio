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

/** Strumień, który przyjmuje surowe bajty zamiast całych zdarzeń SSE —
 * `controllableStream` wyżej zawsze wpycha jeden KOMPLETNY blok zdarzenia na
 * `send()`, więc nie da się nim odtworzyć kawałka rozdzielonego w pół między
 * dwoma odczytami sieci (runda 1 recenzji zadania 9: dokładnie ta luka —
 * dziewięć testów haka, ani jeden nie dzielił ramki w połowie). Ten helper
 * pozwala wepchnąć dowolny fragment tekstu albo surowych bajtów, więc test
 * decyduje sam, gdzie dokładnie przecina zdarzenie. */
function rawStream() {
  let ref: ReadableStreamDefaultController<Uint8Array> | null = null
  const stream = new ReadableStream<Uint8Array>({ start: controller => { ref = controller } })
  const encoder = new TextEncoder()
  const pushText = (text: string): void => { ref?.enqueue(encoder.encode(text)) }
  const pushBytes = (bytes: Uint8Array): void => { ref?.enqueue(bytes) }
  const close = (): void => ref?.close()
  return { stream, pushText, pushBytes, close }
}

/** Jedno zdarzenie SSE w kształcie, którego oczekuje `readEventStream`. */
const sseEvent = (event: string, data: unknown): string => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

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

// Runda 1 recenzji zadania 9: dziewięć testów wyżej, ani jeden nie dzielił
// ramki SSE między dwa odczyty sieci — dokładnie usterka, o którą pyta brief
// zadania po stronie, której brief nie nazwał. `controllableStream.send()`
// zawsze wpycha kompletne zdarzenie za jednym razem, więc podmiana
// `buffer += decoder.decode(value, { stream: true })` na
// `buffer = decoder.decode(value)` w `readEventStream` przechodziła bez
// żadnej czerwonej asercji. Te testy dzielą ramkę w trzech miejscach z
// briefu: w środku prefiksu "data:", w środku samego JSON-a, i dokładnie na
// granicy pustej linii kończącej zdarzenie — każdy zweryfikowany jako
// czerwony przeciw zepsutemu dekoderowi przed przywróceniem poprawki.
describe('useLlmRun — kawałek strumienia rozdzielony w pół między dwoma odczytami sieci', () => {
  it('rozdzielony dokładnie w środku prefiksu "data:" jest sklejany, nie gubiony', async () => {
    const { stream, pushText, close } = rawStream()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)
    act(() => currentOf(box).run(request))

    const full = sseEvent('chunk', { text: 'część' })
    const cut = full.indexOf('data:') + 2 // po "da", w środku "ta:"

    await act(async () => { pushText(full.slice(0, cut)); await flush() })
    // Kawałek niekompletny — nie ma jeszcze pełnej granicy "\n\n" w buforze.
    expect(currentOf(box).text).toBe('')

    await act(async () => {
      pushText(full.slice(cut))
      close()
      await flush()
    })
    expect(currentOf(box).text).toBe('część')
  })

  it('rozdzielony w środku samego JSON-a jest sklejany, nie gubiony', async () => {
    const { stream, pushText, close } = rawStream()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)
    act(() => currentOf(box).run(request))

    const full = sseEvent('chunk', { text: 'odpowiedź modelu' })
    const cut = full.indexOf('"odpowiedź') + 6 // w środku wartości JSON-a

    await act(async () => { pushText(full.slice(0, cut)); await flush() })
    expect(currentOf(box).text).toBe('')

    await act(async () => {
      pushText(full.slice(cut))
      close()
      await flush()
    })
    expect(currentOf(box).text).toBe('odpowiedź modelu')
  })

  it('rozdzielony dokładnie na granicy pustej linii kończącej zdarzenie jest sklejany, nie gubiony', async () => {
    const { stream, pushText, close } = rawStream()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)
    act(() => currentOf(box).run(request))

    const full = sseEvent('chunk', { text: 'ok' })
    const boundary = full.indexOf('\n\n') + 1 // dokładnie między dwoma znakami nowej linii

    await act(async () => { pushText(full.slice(0, boundary)); await flush() })
    // Tylko jeden z dwóch znaków granicy dotarł — zdarzenie wciąż niekompletne.
    expect(currentOf(box).text).toBe('')

    await act(async () => {
      pushText(full.slice(boundary))
      close()
      await flush()
    })
    expect(currentOf(box).text).toBe('ok')
  })

  // "Cut inside a multi-byte character on both sides" (runda 1 recenzji) —
  // string sam w sobie nigdy nie dzieli punktu kodowego w środku (`.slice`
  // tnie między znakami), więc ten test tnie gotowe BAJTY zakodowanego
  // tekstu, dokładnie w środku dwubajtowego kodowania polskiej litery —
  // ta sama technika, co po stronie serwera w `stream.test.ts`.
  it('rozdzielony w środku wielobajtowego znaku UTF-8 (polska litera) nie ginie i nie zamienia się w znak zastępczy', async () => {
    const { stream, pushBytes, close } = rawStream()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)
    act(() => currentOf(box).run(request))

    const encoder = new TextEncoder()
    const fullText = sseEvent('chunk', { text: 'łąka' })
    const charIndex = fullText.indexOf('ą')
    const bytesBeforeChar = encoder.encode(fullText.slice(0, charIndex)).length
    const charByteLength = encoder.encode('ą').length
    expect(charByteLength).toBe(2) // sanity: „ą" to dwa bajty w UTF-8

    const fullBytes = encoder.encode(fullText)
    const splitPoint = bytesBeforeChar + 1 // dokładnie w środku dwubajtowego znaku

    await act(async () => { pushBytes(fullBytes.slice(0, splitPoint)); await flush() })
    expect(currentOf(box).text).toBe('')

    await act(async () => {
      pushBytes(fullBytes.slice(splitPoint))
      close()
      await flush()
    })
    expect(currentOf(box).text).toBe('łąka')
    expect(currentOf(box).text).not.toContain('�')
  })
})

// Runda 1 recenzji zadania 9: brak serwera zgłaszającego `usage` (np. lokalny
// serwer bez wsparcia `stream_options`) nie może wyglądać jak zgłoszone zero.
describe('useLlmRun — liczniki tokenów jako number | null', () => {
  it('gdy serwer nie zgłasza completionTokens (null), tokens NIE spada do zera — zostaje przy przybliżeniu z kawałków', async () => {
    const { stream, send, close } = controllableStream()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)

    act(() => currentOf(box).run(request))
    await act(async () => { send('chunk', { text: 'a' }); await flush() })
    await act(async () => { send('chunk', { text: 'b' }); await flush() })
    expect(currentOf(box).tokens).toBe(2)

    await act(async () => {
      send('done', { patch: { ops: [] }, promptTokens: null, completionTokens: null, repaired: false })
      close()
      await flush()
    })

    expect(currentOf(box).status).toBe('done')
    // Runda 1: TU jest usterka, którą zgłosił recenzent — `tokens` cichło do
    // zera, bo `typeof null === 'object'`, a stara asercja `=== 'number'`
    // działała jako filtr TYLKO wtedy, gdy serwer sam już zamienił brak na
    // literalne zero. Teraz serwer zgłasza `null` uczciwie, a hak ma się na
    // to nie dać nabrać: zero nie jest lepszym przybliżeniem niż 2.
    expect(currentOf(box).tokens).toBe(2)
    expect(currentOf(box).promptTokens).toBeNull()
    expect(currentOf(box).completionTokens).toBeNull()
  })

  it('gdy serwer zgłasza dokładne liczniki, tokens przyjmuje tę wartość, a promptTokens/completionTokens są liczbami', async () => {
    const { stream, send, close } = controllableStream()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)

    act(() => currentOf(box).run(request))
    await act(async () => { send('chunk', { text: 'a' }); await flush() })

    await act(async () => {
      send('done', { patch: { ops: [] }, promptTokens: 5, completionTokens: 99, repaired: false })
      close()
      await flush()
    })

    expect(currentOf(box).tokens).toBe(99)
    expect(currentOf(box).promptTokens).toBe(5)
    expect(currentOf(box).completionTokens).toBe(99)
  })
})

// Runda 1 recenzji zadania 9: zdarzenie "repair" sygnalizuje start drugiej,
// naprawczej próby — bez niego przerwa między nieudaną pierwszą odpowiedzią
// a drugim zapytaniem do modelu nie miałaby żadnego zdarzenia, i tekst drugiej
// próby doklejałby się do zepsutego JSON-a pierwszej w jeden run-on.
describe('useLlmRun — zdarzenie "repair" (druga, naprawcza próba)', () => {
  it('resetuje text i tokens, ustawia retrying na true; po "done" retrying wraca do false, a text to WYŁĄCZNIE druga próba', async () => {
    const { stream, send, close } = controllableStream()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)

    act(() => currentOf(box).run(request))
    expect(currentOf(box).retrying).toBe(false)

    await act(async () => { send('chunk', { text: 'pierwsza próba, zły JSON' }); await flush() })
    expect(currentOf(box).text).toBe('pierwsza próba, zły JSON')
    expect(currentOf(box).tokens).toBe(1)

    await act(async () => { send('repair', {}); await flush() })
    expect(currentOf(box).retrying).toBe(true)
    expect(currentOf(box).text).toBe('')
    expect(currentOf(box).tokens).toBe(0)
    expect(currentOf(box).status).toBe('running') // wciąż w toku, nie nowy/inny stan

    await act(async () => { send('chunk', { text: 'druga próba' }); await flush() })
    // Kluczowa asercja: NIE 'pierwsza próba, zły JSONdruga próba'.
    expect(currentOf(box).text).toBe('druga próba')

    await act(async () => {
      send('done', { patch: { ops: [] }, promptTokens: 1, completionTokens: 1, repaired: true })
      close()
      await flush()
    })

    expect(currentOf(box).status).toBe('done')
    expect(currentOf(box).retrying).toBe(false)
    expect(currentOf(box).text).toBe('druga próba')
  })
})

// Runda 1 recenzji zadania 9: kawałek, którego nie da się rozebrać jako JSON,
// to usterka STRUMIENIA, nie sieci — poprzednia wersja dawała
// `llm.networkError` ("nie udało się połączyć z serwerem"), co jest fałszywe:
// połączenie działa, model po prostu wysłał coś zepsutego.
describe('useLlmRun — kawałek strumienia, którego nie da się rozebrać jako JSON', () => {
  it('daje status error z komunikatem o strumieniu, NIE z komunikatem sieciowym', async () => {
    const { stream, pushText, close } = rawStream()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)

    act(() => currentOf(box).run(request))
    await act(async () => {
      pushText('event: chunk\ndata: {zepsuty json bez zamknięcia\n\n')
      close()
      await flush()
    })

    expect(currentOf(box).status).toBe('error')
    expect(currentOf(box).error).toBe('Błąd podczas odczytu odpowiedzi strumienia.')
    expect(currentOf(box).error).not.toBe('Nie udało się połączyć z serwerem.')
  })
})

// Runda 1 recenzji zadania 9: `useT()` zwraca nową funkcję przy każdym
// renderze, a `elapsedMs` wywołuje nowy render co 100 ms przez cały czas
// trwania zadania. Gdyby `t` siedziało w tablicy zależności `run`, `run`
// zmieniałoby tożsamość dziesięć razy na sekundę — dowolny konsument z
// `useEffect(…, [run])` zapętliłby się.
describe('useLlmRun — stabilność referencji run()', () => {
  it('run nie zmienia tożsamości mimo częstych re-renderów w trakcie działania ani zmiany języka', async () => {
    vi.useFakeTimers()
    const { stream, send, close } = controllableStream()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)

    const runBeforeStart = currentOf(box).run
    act(() => currentOf(box).run(request))
    expect(currentOf(box).run).toBe(runBeforeStart)

    // Kilka tyknięć zegara elapsedMs — kilka re-renderów wywołanych stanem.
    act(() => { vi.advanceTimersByTime(100) })
    act(() => { vi.advanceTimersByTime(100) })
    act(() => { vi.advanceTimersByTime(100) })
    expect(currentOf(box).run).toBe(runBeforeStart)

    // Zmiana języka — `useT()` zwraca inną funkcję `t`, a `run` mimo to
    // zostaje tym samym obiektem funkcji.
    act(() => { useLang.setState({ lang: 'en' }) })
    expect(currentOf(box).run).toBe(runBeforeStart)

    await act(async () => {
      send('done', { patch: { ops: [] }, promptTokens: 1, completionTokens: 1, repaired: false })
      close()
      await flush()
    })
    expect(currentOf(box).status).toBe('done')
  })
})

// Zadanie 12: krytyk nie zwraca łatki (patrz `routes/llm.ts`, przypadek
// `'critic'`) tylko `notes` — pole dotąd wystawiane przez trasę, ale nigdy
// nie czytane po stronie klienta. Panel walidacji (`ValidationPanel`, przez
// `store/criticStore.ts`) jest pierwszym konsumentem.
describe('useLlmRun — notes (uwagi krytyka)', () => {
  it('zaczyna jako null i zostaje null dla zadania, którego odpowiedź niesie tylko łatkę', async () => {
    const { stream, send, close } = controllableStream()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)

    expect(currentOf(box).notes).toBeNull()
    act(() => currentOf(box).run(request))
    expect(currentOf(box).notes).toBeNull()

    await act(async () => {
      send('done', { patch: { ops: [] }, promptTokens: 1, completionTokens: 1, repaired: false })
      close()
      await flush()
    })
    expect(currentOf(box).status).toBe('done')
    expect(currentOf(box).notes).toBeNull()
  })

  it('przyjmuje listę uwag z odpowiedzi "done", gdy odpowiedź niesie pole notes', async () => {
    const { stream, send, close } = controllableStream()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)

    act(() => currentOf(box).run({ task: 'critic', projectSlug: 'test-projekt' }))
    await act(async () => {
      send('done', {
        notes: [{ ref: { kind: 'shot', id: 'shot-1' }, message: 'Ujęcie trwa zbyt długo.', severity: 'warning' }],
        promptTokens: 4, completionTokens: 9, repaired: false,
      })
      close()
      await flush()
    })

    expect(currentOf(box).status).toBe('done')
    expect(currentOf(box).notes).toEqual([
      { ref: { kind: 'shot', id: 'shot-1' }, message: 'Ujęcie trwa zbyt długo.', severity: 'warning' },
    ])
    // Zadanie krytyka nie niesie łatki — `patch` zostaje `null`.
    expect(currentOf(box).patch).toBeNull()
  })

  it('kolejny bieg resetuje notes do null, zanim nowa odpowiedź przyjdzie', async () => {
    const first = controllableStream()
    const second = controllableStream()
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1
      return new Response(call === 1 ? first.stream : second.stream)
    }))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)

    act(() => currentOf(box).run({ task: 'critic', projectSlug: 'test-projekt' }))
    await act(async () => {
      first.send('done', {
        notes: [{ ref: { kind: 'shot', id: 'shot-1' }, message: 'stara uwaga', severity: 'hint' }],
        promptTokens: 1, completionTokens: 1, repaired: false,
      })
      first.close()
      await flush()
    })
    expect(currentOf(box).notes).toHaveLength(1)

    act(() => currentOf(box).run({ task: 'critic', projectSlug: 'test-projekt' }))
    expect(currentOf(box).notes).toBeNull()

    await act(async () => {
      second.send('done', { notes: [], promptTokens: 1, completionTokens: 1, repaired: false })
      second.close()
      await flush()
    })
    expect(currentOf(box).notes).toEqual([])
  })

  it('odrzuca kształt spoza kontraktu (np. severity spoza "hint"/"warning") — notes zostaje null, nie śmieciem', async () => {
    const { stream, send, close } = controllableStream()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
    const box: { current: UseLlmRunResult | null } = { current: null }
    render(<Harness box={box} />)

    act(() => currentOf(box).run({ task: 'critic', projectSlug: 'test-projekt' }))
    await act(async () => {
      send('done', {
        notes: [{ ref: { kind: 'shot', id: 'shot-1' }, message: 'x', severity: 'error' }],
        promptTokens: 1, completionTokens: 1, repaired: false,
      })
      close()
      await flush()
    })

    expect(currentOf(box).notes).toBeNull()
  })
})
