import { test, expect } from '@playwright/test'

test('od utworzenia projektu do gotowego promptu', async ({ page }) => {
  const name = `E2E ${Date.now()}`
  await page.goto('/')

  await page.getByRole('button', { name: /nowy projekt/i }).click()
  await page.getByLabel(/nazwa projektu/i).fill(name)
  await page.getByRole('button', { name: /^T2VA/ }).click()
  await page.getByRole('button', { name: /^utwórz$/i }).click()

  // Świeży projekt nie ma stylu, więc walidator musi to zgłosić.
  await expect(page.getByText(/wymaga podania stylu/i)).toBeVisible()

  await page.getByLabel(/styl wizualny/i).fill('Live-action, cinematic')
  await expect(page.getByText(/Live-action, cinematic/).first()).toBeVisible()

  const autosaved = page.waitForResponse(
    res => res.request().method() === 'PUT' && res.url().includes('/api/projects/') && res.ok(),
  )
  await page.getByLabel(/tło dźwiękowe/i).fill('Rain taps the window.')
  await expect(page.getByText(/gotowy do eksportu/i)).toBeVisible()

  // Autozapis odpala się po 800 ms bezczynności; same asercje powyżej mieszczą
  // się w mniej niż 300 ms, więc bez tego czekania przeładowanie niżej
  // wyścigowo wyprzedzałoby PUT za każdym razem, nie tylko czasami.
  await autosaved

  // Oś czasu: jedno ujęcie na start, podział daje drugie, cofnięcie wraca do jednego.
  const clips = page.getByRole('button', { name: /^ujęcie \d/i })
  await expect(clips).toHaveCount(1)

  await page.getByRole('slider', { name: /linijka czasu/i }).click({ position: { x: 450, y: 5 } })
  await page.getByRole('button', { name: /dodaj ujęcie/i }).click()
  await expect(clips).toHaveCount(2)
  // Ten sam fragment tekstu trafia też do panelu z pełnym promptem (`PromptPanel`)
  // obok monitora — bez zawężenia do regionu monitora selektor łapie oba miejsca
  // naraz i Playwright odmawia w trybie strict. Region monitora to właśnie ten
  // fragment, który dowodzi, że podział dotarł do kompilatora.
  await expect(
    page.getByRole('region', { name: /^monitor$/i }).getByText(/\[Shot 2\] At 00:0/),
  ).toBeVisible()

  await page.keyboard.press('Control+z')
  await expect(clips).toHaveCount(1)

  // Zmiana języka przełącza interfejs, ale nie treść promptu.
  await page.getByRole('button', { name: 'EN' }).click()
  await expect(page.getByText(/ready to export/i)).toBeVisible()
  await expect(page.getByText(/integrated_multimodal_description/)).toBeVisible()
  await expect(page.getByText(/Live-action, cinematic/).first()).toBeVisible()
  await expect(page.getByText(/Rain taps the window\./).first()).toBeVisible()

  // Przeładowanie dowodzi, że autozapis naprawdę dotarł na dysk, a nie tylko
  // do pamięci przeglądarki — bez tego cały ruch mógłby być pozorny.
  await page.reload()
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await expect(page.getByText(/Live-action, cinematic/).first()).toBeVisible()
})
