import { test, expect } from '@playwright/test'

test('świeża przeglądarka startuje po angielsku', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: /new project/i })).toBeVisible()
  await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('wybór polskiego przeżywa przeładowanie', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'PL', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: /nowy projekt/i })).toBeVisible()
})
