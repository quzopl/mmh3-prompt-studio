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

  const monitor = page.getByRole('region', { name: /^monitor$/i })
  // Ten sam fragment tekstu trafia też do panelu z pełnym promptem (`PromptPanel`)
  // obok monitora — bez zawężenia do regionu monitora selektor łapie oba miejsca
  // naraz i Playwright odmawia w trybie strict. Region monitora to właśnie ten
  // fragment, który dowodzi, że podział dotarł do kompilatora.
  await expect(monitor.getByText(/^\[Shot 2\] At 00:0/)).toBeVisible()

  // Odczyt z panelu promptu, nie z monitora: dalej w tym teście playhead
  // jeszcze się przesunie (odtwarzanie niżej), a prompt pokazuje całość
  // niezależnie od jego pozycji, więc dalej można nim sprawdzić czas cięcia.
  const promptPanel = page.getByRole('region', { name: /^prompt$/i })
  const shotTwoInPrompt = promptPanel.getByText(/\[Shot 2\] At 00:0/)
  const cutBeforeDrag = await shotTwoInPrompt.textContent()

  // Przeciągnięcie granicy dokładnie tam, gdzie wylądowała po podziale — w
  // tym samym pikselu co playhead, bo cięcie powstaje w jego pozycji. Przed
  // naprawą produkcyjną (commit 9046151, runda 2 tego zadania) tu właśnie
  // łapało się playhead zamiast granicy: jego linia miała przechwytywanie na
  // całą wysokość osi. Naprawa uczyniła linię czysto wizualną
  // (pointer-events-none) i przeniosła przeciąganie playheada do osobnego,
  // małego uchwytu u góry — więc granica jest teraz osiągalna bez żadnego
  // obchodzenia. Ten test to jedyne miejsce w projekcie, gdzie to w ogóle
  // można sprawdzić: jsdom nie ma layoutu i nie honoruje `pointer-events`
  // ani kolejności z-index przy dispatchu zdarzeń.
  const boundary = page.getByRole('separator', { name: /ujęcie 2/i })
  const box = await boundary.boundingBox()
  if (!box) throw new Error('Granica ujęcia nie ma wymiarów w DOM — nie da się jej przeciągnąć.')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 200, box.y + box.height / 2, { steps: 10 })
  await page.mouse.up()

  // Czas cięcia po przeciągnięciu musi się różnić od tego sprzed gestu — to
  // dowód, że przesunęła się granica w modelu, a nie tylko uchwyt na ekranie.
  await expect(shotTwoInPrompt).not.toHaveText(cutBeforeDrag ?? '')

  // Jeden gest przeciągnięcia zostawia dokładnie jeden wpis w historii: pierwszy
  // Ctrl+Z cofa wyłącznie przeciągnięcie (czas cięcia wraca sprzed gestu), drugi
  // dopiero zdejmuje sam podział.
  await page.keyboard.press('Control+z')
  await expect(clips).toHaveCount(2)
  await expect(shotTwoInPrompt).toHaveText(cutBeforeDrag ?? '')

  await page.keyboard.press('Control+z')
  await expect(clips).toHaveCount(1)

  // Odtwarzanie na prawdziwym zegarze: przewijamy blisko końca materiału (End,
  // potem parę klatek wstecz strzałką), żeby czekanie było krótkie, po czym
  // sprawdzamy, że playhead realnie się przesuwa, a następnie zatrzymuje się
  // dokładnie na końcu materiału, zamiast jechać dalej. Runda 1 tego zadania
  // celowo NIE dopisała tej asercji, bo `usePlayback.ts` liczył kolejną
  // pozycję od już zaokrąglonej do klatki wartości w magazynie — realny
  // ~16,7 ms krok vsync jest mniejszy niż pół klatki materiału (41,7 ms przy
  // 24 kl/s), więc zaokrąglał się z powrotem do tej samej klatki w
  // nieskończoność i playhead zamarzał na starcie na zawsze, mimo że
  // `requestAnimationFrame` naprawdę tykał. Naprawione w commit 9046151:
  // hook trzyma teraz akumulator w pełnej precyzji, niezależny od zaokrąglenia
  // w magazynie. Ten test to jedyny w projekcie dowód na prawdziwym zegarze —
  // testy jednostkowe karmią pętlę klatkową ręcznie wybranymi skokami
  // (100 ms, 1000 ms), które nie odtwarzają realnego rytmu przeglądarki.
  const timeline = page.getByRole('region', { name: /^oś czasu$/i })
  const msDisplay = timeline.getByText(/^\d+ ms$/)
  // Fokus po poprzednich krokach stoi na przycisku „Dodaj ujęcie” — zdejmujemy
  // go, żeby spacja jednoznacznie trafiła w globalny skrót odtwarzania
  // (`useTimelineShortcuts.ts`), a nie w aktywację akurat skupionego przycisku.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('End')
  for (let step = 0; step < 5; step += 1) await page.keyboard.press('ArrowLeft')
  const msBeforePlay = await msDisplay.textContent()

  await page.keyboard.press(' ')
  await expect(msDisplay).not.toHaveText(msBeforePlay ?? '')
  await expect(timeline.getByRole('button', { name: /^odtwarzaj$/i })).toBeVisible()
  await expect(msDisplay).toHaveText('8000 ms')

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
