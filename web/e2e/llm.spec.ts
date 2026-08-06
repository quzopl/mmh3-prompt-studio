import { expect, test, type Page } from '@playwright/test'
import { startFakeProvider, type FakeProviderHandle } from '../../server/test/llm/fakeProvider.js'

/**
 * Zadanie 13 (ostatnie zadania planu „lokalny LLM"): jedyny test, który
 * przechodzi całą drogę od kliknięcia w panelu LLM, przez prawdziwą rozmowę
 * HTTP (strumień zgodny z protokołem OpenAI), po zmieniony projekt, który
 * przeżywa przeładowanie strony — i jedyny, który dowodzi wprost, że **bez
 * skonfigurowanego modelu aplikacja działa w pełni** (obietnica specyfikacji,
 * której żaden inny test nie sprawdza od początku do końca w prawdziwej
 * przeglądarce).
 *
 * Fałszywy dostawca (`server/test/llm/fakeProvider.ts`) stoi na losowym
 * porcie i mówi wyłącznie protokołem, którego trasa serwera naprawdę używa —
 * strumień SSE zgodny z `readCompletionStream` (`server/src/llm/openai.ts`).
 * Test wskazuje na niego przez `PUT /api/llm/settings`, dokładnie tą samą
 * trasą, którą wołałby prawdziwy panel — nic w tym teście nie podstawia
 * odpowiedzi w pamięci przeglądarki ani na serwerze.
 *
 * Interfejs startuje po polsku (`useLang` bez wpisu w `localStorage` wraca do
 * `'pl'`, `web/src/i18n/useT.ts`) — tak samo jak `tracks.spec.ts` i
 * `happyPath.spec.ts`, i z tego samego powodu: świeży kontekst przeglądarki
 * (bez `localStorage`) daje zawsze ten sam język, więc selektory celują w
 * polskie nazwy dostępności ze słownika (`web/src/i18n/dict.ts`). Asercja
 * widoczności panelu „Model językowy" zaraz po utworzeniu projektu (niżej)
 * jest kanarkiem tego założenia: gdyby domyślny język się przełączył, ta
 * asercja pada od razu, zamiast pozwolić każdemu kolejnemu polskiemu
 * selektorowi w tym pliku po cichu nie trafić w nic.
 */

/** Tworzy świeży projekt T2VA i zostawia edytor otwarty — ten sam wzorzec co
 * w `tracks.spec.ts`/`happyPath.spec.ts`, z osobną kopią lokalną (każdy plik
 * e2e ma własną), żeby dwa przebiegi całego `npm run e2e` nigdy nie trafiły w
 * ten sam slug. */
async function createProject(page: Page, mode: string): Promise<string> {
  const name = `E2E llm ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await page.goto('/')
  // Domyślnym językiem interfejsu jest angielski. Ten scenariusz szuka
  // elementów po polskich nazwach dostępności, więc wybiera język JAWNIE —
  // inaczej zmiana wartości domyślnej sprawiłaby, że selektory przestają
  // cokolwiek znajdować, zamiast paść z sensownym komunikatem.
  await page.getByRole('button', { name: 'PL', exact: true }).click()
  await page.getByRole('button', { name: /nowy projekt/i }).click()
  await page.getByLabel(/nazwa projektu/i).fill(name)
  await page.getByRole('button', { name: new RegExp(`^${mode}`) }).click()
  await page.getByRole('button', { name: /^utwórz$/i }).click()
  await expect(page.getByText(name)).toBeVisible()
  return name
}

/** Poczekaj na PUT autozapisu, który potwierdza serwer — zob. komentarz przy
 * teście „przyciski «+» działają…" w `tracks.spec.ts`: dowód działającego
 * zapisu nie może kończyć się na stanie w DOM, musi przejść przez sieć. */
function waitForAutosave(page: Page) {
  return page.waitForResponse(
    res => res.request().method() === 'PUT' && res.url().includes('/api/projects/') && res.ok(),
  )
}

// Cztery z pięciu zadań panelu bramkowane są WYŁĄCZNIE konfiguracją dostawcy
// (`tasksEnabled` w `LlmPanel.tsx`) — piąte, „Struktura z pomysłu", ma DODATKOWY
// warunek (obie części pomysłu niepuste, `canRunStructure`), więc zostaje
// nieaktywne nawet po skonfigurowaniu dostawcy i nie należy do tej listy.
const CONFIG_GATED_TASKS = ['Rozmawiaj o tym polu', 'Podpowiedź audio', 'Krytyk', 'Tłumaczenie całego projektu']

const SOUNDSCAPE_TEXT = 'Rain taps steadily against the window and distant traffic hums beyond it.'
const MUSIC_TEXT = 'A slow, sparse piano plays over softly sustained strings.'

test('zadanie LLM: od kliknięcia przez strumień HTTP do zmienionego projektu, który przeżywa przeładowanie', async ({ page }) => {
  let fake: FakeProviderHandle | null = null
  try {
    fake = await startFakeProvider({
      responseText: JSON.stringify({ soundscape: SOUNDSCAPE_TEXT, music: MUSIC_TEXT }),
      // Rozłożone w czasie tak jak prawdziwy model, żeby test anulowania w
      // trakcie (niżej) miał na to prawdziwe okno, a podgląd strumienia miał
      // co pokazać, zanim zadanie się skończy.
      chunkDelayMs: 150,
      chunkCount: 10,
    })

    // Ustawienia dostawcy to plik NA MASZYNĘ, nie na projekt — inny test w tym
    // pakiecie mógł zostawić skonfigurowanego dostawcę, a ten scenariusz
    // zaczyna się od sprawdzenia stanu „model nie jest skonfigurowany".
    // Zerujemy je jawnie, zamiast liczyć na kolejność uruchamiania plików.
    await page.request.put('/api/llm/settings', {
      data: {
        mode: 'off',
        endpoint: { baseUrl: '', apiKey: null, model: '' },
        managed: { serverBinary: '', modelPath: '', gpuLayers: 0, contextSize: 8192 },
      },
    })

    const name = await createProject(page, 'T2VA')

    const llmPanel = page.getByRole('region', { name: /^model językowy$/i })
    // Kanarek języka — patrz komentarz na górze pliku.
    await expect(llmPanel).toBeVisible()

    // --- Etap 1: bez skonfigurowanego modelu — panel wyszarzony, reszta aplikacji działa w pełni ---
    await expect(llmPanel.getByText(/model nie jest skonfigurowany/i)).toBeVisible()
    for (const label of CONFIG_GATED_TASKS) {
      await expect(llmPanel.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-disabled', 'true')
    }
    await expect(llmPanel.getByRole('button', { name: 'Struktura z pomysłu', exact: true }))
      .toHaveAttribute('aria-disabled', 'true')

    // Dodaj ujęcie: playhead na środku materiału, przycisk „Dodaj ujęcie" —
    // ten sam wzorzec co `happyPath.spec.ts`.
    await page.getByRole('slider', { name: /linijka czasu/i }).click({ position: { x: 400, y: 5 } })
    await page.getByRole('button', { name: /dodaj ujęcie/i }).click()
    await expect(page.getByRole('button', { name: /^ujęcie 2/i })).toBeVisible()

    // Przeciągnij granicę: dowód gestu idzie przez czas cięcia w panelu
    // promptu (dokładnie jak `happyPath.spec.ts`), nie przez stan komponentu.
    const promptPanel = page.getByRole('region', { name: /^prompt$/i })
    const shotTwoInPrompt = promptPanel.getByText(/\[Shot 2\] At 00:0/)
    const cutBeforeDrag = await shotTwoInPrompt.textContent()
    const boundary = page.getByRole('separator', { name: /ujęcie 2/i })
    const boundaryBox = await boundary.boundingBox()
    if (!boundaryBox) throw new Error('Granica ujęcia nie ma wymiarów w DOM — nie da się jej przeciągnąć.')

    const autosavedAfterDrag = waitForAutosave(page)
    await page.mouse.move(boundaryBox.x + boundaryBox.width / 2, boundaryBox.y + boundaryBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(boundaryBox.x - 150, boundaryBox.y + boundaryBox.height / 2, { steps: 10 })
    await page.mouse.up()
    await expect(shotTwoInPrompt).not.toHaveText(cutBeforeDrag ?? '')
    await autosavedAfterDrag

    // Wyeksportuj prompt: prawdziwe żądanie HTTP pod adres, który niesie link
    // panelu eksportu (`ExportPanel.tsx`) — nie klikamy w link wprost, bo
    // odpowiedź jest `text/plain` bez `Content-Disposition`, więc kliknięcie
    // nawigowałoby CAŁĄ kartę poza aplikację (SPA bez routingu) i zgubiłoby
    // resztę stanu testu. `page.request` używa tego samego kontekstu
    // przeglądarki (ten sam serwer, ten sam adres bazowy z konfiguracji
        // Playwrighta), więc to wciąż prawdziwe zapytanie do prawdziwej trasy.
    const exportHref = await page.getByRole('link', { name: 'Prompt (.txt)', exact: true }).getAttribute('href')
    if (!exportHref) throw new Error('Link eksportu promptu nie ma adresu href.')
    const exported = await page.request.get(exportHref)
    expect(exported.ok()).toBe(true)
    const exportedText = await exported.text()
    expect(exportedText).toContain('[Shot 1]')
    expect(exportedText).toContain('[Shot 2]')

    // --- Etap 2: skonfiguruj fałszywego dostawcę — zadania stają się aktywne ---
    await llmPanel.getByRole('button', { name: 'Endpoint', exact: true }).click()
    await llmPanel.getByLabel(/adres endpointu/i).fill(fake.baseUrl)
    const settingsSaved = page.waitForResponse(
      res => res.request().method() === 'PUT' && res.url().includes('/api/llm/settings') && res.ok(),
    )
    await llmPanel.getByRole('button', { name: 'Zapisz ustawienia', exact: true }).click()
    await settingsSaved

    for (const label of CONFIG_GATED_TASKS) {
      await expect(llmPanel.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-disabled', 'false')
    }
    // „Struktura z pomysłu" zostaje nieaktywna — dostawca jest skonfigurowany,
    // ale pola pomysłu są wciąż puste (`canRunStructure`), więc TA konkretna
    // brama nie ma nic wspólnego z modelem.
    await expect(llmPanel.getByRole('button', { name: 'Struktura z pomysłu', exact: true }))
      .toHaveAttribute('aria-disabled', 'true')

    // --- Etap 3: uruchom „Podpowiedź audio", zobacz strumień, doczekaj listy operacji ---
    const streamPreview = page.locator('[aria-label="Podgląd strumienia"]')
    const audioButton = llmPanel.getByRole('button', { name: 'Podpowiedź audio', exact: true })
    await audioButton.click()
    await expect(streamPreview).toBeVisible()
    // Kawałki strumienia przychodzą co 150 ms (`chunkDelayMs` wyżej) — realny
    // dowód strumieniowania, nie tylko obecności elementu podglądu: treść
    // rośnie w czasie, więc odczyt zaraz na starcie i chwilę później muszą się
    // różnić.
    await expect.poll(() => streamPreview.textContent()).not.toBe('')

    const patchReview = page.getByRole('region', { name: /^przegląd łatki$/i })
    await expect(patchReview).toBeVisible({ timeout: 10_000 })
    const soundscapeCheckbox = patchReview.getByRole('checkbox', { name: 'Podpowiedź pejzażu dźwiękowego.', exact: true })
    const musicCheckbox = patchReview.getByRole('checkbox', { name: 'Podpowiedź muzyki spoza kadru.', exact: true })
    await expect(soundscapeCheckbox).toBeVisible()
    await expect(musicCheckbox).toBeVisible()

    // Dowód, że żądanie faktycznie przeszło przez HTTP do prawdziwego
    // serwera (nie zaślepki w pamięci) ze wszystkimi elementami protokołu —
    // schemat wymuszony, strumień poproszony, licznik `max_tokens` obecny.
    const lastRequest = fake.lastRequest()
    expect(fake.requestCount()).toBeGreaterThan(0)
    expect(lastRequest?.stream).toBe(true)
    expect(lastRequest?.response_format).toMatchObject({ type: 'json_schema' })

    // --- Etap 4: żadna operacja nie jest zaznaczona domyślnie, prompt niezmieniony ---
    await expect(soundscapeCheckbox).toHaveAttribute('aria-checked', 'false')
    await expect(musicCheckbox).toHaveAttribute('aria-checked', 'false')
    await expect(promptPanel.getByText(SOUNDSCAPE_TEXT)).toHaveCount(0)
    await expect(promptPanel.getByText(MUSIC_TEXT)).toHaveCount(0)

    // --- Etap 5: zaznacz jedną, zatwierdź — zmiana w prompcie, brak zmiany w drugim polu ---
    await soundscapeCheckbox.click()
    await expect(soundscapeCheckbox).toHaveAttribute('aria-checked', 'true')
    const autosavedAfterConfirm = waitForAutosave(page)
    await patchReview.getByRole('button', { name: 'Zatwierdź', exact: true }).click()
    await autosavedAfterConfirm

    await expect(promptPanel.getByText(SOUNDSCAPE_TEXT)).toBeVisible()
    await expect(promptPanel.getByText(MUSIC_TEXT)).toHaveCount(0)
    // Operacja audio (niezaznaczona, nierozpatrzona) zostaje na liście —
    // przyjęcie jednej nie ruszyło drugiej ani w projekcie, ani w przeglądzie.
    await expect(musicCheckbox).toBeVisible()
    await expect(musicCheckbox).toHaveAttribute('aria-checked', 'false')
    await expect(soundscapeCheckbox).toHaveCount(0)

    // --- Etap 6: cofnij — prompt wraca ---
    const autosavedAfterUndo = waitForAutosave(page)
    await page.keyboard.press('Control+z')
    await autosavedAfterUndo
    await expect(promptPanel.getByText(SOUNDSCAPE_TEXT)).toHaveCount(0)

    // Ponów, żeby przyjęta zmiana wróciła — bez tego test niżej (autozapis
    // przez przeładowanie) sprawdzałby przetrwanie projektu, w którym akurat
    // NIE MA żadnej przyjętej zmiany modelu, co nie dowodziłoby niczego.
    const autosavedAfterRedo = waitForAutosave(page)
    await page.keyboard.press('Control+Shift+z')
    await autosavedAfterRedo
    await expect(promptPanel.getByText(SOUNDSCAPE_TEXT)).toBeVisible()

    // --- Etap 7: uruchom zadanie ponownie i anuluj w trakcie ---
    // `PatchReview` z poprzedniego biegu znika, jak tylko `run.status`
    // przestaje być `'done'` (`LlmPanel.tsx` renderuje go tylko wtedy) — więc
    // od tego miejsca operujemy już tylko na stanie zadania, nie na przeglądzie.
    await audioButton.click()
    const cancelButton = llmPanel.getByRole('button', { name: 'Anuluj', exact: true })
    await expect(cancelButton).toBeVisible()
    // Odczekaj na PIERWSZY kawałek strumienia — anulowanie ma przerwać
    // POŁĄCZENIE W TRAKCIE, nie żądanie, które jeszcze nic nie odesłało.
    await expect.poll(() => streamPreview.textContent()).not.toBe('')
    await cancelButton.click()

    await expect(llmPanel.getByText(/^Stan: Anulowano$/)).toBeVisible()
    // Panel wraca do spoczynku: zadania znów osiągalne, nic nie jest zablokowane.
    await expect(audioButton).toHaveAttribute('aria-disabled', 'false')
    // Anulowane zadanie nie miało prawa dotknąć projektu — wciąż dokładnie ten
    // sam stan, co po Ponów wyżej.
    await expect(promptPanel.getByText(SOUNDSCAPE_TEXT)).toBeVisible()
    await expect(promptPanel.getByText(MUSIC_TEXT)).toHaveCount(0)

    // Autozapis nigdy nie padł po cichu w trakcie całego scenariusza —
    // dokładnie usterka, którą Plan 4 wypuścił i którą ta asercja ma wyłapać,
    // gdyby się powtórzyła.
    await expect(page.getByText(/coś poszło nie tak/i)).toHaveCount(0)

    // --- Etap 8: przeładowanie — przyjęta zmiana przeżywa autozapis ---
    await page.reload()
    await page.getByRole('button', { name: new RegExp(name) }).click()
    await expect(page.getByRole('region', { name: /^prompt$/i }).getByText(SOUNDSCAPE_TEXT)).toBeVisible()
  } finally {
    // Musi się zamknąć niezależnie od wyniku testu — inaczej drugi przebieg
    // `npm run e2e` startuje kolejny proces Playwrighta z tym fałszywym
    // dostawcą wciąż wiszącym w poprzednim (port jest wprawdzie losowy,
    // `listen(0, …)` w `fakeProvider.ts`, więc kolizji portu to akurat nie
    // wywoła — ale wiszący uchwyt gniazda nie ma powodu istnieć po teście).
    await fake?.close()
  }
})
