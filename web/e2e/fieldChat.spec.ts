import { expect, test } from '@playwright/test'
import { startFakeProvider, type FakeProviderHandle } from '../../server/test/llm/fakeProvider.js'

/**
 * Rozmowa o polu w PRAWDZIWEJ przeglądarce. Testy jednostkowe tego okna
 * przechodzą w jsdom, a jsdom nie ma układu strony, nie liczy nazw dostępności
 * tak jak przeglądarka i nie zna zdarzeń wskaźnika — w tym projekcie trzy razy
 * przepuścił usterkę, którą przeglądarka pokazała od razu (zamarzające
 * odtwarzanie przy vsync 16,7 ms, kolizja nazwy `<select>` z polem tekstowym).
 *
 * Sprawdzamy tu dwie rzeczy, których nie widać z żadnego testu jednostkowego:
 * że tura naprawdę przechodzi przez sieć aż do `chats.json`, i że po zamknięciu
 * oraz ponownym otwarciu okna historia wraca — czyli że klucz wątku liczony po
 * stronie przeglądarki (`chatApi.ts`) zgadza się z tym, który zapisał serwer
 * (`chatStore.ts`). To dwie osobne definicje tej samej reguły, rozdzielone
 * granicą pakietów; ten test jest jedynym miejscem, gdzie ich rozjazd wyjdzie
 * na jaw.
 *
 * Interfejs przełączamy jawnie na polski, tak jak `llm.spec.ts` — domyślnym
 * językiem jest angielski, a selektory celują w polskie nazwy ze słownika.
 */

const REPLY = 'Dodałem deszcz i zimne światło od strony peronu.'
const ENGLISH = 'Live-action, cold rain-lit platform, shallow depth of field'

test('rozmowa o polu: tura przechodzi przez sieć i przeżywa zamknięcie okna', async ({ page }) => {
  let fake: FakeProviderHandle | null = null
  try {
    fake = await startFakeProvider({
      responseText: JSON.stringify({ reply: REPLY, english: ENGLISH }),
      chunkDelayMs: 20,
      chunkCount: 4,
    })

    const name = `E2E chat ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await page.goto('/')
    await page.getByRole('button', { name: 'PL', exact: true }).click()
    await page.getByRole('button', { name: /nowy projekt/i }).click()
    await page.getByLabel(/nazwa projektu/i).fill(name)
    await page.getByRole('button', { name: /^T2VA/ }).click()
    await page.getByRole('button', { name: /^utwórz$/i }).click()
    await expect(page.getByText(name)).toBeVisible()

    // Dostawca wskazywany tą samą trasą, którą wołałby prawdziwy panel.
    await page.getByRole('button', { name: /^endpoint$/i }).click()
    await page.getByLabel(/adres endpointu/i).fill(`${fake.baseUrl}/v1`)
    await page.getByLabel(/identyfikator modelu/i).fill('atrapa')
    await page.getByRole('button', { name: /zapisz ustawienia/i }).click()
    await expect(page.getByText(/model nie jest skonfigurowany/i)).toHaveCount(0)

    await page.getByRole('button', { name: /rozmawiaj o tym polu/i }).click()
    const dialog = page.getByRole('dialog', { name: /rozmowa o polu/i })
    await expect(dialog).toBeVisible()

    // Pusty wątek mówi, co zrobić, zamiast zostawiać pustkę.
    await expect(dialog.getByText(/dodaj deszcz i zimne światło/i)).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^wyślij$/i }))
      .toHaveAttribute('aria-disabled', 'true')

    await dialog.getByLabel(/twoje polecenie/i).fill('dodaj deszcz')
    await expect(dialog.getByRole('button', { name: /^wyślij$/i }))
      .toHaveAttribute('aria-disabled', 'false')
    await dialog.getByRole('button', { name: /^wyślij$/i }).click()

    await expect(dialog.getByText(REPLY)).toBeVisible({ timeout: 20_000 })
    // Propozycja zmiany pola trafia do przeglądu operacji, a nie do projektu.
    await expect(dialog.getByRole('button', { name: /zatwierdź/i })).toBeVisible()

    await dialog.getByRole('button', { name: /^zamknij$/i }).click()
    await expect(dialog).toBeHidden()

    // Ponowne otwarcie TEGO SAMEGO pola trafia w ten sam wątek — a historia
    // przyszła z serwera, nie z pamięci komponentu, bo komponent został
    // odmontowany razem z oknem.
    await page.getByRole('button', { name: /rozmawiaj o tym polu/i }).click()
    const reopened = page.getByRole('dialog', { name: /rozmowa o polu/i })
    await expect(reopened.getByText('dodaj deszcz', { exact: true })).toBeVisible()
    await expect(reopened.getByText(REPLY)).toBeVisible()

    // Czyszczenie opróżnia wątek po stronie serwera — po nim wraca podpowiedź.
    await reopened.getByRole('button', { name: /wyczyść rozmowę/i }).click()
    // `exact`, bo podpowiedź pustego wątku sama zawiera frazę „dodaj deszcz i
    // zimne światło" — dopasowanie po podciągu trafiałoby w nią i test nigdy by
    // nie zauważył, że tura została.
    await expect(reopened.getByText('dodaj deszcz', { exact: true })).toHaveCount(0)
    await expect(reopened.getByText(/dodaj deszcz i zimne światło/i)).toBeVisible()
  } finally {
    await fake?.close()
  }
})
