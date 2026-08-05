import { expect, test, type Page } from '@playwright/test'

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
async function createProject(page: Page, mode: string): Promise<string> {
  const name = `E2E tracks ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await page.goto('/')
  await page.getByRole('button', { name: /nowy projekt/i }).click()
  await page.getByLabel(/nazwa projektu/i).fill(name)
  await page.getByRole('button', { name: new RegExp(`^${mode}`) }).click()
  await page.getByRole('button', { name: /^utwórz$/i }).click()
  await expect(page.getByText(name)).toBeVisible()
  return name
}

test('praca na ścieżkach kamery, dialogu i referencji', async ({ page }) => {
  await createProject(page, 'T2VA')

  // Podział daje drugie ujęcie, więc ścieżki mają na czym pracować.
  await page.getByRole('slider', { name: /linijka czasu/i }).click({ position: { x: 400, y: 8 } })
  await page.keyboard.press('s')
  await expect(page.getByRole('button', { name: /^ujęcie 2/i })).toBeVisible()

  // Nagłówki ścieżek stoją, choć obszar klipów da się przewinąć.
  await expect(page.getByText('Kamera', { exact: true })).toBeVisible()
  // „SFX” samo w sobie NIE dowodzi języka — `dict.ts` ma identyczny napis w
  // `pl` i `en` (jedyny taki klucz w tym pliku), więc przy pomyłkowo
  // przełączonym domyślnym języku ta linia przeszłaby bez zmian. Pilnowanie
  // języka bierze na siebie „Kamera” wyżej i reszta polskich selektorów w
  // tym pliku (np. „linijka czasu”, „ujęcie 2” niżej) — ta asercja sprawdza
  // wyłącznie obecność samego nagłówka ścieżki SFX.
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
  // Jeden pas na mówcę (`DialogueTracks.tsx`). Dawny pas zbiorczy „bez
  // mówcy" zniknął w recenzji końcowej — nie mógł legalnie nic pomieścić,
  // bo `DialogueEventSchema` wymaga `speakerIds.min(1)`.
  await expect(page.locator('[data-track^="dialogue-"]')).toHaveCount(1)
  await assertRowsAligned(page, T2VA_ROWS)

  await addSpeaker.click()
  await addSpeaker.click()
  await expect(page.locator('[data-track^="dialogue-"]')).toHaveCount(3)
  await assertRowsAligned(page, T2VA_ROWS)

  // --- Zwinięcie ścieżki WIELOWIERSZOWEJ: tu żyje błąd z rundy poprawek 1 ---
  //
  // Kamera (niżej) ma jeden wiersz (`rowCount: 1`) — `rowCount × unitHeight`
  // i `unitHeight` są tam identyczne z KONSTRUKCJI niezależnie od stanu
  // zwinięcia, więc błąd „nagłówek zwiniętego wiersza zostaje pełnej
  // wysokości, treść spada do zera” fizycznie nie może się tam objawić.
  // Dialogi przy trzech mówcach mają TRZY wiersze (`dialogueLaneCount` =
  // liczba mówców) — to jedyne miejsce w tym pliku, gdzie ten dokładny
  // błąd byłby widoczny (nagłówek 3×32=96px kontra treść 32px, 64px
  // rozjazdu). Sprawdzone przez chwilowe cofnięcie naprawy w `TrackStack.tsx`
  // (patrz raport zadania) — bez niej ta konkretna asercja, nie żadna dalsza,
  // wychodzi czerwona.
  const collapseDialogue = page.getByRole('button', { name: /zwiń ścieżkę dialogi/i })
  await collapseDialogue.click()
  await expect(page.getByRole('button', { name: /rozwiń ścieżkę dialogi/i })).toBeVisible()
  await assertRowsAligned(page, T2VA_ROWS)
  await page.getByRole('button', { name: /rozwiń ścieżkę dialogi/i }).click()
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
  // Przycisk odtwarzania NIE po nazwie dostępnej — ta zmienia się między
  // „Odtwarzaj” i „Zatrzymaj” wraz ze stanem, a to właśnie ten stan badamy.
  // Pierwszy `<button>` w `[role="region"][name="Oś czasu"]` to zawsze on
  // (`Timeline.tsx`), niezależnie od etykiety.
  const timeline = page.getByRole('region', { name: /^oś czasu$/i })
  const playButton = timeline.locator('button').first()
  const playLabelBeforeCollapse = (await playButton.textContent())?.trim()
  expect(playLabelBeforeCollapse).toBe('Odtwarzaj')

  await collapseCamera.press(' ')
  await expect(page.getByRole('button', { name: /rozwiń ścieżkę kamera/i })).toBeVisible()
  /**
   * Odczyt PUNKTOWY, zaraz po zdarzeniu klawiatury — nie `expect(...).toBeVisible()`
   * ani `toHaveText`. Te dwie próbują przez domyślne 5s: gdyby `stopPropagation`
   * w `activateOnKey` zniknęło, spacja odpaliłaby globalny skrót
   * (`usePlayhead.toggle()`) i odtwarzanie by wystartowało — ale materiał demo
   * jest krótki, więc odtwarzanie zdążyłoby się samo zatrzymać (koniec
   * materiału) i etykieta wróciłaby na „Odtwarzaj” PRZED upływem okna
   * asercji z retry. Test wychodziłby zielony na tej linii i czerwony dopiero
   * na niepowiązanej asercji „Dopasuj” niżej — dokładnie tak, jak to się
   * stało przy pierwszej wersji tego testu. Czytamy tekst raz, bez retry:
   * pytanie brzmi „czy odtwarzanie wystartowało w tej klatce”, nie „czy stoi
   * teraz”.
   */
  const playLabelAfterCollapse = (await playButton.textContent())?.trim()
  expect(playLabelAfterCollapse).toBe(playLabelBeforeCollapse)

  // Nagłówek zostaje czytelny mimo zwinięcia (treść brzmienia zadania).
  await expect(page.getByText('Kamera', { exact: true })).toBeVisible()
  // Zwinięcie jednego wiersza nie może przesunąć wierszy PONIŻEJ względem ich
  // nagłówków — dokładnie błąd z rundy poprawek 1 tego planu (nagłówek
  // zwiniętego wiersza zostawał pełnej wysokości, treść znikała do zera, a
  // wszystko niżej jechało w dół o tę różnicę). Dla samej kamery (rowCount: 1)
  // to nie złapie TEGO błędu (patrz komentarz przy zwinięciu dialogów wyżej),
  // ale nadal pilnuje, że zwinięcie nie zepsuło niczego innego w geometrii.
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

/**
 * Recenzja końcowa, znaleziska 1 i 5 — oba widoczne WYŁĄCZNIE w prawdziwej
 * przeglądarce, bo oba dotyczą tego, co dzieje się PO akcji: autozapisu przez
 * sieć i pozycji playheada ustawianej klawiszem.
 *
 * Znalezisko 1 (krytyczne): jedno kliknięcie „+" na pasie dialogów tworzyło
 * kwestię ze `speakerIds: []`, `PUT /api/projects/:slug` odpowiadał 400, a
 * ponieważ każdy kolejny autozapis wysyła CAŁY projekt, autozapis był zepsuty
 * do końca sesji — po przeładowaniu ginęła cała praca od utworzenia projektu.
 * Dowód nie może więc kończyć się na „klip jest w DOM": musi przejść przez
 * serwer i wrócić.
 *
 * Znalezisko 5: `End` stawia playhead DOKŁADNIE na `durationMs`, a
 * `spanAt` pytało `atMs < span.endMs` — żadne ujęcie nie pasowało i każdy
 * przycisk „+" milczał bez obiektu, bez błędu i bez śladu.
 */
test('przyciski „+" działają na końcu materiału, a wynik przeżywa autozapis', async ({ page }) => {
  const name = await createProject(page, 'T2VA')

  // Świeży projekt nie ma ŻADNEGO mówcy — to stan, w którym przycisk pasa
  // dialogów musi umieć coś stworzyć (tworzy minimalnego mówcę razem z
  // kwestią, patrz `addDialogue`).
  await expect(page.locator('[data-track^="dialogue-"]')).toHaveCount(1)

  // Playhead na samym końcu materiału, przez prawdziwy klawisz.
  await page.locator('body').click()
  await page.keyboard.press('End')

  await page.getByRole('button', { name: /dodaj kwestię na playheadzie/i }).click()
  // Zakotwiczone na `Kwestia S… nr` — samo `/^kwestia/` łapie też plakietkę
  // ostrzeżenia „Kwestia nie mieści się w klipie…", która przy playheadzie na
  // samym końcu materiału jest UCZCIWIE zapalona (`SPEECH_FITS`, patrz
  // `createOnTrack.test.ts`), więc byłoby to dwa elementy, nie jeden.
  await expect(page.getByRole('button', { name: /^kwestia S\d+ nr/i })).toBeVisible()
  await page.getByRole('button', { name: /dodaj dźwięk na playheadzie/i }).click()
  await expect(page.getByRole('button', { name: /^dźwięk:/i })).toBeVisible()

  // Mówca powstał razem z kwestią, więc pas dialogów ma teraz własny wiersz.
  await expect(page.locator('[data-track^="dialogue-"]')).toHaveCount(1)
  // Zawężone do kosza zasobów: `(S1)` pojawia się też w pasie dialogów na
  // liście mówców klipu, a to ten sam napis w dwóch miejscach.
  await expect(page.getByRole('region', { name: /^assety$/i }).getByText('(S1)', { exact: true }))
    .toBeVisible()

  // Autozapis nie zgłasza błędu (`saveError` renderuje się w pasku edytora).
  await expect(page.getByText(/coś poszło nie tak/i)).toHaveCount(0)

  // I — dowód rozstrzygający — praca wraca po przeładowaniu strony. Wybór
  // projektu żyje w stanie React (`App.tsx`, bez routingu), więc po
  // przeładowaniu trzeba go otworzyć z listy; to i tak ta sama droga, którą
  // przeszedł użytkownik zgłaszający usterkę.
  await page.waitForTimeout(1500)
  await page.reload()
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await expect(page.getByRole('button', { name: /^kwestia S\d+ nr/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^dźwięk:/i })).toBeVisible()
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
  // tym trybie nie tylko stoi wyrównana, ale też działa. Po NAZWIE dostępnej
  // (`references.cell` w `dict.ts`), nie po pozycji w DOM — pierwszy upload
  // to zawsze pierwszy asset obrazkowy, więc jego etykieta to zawsze
  // `<Picture 1>`, a jedyne ujęcie w tym projekcie (bez podziału w tym
  // teście) to zawsze „ujęcie 1”. Selektor pozycyjny wyglądałby dziś
  // identycznie, bo w tym momencie testu istnieje tylko jeden wiersz i jedno
  // ujęcie — ale ten plik sam zaleca nazwę, nie pozycję (patrz komentarz przy
  // `assertRowsAligned` wyżej), a poprzedni plan stracił popołudnie na
  // selektorze pozycyjnym, który zaczął pasować do dwóch elementów naraz.
  const firstCell = page.getByRole('button', { name: /^etykieta <picture 1> w ujęciu 1$/i })
  await expect(firstCell).toHaveAttribute('aria-pressed', 'false')
  await firstCell.click()
  await expect(firstCell).toHaveAttribute('aria-pressed', 'true')
})
