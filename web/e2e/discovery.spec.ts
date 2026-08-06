import { expect, test } from '@playwright/test'

/**
 * Skan lokalnych serwerów w PRAWDZIWEJ przeglądarce. W środowisku e2e nie stoi
 * żaden dostawca, więc wynikiem jest „nic nie znaleziono" — i to jest dobry
 * test, bo dokładnie tę ścieżkę zobaczy użytkownik bez Ollamy, a jest ona
 * jedyną, w której łatwo zostawić zawieszone „Szukam…" albo pusty ekran.
 */
test('skanowanie lokalnych serwerów kończy się czytelnym wynikiem', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'PL', exact: true }).click()
  await page.getByRole('button', { name: /nowy projekt/i }).click()
  await page.getByLabel(/nazwa projektu/i).fill(`E2E skan ${Date.now()}`)
  await page.getByRole('button', { name: /^T2VA/ }).click()
  await page.getByRole('button', { name: /^utwórz$/i }).click()

  await page.getByRole('button', { name: /szukaj lokalnych serwerów/i }).click()

  // Cokolwiek stoi na maszynie, wynik ma być zdaniem albo listą — nigdy pustym
  // ekranem ani przyciskiem, który został na „Szukam…".
  await expect(
    page.getByText(/nie znaleziono żadnego serwera|ollama|lmstudio|openai/i).first(),
  ).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: /szukaj lokalnych serwerów/i })).toBeVisible()
})

test('bez skonfigurowanego dostawcy panel proponuje pobranie modelu z rozmiarami', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'PL', exact: true }).click()
  await page.getByRole('button', { name: /nowy projekt/i }).click()
  await page.getByLabel(/nazwa projektu/i).fill(`E2E pobranie ${Date.now()}`)
  await page.getByRole('button', { name: /^T2VA/ }).click()
  await page.getByRole('button', { name: /^utwórz$/i }).click()

  // Rozmiar musi być widoczny ZANIM cokolwiek ruszy — to on jest podstawą
  // decyzji o pobraniu kilku gigabajtów.
  await expect(page.getByText(/8[.,]9 GB|9[.,]0 GB/).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: /pobierz i skonfiguruj/i }).first()).toBeVisible()
})
