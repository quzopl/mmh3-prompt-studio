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

  // Playhead stoi dokładnie tam, gdzie przed chwilą powstała nowa granica —
  // podział zrobiliśmy w jego pozycji. Jego uchwyt to niewidoczny pasek na
  // całą wysokość osi (z-20), wyżej niż uchwyt granicy (z-10); kliknięcie w
  // ten sam piksel trafiłoby więc w playhead, nie w granicę (sprawdzone w
  // prawdziwej przeglądarce — patrz raport zadania 12, runda 2). Odsuwamy
  // playhead klawiszem Home, zanim złapiemy granicę wskaźnikiem.
  await page.keyboard.press('Home')

  // Odczyt z panelu promptu, nie z monitora: monitor pokazuje ujęcie pod
  // playheadem, a playhead właśnie stąd odjechał. Prompt pokazuje całość
  // niezależnie od jego pozycji, więc dalej można nim sprawdzić czas cięcia.
  const promptPanel = page.getByRole('region', { name: /^prompt$/i })
  const shotTwoInPrompt = promptPanel.getByText(/\[Shot 2\] At 00:0/)
  const cutBeforeDrag = await shotTwoInPrompt.textContent()

  // Przeciągnięcie granicy prawdziwym gestem wskaźnika (pointerdown/move/up przez
  // `page.mouse`) — jedyne miejsce w projekcie, gdzie `setPointerCapture` i
  // `PointerEvent` działają naprawdę, zamiast atrapy `MouseEvent`, jaką testy
  // jednostkowe muszą podstawiać pod jsdom (ono w ogóle nie zna klasy PointerEvent).
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

  // UWAGA: odtwarzanie na prawdziwym zegarze celowo NIE jest tu sprawdzane.
  // Zbadane w rundzie 2 tego zadania i opisane w raporcie: `usePlayback.ts`
  // liczy kolejną pozycję od WARTOŚCI JUŻ ZAOKRĄGLONEJ do klatki
  // (`usePlayhead.getState().ms`), a nie od surowego, nieprzyciętego czasu.
  // Prawdziwy `requestAnimationFrame` w przeglądarce tyka co ~16,7 ms — mniej
  // niż połowa długości jednej klatki wideo przy 24 kl/s (41,7 ms) — więc
  // każdy pojedynczy przyrost zaokrągla się z powrotem do tej samej klatki i
  // playhead zamraża się na starcie na zawsze, mimo że `requestAnimationFrame`
  // faktycznie tyka (potwierdzone bezpośrednim pomiarem w tej samej sesji).
  // Testy jednostkowe tego nie łapały, bo ręcznie sterowana kolejka klatek w
  // `playback.test.tsx` karmi `tick` pojedynczymi, wybranymi przez test
  // dużymi skokami (100 ms, 1000 ms) — każdy z osobna większy niż próg
  // zaokrąglenia, więc nigdy nie odtwarza sytuacji małych, powtarzanych
  // przyrostów z prawdziwego zegara. Zgodnie z poleceniem rundy: to jest
  // ustalenie warte więcej niż zielony test — zgłoszone w raporcie, tu
  // celowo nie dopisuję asercji, która zależałaby od załatania błędu w
  // `web/src/timeline/usePlayback.ts` / `web/src/store/playheadStore.ts`
  // (poza zakresem plików tego zadania).

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
