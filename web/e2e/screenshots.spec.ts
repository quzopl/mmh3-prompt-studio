import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { startFakeProvider, type FakeProviderHandle } from '../../server/test/llm/fakeProvider.js'

/**
 * Nie jest to test — to generator zrzutów do README. Trzyma się jednak tych
 * samych reguł co reszta pakietu: klika w nazwy dostępności, a nie w klasy CSS,
 * i przełącza interfejs na angielski, bo README jest po angielsku.
 *
 * Uruchamiać ręcznie: `npx playwright test e2e/screenshots.spec.ts`.
 * `playwright.config.ts` wyklucza ten plik ze zwykłego przebiegu, żeby nie
 * zapisywał plików przy każdym `npm run e2e`.
 */

const SHOTS = join(process.cwd(), '..', 'docs', 'screenshots')

const shot = async (page: import('@playwright/test').Page, name: string): Promise<void> => {
  await page.screenshot({ path: join(SHOTS, `${name}.png`), animations: 'disabled' })
}

test('zrzuty ekranu do README', async ({ page }) => {
  await mkdir(SHOTS, { recursive: true })
  await page.setViewportSize({ width: 1680, height: 1180 })
  await page.goto('/')

  // Cały materiał w zrzutach ma być angielski — interfejs też.
  await page.getByRole('button', { name: 'EN', exact: true }).click()

  await page.getByRole('button', { name: /new project/i }).click()
  await shot(page, '01-mode-picker')

  await page.getByLabel(/project name/i).fill('Night Departure')
  await page.getByRole('button', { name: /^T2VA/ }).click()
  await page.getByRole('button', { name: /^create$/i }).click()

  await page.getByLabel(/visual style/i).fill('Live-action, cinematic realism, shallow depth of field')
  await page.getByLabel(/overall soundscape/i).fill(
    'Rain taps the glass roof. A distant announcement echoes down the platform. Footsteps approach on wet concrete.',
  )
  await page.getByLabel(/non-diegetic music/i).fill('A slow piano figure over sustained strings.')

  // Trzy ujęcia: klik w linijkę ustawia playhead, „Add shot" tnie w tym miejscu.
  const ruler = page.getByRole('slider', { name: /time ruler/i })
  await ruler.click({ position: { x: 420, y: 5 } })
  await page.getByRole('button', { name: /add shot/i }).click()
  await ruler.click({ position: { x: 820, y: 5 } })
  await page.getByRole('button', { name: /add shot/i }).click()

  await expect(page.getByRole('button', { name: /^shot 3/i })).toBeVisible()
  await shot(page, '02-editor-timeline')

  // Ścieżki: ruch kamery i kwestia dialogowa, żeby oś czasu nie była pusta.
  await page.getByRole('button', { name: /add camera move at the playhead/i }).click()
  await page.getByRole('button', { name: /add line at the playhead/i }).click()
  await page.getByRole('button', { name: /add sound at the playhead/i }).click()
  // Pasek osi czasu ma stałą wysokość i własne przewijanie w pionie, więc bez
  // powiększenia go i przewinięcia na górę zrzut złapałby wycinek w połowie.
  await page.evaluate(() => {
    const strip = document.querySelector('.h-48')
    if (strip instanceof HTMLElement) strip.style.height = '340px'
    const scroller = document.querySelector('.overflow-y-auto')
    if (scroller instanceof HTMLElement) scroller.scrollTop = 0
  })
  const timeline = page.getByLabel(/timeline tracks/i)
  await timeline.screenshot({ path: join(SHOTS, '03-tracks.png'), animations: 'disabled' })

  // Panel walidacji: reguły deterministyczne z cytatem z guide'a.
  await page.getByLabel(/visual style/i).fill('')
  await page.getByRole('region', { name: /^validation$/i })
    .screenshot({ path: join(SHOTS, '04-validation.png'), animations: 'disabled' })
})

test('zrzuty panelu LLM', async ({ page }) => {
  await mkdir(SHOTS, { recursive: true })
  await page.setViewportSize({ width: 1680, height: 1180 })
  await page.goto('/')
  await page.getByRole('button', { name: 'EN', exact: true }).click()

  await page.getByRole('button', { name: /new project/i }).click()
  await page.getByLabel(/project name/i).fill('LLM Panel')
  await page.getByRole('button', { name: /^REF/ }).click()
  await page.getByRole('button', { name: /^create$/i }).click()

  const panel = page.getByRole('region', { name: /^language model$/i }).first()

  await expect(page.getByText(/model is not configured/i).first()).toBeVisible()
  await panel.screenshot({ path: join(SHOTS, '05-llm-off.png'), animations: 'disabled' })

  // Ten sam panel po wskazaniu dostawcy: zadania stają się aktywne, a przycisk
  // zwolnienia pamięci karty mówi, co potrafi u TEGO dostawcy.
  await page.getByRole('button', { name: /^endpoint$/i }).click()
  await page.getByLabel(/endpoint address/i).fill('http://127.0.0.1:1234/v1')
  await page.getByLabel(/model id/i).fill('qwen2.5-7b-instruct')
  await page.getByRole('button', { name: /save settings/i }).click()
  await expect(page.getByText(/model is not configured/i)).toHaveCount(0)
  await panel.screenshot({ path: join(SHOTS, '06-llm-endpoint.png'), animations: 'disabled' })

  // Okno rozmowy o polu z PRAWDZIWĄ turą, nie pustym formularzem. Zrzut ma
  // pokazać, po co ta funkcja jest: komentarz modelu do przeczytania i osobno
  // propozycja zmiany pola, która czeka na zaznaczenie. Puste okno pokazywało
  // tylko, że okno istnieje.
  //
  // Dostawcą jest atrapa z `server/test/llm/fakeProvider.ts` — ta sama, której
  // używa `llm.spec.ts`. Zrzuty do README nie mogą zależeć od tego, czy na
  // maszynie stoi prawdziwy model.
  const fake = await startFakeProvider({
    responseText: JSON.stringify({
      reply: 'Added rain and cold light from the platform side, and kept the '
        + 'shallow depth of field you already had.',
      english: 'Live-action, cinematic realism, cold rain-lit platform, shallow depth of field',
    }),
    chunkDelayMs: 5,
    chunkCount: 3,
  })
  try {
    await page.getByLabel(/endpoint address/i).fill(fake.baseUrl)
    await page.getByRole('button', { name: /save settings/i }).click()

    await page.getByRole('button', { name: /discuss this field/i }).click()
    const chat = page.getByRole('dialog', { name: /field conversation/i })
    await expect(chat).toBeVisible()

    await chat.getByLabel(/your instruction/i).fill('add rain and cold light from the platform side')
    await chat.getByRole('button', { name: /^send$/i }).click()
    await expect(chat.getByRole('button', { name: /^confirm$/i })).toBeVisible({ timeout: 20_000 })

    await chat.screenshot({ path: join(SHOTS, '07-field-chat.png'), animations: 'disabled' })
  } finally {
    await fake.close()
  }
})
