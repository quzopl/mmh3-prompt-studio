import { test, expect } from '@playwright/test'

test('od utworzenia projektu do gotowego promptu', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: /nowy projekt/i }).click()
  await page.getByLabel(/nazwa projektu/i).fill(`E2E ${Date.now()}`)
  await page.getByRole('button', { name: /T2VA/ }).click()
  await page.getByRole('button', { name: /^utwórz$/i }).click()

  // Świeży projekt nie ma stylu, więc walidator musi to zgłosić.
  await expect(page.getByText(/wymaga podania stylu/i)).toBeVisible()

  await page.getByLabel(/styl wizualny/i).fill('Live-action, cinematic')
  await expect(page.getByText(/Live-action, cinematic/).first()).toBeVisible()

  await page.getByLabel(/tło dźwiękowe/i).fill('Rain taps the window.')
  await expect(page.getByText(/gotowy do eksportu/i)).toBeVisible()

  // Zmiana języka przełącza interfejs, ale nie prompt.
  await page.getByRole('button', { name: 'EN' }).click()
  await expect(page.getByText(/ready to export/i)).toBeVisible()
  await expect(page.getByText(/integrated_multimodal_description/)).toBeVisible()
})
