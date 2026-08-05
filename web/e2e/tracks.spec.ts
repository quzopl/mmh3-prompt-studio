import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * Interfejs startuje po polsku (`useLang` czyta `localStorage['mmh3.lang']`,
 * a bez wpisu wraca do `'pl'` — `web/src/i18n/useT.ts`), więc selektory
 * celują w polskie nazwy dostępności ze słownika (`web/src/i18n/dict.ts`).
 * Każdy test dostaje świeży kontekst przeglądarki (bez `localStorage`), więc
 * to zawsze ten sam, przewidywalny język. Przełączenie domyślnego języka
 * sprawi, że te selektory przestaną cokolwiek znajdować — to zamierzone: test
 * ma wtedy paść, a nie po cichu przejść na innym elemencie.
 *
 * Ten plik sprawdza to, czego `test/timeline/trackStack.test.tsx` (jsdom) nie
 * potrafi: jsdom nie ma silnika układu, więc porównanie `style.height` obu
 * kolumn (jak w tamtym pliku) łapie rozjazd LICZBY, ale nie rozjazd
 * wprowadzony przez CSS (padding/margin/border) — jsdom po prostu nie liczy
 * układu. Tu porównujemy `boundingClientRect` z prawdziwego Chromium.
 * jsdom też nie zna `PointerEvent` (`useDragClip.ts`/`useDragBoundary.ts`
 * słuchają `pointermove`/`pointerup`, a `setPointerCapture` trzeba tam
 * stubować) — tu ciągniemy krawędź klipu prawdziwymi zdarzeniami wskaźnika
 * (`page.mouse`), tak jak jedyny inny test w tym stylu w projekcie
 * (`happyPath.spec.ts`, przeciągnięcie granicy ujęcia).
 */

/**
 * Wiersze osi czasu w trybie T2VA (bez „references” — ta ścieżka istnieje
 * tylko w trybie REF, patrz `TrackStack.tsx`). Kolejność zgodna z tablicą
 * `rows` w `TrackStack.tsx`, żeby błąd rozjazdu w jednym wierszu (który
 * przesuwa WSZYSTKIE wiersze poniżej) był widoczny na pierwszym niezgodnym
 * kluczu, nie na przypadkowym.
 */
const T2VA_ROWS = ['shots', 'camera', 'dialogue', 'screenText', 'sfx', 'soundscape', 'music'] as const

/**
 * Nagłówek i treść KAŻDEGO wiersza muszą stać w tym samym miejscu i mieć tę
 * samą wysokość — `TrackStack.tsx` renderuje obie kolumny z `data-header-row`
 * i `data-content-row` na tym samym kluczu właśnie po to, żeby dało się to
 * zmierzyć niezależnie od tego, jak dana ścieżka rysuje swoją treść
 * wewnątrz. Tolerancja 1px pokrywa subpikselowe zaokrąglenia przeglądarki —
 * każda z tych wysokości pochodzi z całkowitej stałej w pikselach
 * (`CAMERA_TRACK_HEIGHT_PX` itp.), więc prawdziwy rozjazd (np. znaleziony w
 * rundzie 1 recenzji tego planu: `RULER_HEIGHT_PX` = 24px) jest wielokrotnie
 * większy niż ten margines i nigdy by się w nim nie schował.
 */
async function assertRowsAligned(page: Page, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    const header = page.locator(`[data-header-row="${key}"]`)
    const content = page.locator(`[data-content-row="${key}"]`)
    const headerBox = await header.boundingBox()
    const contentBox = await content.boundingBox()
    if (!headerBox || !contentBox) {
      throw new Error(`Wiersz "${key}" nie ma wymiarów w DOM — nagłówek albo treść nie istnieje.`)
    }
    expect(Math.abs(headerBox.y - contentBox.y), `wiersz "${key}": górna krawędź`).toBeLessThan(1)
    expect(Math.abs(headerBox.height - contentBox.height), `wiersz "${key}": wysokość`).toBeLessThan(1)
  }
}

/** Tworzy projekt i zostawia edytor otwarty. Nazwa niesie losowy sufiks, żeby dwa testy w tym pliku (albo dwa przebiegi całego `npm run e2e`) nigdy nie trafiły w ten sam slug. */
async function createProject(page: Page, mode: string): Promise<void> {
  const name = `E2E tracks ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await page.goto('/')
  await page.getByRole('button', { name: /nowy projekt/i }).click()
  await page.getByLabel(/nazwa projektu/i).fill(name)
  await page.getByRole('button', { name: new RegExp(`^${mode}`) }).click()
  await page.getByRole('button', { name: /^utwórz$/i }).click()
  await expect(page.getByText(name)).toBeVisible()
}

test('praca na ścieżkach kamery, dialogu i referencji', async ({ page }) => {
  await createProject(page, 'T2VA')

  // Podział daje drugie ujęcie, więc ścieżki mają na czym pracować.
  await page.getByRole('slider', { name: /linijka czasu/i }).click({ position: { x: 400, y: 8 } })
  await page.keyboard.press('s')
  await expect(page.getByRole('button', { name: /^ujęcie 2/i })).toBeVisible()

  // Nagłówki ścieżek stoją, choć obszar klipów da się przewinąć.
  await expect(page.getByText('Kamera', { exact: true })).toBeVisible()
  await expect(page.getByText('SFX', { exact: true })).toBeVisible()

  // --- Ruch kamery: dodanie przez interfejs, potem prawdziwe przeciągnięcie ---
  //
  // Przycisk istnieje (`track.addCamera` w `TrackStack.tsx`) — ścieżka kamery
  // umie więc stworzyć obiekt, nie tylko go rysować i przeciągać.
  await page.getByRole('button', { name: /dodaj ruch kamery na playheadzie/i }).click()
  const cameraClip = page.getByRole('button', { name: /^ruch kamery/i })
  await expect(cameraClip).toBeVisible()

  const promptPanel = page.getByRole('region', { name: /^prompt$/i })
  const promptBeforeDrag = await promptPanel.textContent()

  const endHandle = page.getByRole('separator', { name: /przesuń koniec ruchu static/i })
  const handleBoxBeforeDrag = await endHandle.boundingBox()
  const clipBoxBeforeDrag = await cameraClip.boundingBox()
  if (!handleBoxBeforeDrag || !clipBoxBeforeDrag) {
    throw new Error('Uchwyt albo klip ruchu kamery nie ma wymiarów w DOM — nie da się go przeciągnąć.')
  }
  await page.mouse.move(handleBoxBeforeDrag.x + handleBoxBeforeDrag.width / 2, handleBoxBeforeDrag.y + handleBoxBeforeDrag.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBoxBeforeDrag.x + 80, handleBoxBeforeDrag.y + handleBoxBeforeDrag.height / 2, { steps: 10 })
  await page.mouse.up()

  // Dowód, że gest naprawdę przesunął krawędź na ekranie, nie tylko wysłał
  // zdarzenia w próżnię: szerokość klipu rośnie o coś bliskiego przesunięciu
  // kursora (nie dokładnie 80px — przyciąganie do klatki zaokrągla).
  const clipBoxAfterDrag = await cameraClip.boundingBox()
  if (!clipBoxAfterDrag) throw new Error('Klip ruchu kamery zniknął z DOM po przeciągnięciu.')
  expect(clipBoxAfterDrag.width - clipBoxBeforeDrag.width).toBeGreaterThan(40)

  /**
   * ZNALEZISKO: brief tego zadania każe tu sprawdzić, że prompt się zmienił
   * (jak przy przeciągnięciu granicy ujęcia w `happyPath.spec.ts`) — ale dla
   * ruchu kamery to fałszywe założenie. `renderCameraMove`
   * (`shared/src/compile/renderCamera.ts`) buduje frazę WYŁĄCZNIE z `type`/
   * `amplitude`/`speed`/`target`/`customPhrase` — nigdy z `startMs`/`endMs`.
   * `Inspector.tsx` też nie ma pól dla ruchu kamery (tylko dla ujęcia i
   * projektu). Przesunięcie krawędzi w czasie NIE ma dziś żadnego czytelnego
   * dla użytkownika śladu poza samą pozycją/szerokością klipu na osi —
   * dlatego dowód gestu wyżej idzie przez `boundingBox()`, nie przez prompt.
   * Asercja niżej to nie przeoczenie: dokumentuje i pilnuje tego ustalenia,
   * żeby nie trzeba było go odkrywać drugi raz.
   */
  await expect(promptPanel).toHaveText(promptBeforeDrag ?? '')

  // Cofnięcie gestu wraca do szerokości sprzed przeciągnięcia — widoczne na
  // ekranie, nie tylko w magazynie.
  await page.keyboard.press('Control+z')
  const clipBoxAfterUndo = await cameraClip.boundingBox()
  if (!clipBoxAfterUndo) throw new Error('Klip ruchu kamery zniknął z DOM po cofnięciu.')
  expect(Math.abs(clipBoxAfterUndo.width - clipBoxBeforeDrag.width)).toBeLessThan(1)

  // --- Wyrównanie nagłówków i treści: z jednym mówcą i z trzema ---
  const addSpeaker = page.getByRole('button', { name: /^dodaj mówcę$/i })
  await addSpeaker.click()
  // Pas zbiorczy istnieje zawsze, więc jeden mówca daje DWA pasy (`DialogueTracks.tsx`).
  await expect(page.locator('[data-track^="dialogue-"]')).toHaveCount(2)
  await assertRowsAligned(page, T2VA_ROWS)

  await addSpeaker.click()
  await addSpeaker.click()
  await expect(page.locator('[data-track^="dialogue-"]')).toHaveCount(4)
  await assertRowsAligned(page, T2VA_ROWS)

  // --- Zwinięcie ścieżki: przez PRAWDZIWĄ klawiaturę, nie klik ---
  //
  // `locator.press` fokusuje element i dopiero wtedy wysyła zdarzenie
  // klawiatury przez prawdziwe drzewo fokusu — dokładnie to, czego jsdom (bez
  // przeglądarki) nie odtwarza wiernie. Ten dokładny błąd (spacja na
  // skupionym przycisku nagłówka odpala globalny skrót zamiast akcji
  // przycisku) złapano w tym planie cztery razy — `TrackStack.tsx` broni się
  // przed nim `stopPropagation` w `activateOnKey`.
  const collapseCamera = page.getByRole('button', { name: /zwiń ścieżkę kamera/i })
  const playButton = page.getByRole('button', { name: /^odtwarzaj$/i })
  await expect(playButton).toBeVisible()
  await collapseCamera.press(' ')
  await expect(page.getByRole('button', { name: /rozwiń ścieżkę kamera/i })).toBeVisible()
  // Odtwarzanie NIE wystartowało — przycisk dalej mówi „Odtwarzaj”, nie „Zatrzymaj”.
  await expect(playButton).toBeVisible()
  // Nagłówek zostaje czytelny mimo zwinięcia (treść brzmienia zadania).
  await expect(page.getByText('Kamera', { exact: true })).toBeVisible()
  // Zwinięcie jednego wiersza nie może przesunąć wierszy PONIŻEJ względem ich
  // nagłówków — dokładnie błąd z rundy poprawek 1 tego planu (nagłówek
  // zwiniętego wiersza zostawał pełnej wysokości, treść znikała do zera, a
  // wszystko niżej jechało w dół o tę różnicę).
  await assertRowsAligned(page, T2VA_ROWS)

  await page.getByRole('button', { name: /rozwiń ścieżkę kamera/i }).click()
  await expect(page.getByText('Kamera', { exact: true })).toBeVisible()
  await assertRowsAligned(page, T2VA_ROWS)

  // --- „Dopasuj”: bez poziomego przewijania po kliknięciu ---
  const scroller = page.locator('[data-scroller]')
  await page.getByRole('button', { name: /^dopasuj$/i }).click()
  await expect
    .poll(async () => scroller.evaluate(el => el.scrollWidth - el.clientWidth))
    .toBe(0)
  await scroller.evaluate(el => { el.scrollLeft = 999_999 })
  await expect.poll(async () => scroller.evaluate(el => el.scrollLeft)).toBe(0)
  // Zoom zmienia szerokości klipów, ale wysokości wierszy (stałe w pikselach,
  // niezależne od skali czasu) mają zostać wyrównane tak samo jak przed „Dopasuj”.
  await assertRowsAligned(page, T2VA_ROWS)
})

test('ścieżka referencji w trybie REF ma nagłówki zgodne z liczbą etykiet', async ({ page }) => {
  await createProject(page, 'REF')

  await expect(page.getByText('Referencje', { exact: true })).toBeVisible()

  // Trzy assety, każdy z własną etykietą — `referenceRowCount` (`ReferencesTrack.tsx`)
  // rośnie o jeden wiersz na etykietę, dokładnie jak liczba mówców w dialogach.
  // Zawężone do panelu assetów — `ExportPanel` niesie DRUGI input pliku
  // (`accept="application/json"`, wgrywanie workflow ComfyUI), więc goły
  // `input[type="file"]` łapie oba i Playwright odmawia w trybie strict.
  const fileInput = page.getByRole('region', { name: /^assety$/i }).locator('input[type="file"]')
  const labelNames = ['ref-a.png', 'ref-b.png', 'ref-c.png']
  for (const fileName of labelNames) {
    await fileInput.setInputFiles({
      name: fileName,
      mimeType: 'image/png',
      // Najmniejszy poprawny PNG (1×1, przezroczysty) — serwer akceptuje
      // dowolne dane po samym typie MIME (`assetKindFromMime`), miniaturka
      // (`sharp`) jest tylko wygodą i połyka błędy w ciszy.
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    })
    await expect(page.getByText(fileName, { exact: true })).toBeVisible()
    await page.locator('li', { hasText: fileName })
      .getByRole('button', { name: /utwórz etykietę/i })
      .click()
  }
  await expect(page.locator('[data-track^="references-"]')).toHaveCount(3)

  // Wyrównanie z kilkoma etykietami — realny układ w Chromium, nie liczba
  // wierszy z `referenceRowCount` porównana z tą samą liczbą po drugiej
  // stronie (co jsdom już sprawdza w `trackStack.test.tsx`). `shots`/`camera`
  // jako kanarki: gdyby sam pomiar (`assertRowsAligned`) był zepsuty, te dwa
  // zawsze zgodne wiersze złapałyby to pierwsze.
  await assertRowsAligned(page, ['shots', 'camera', 'references'])

  // Kratka referencji jest osiągalna i przełącza się — dowód, że ścieżka w
  // tym trybie nie tylko stoi wyrównana, ale też działa.
  const firstCell: Locator = page.locator('[data-track^="references-"]').first().getByRole('button').first()
  await expect(firstCell).toHaveAttribute('aria-pressed', 'false')
  await firstCell.click()
  await expect(firstCell).toHaveAttribute('aria-pressed', 'true')
})
