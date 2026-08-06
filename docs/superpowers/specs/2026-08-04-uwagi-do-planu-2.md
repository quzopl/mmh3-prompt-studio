# Uwagi przeniesione z realizacji Planu 1

Data: 2026-08-04
Źródło: recenzja całej gałęzi `feat/rdzen-kompilator` po zamknięciu 17 zadań

Rzeczy, których świadomie **nie** zrobiliśmy w rdzeniu, a które trzeba rozstrzygnąć
zanim edytor osi czasu zwiąże się z modelem. Każda jest tania teraz i droga później,
bo po napisaniu edytora zmiana modelu oznacza migrację i przepisanie fixture'ów.

## 1. `Speaker` ma dwa konkurujące źródła prawdy o głosie

Rekord mówcy niesie dziesięć pól: `characterType`, `age`, `gender`, `pitch`, `timbre`,
`rate`, `accent`, `onScreen` oraz `fullDescriptor` i `shortDescriptor`. Prozę
generują wyłącznie dwa ostatnie; pozostałych osiem nie czyta żaden kod.

Guide (§4.4) wymaga, żeby przy pierwszym wystąpieniu mówcy podać typ postaci, wiek,
płeć, obecność w kadrze, wysokość, barwę, tempo i akcent — czyli dokładnie te osiem
pól. Są więc uzasadnione, ale nic ich nie spina z tekstem, który faktycznie trafia
do promptu.

Do rozstrzygnięcia przed zbudowaniem formularza inspektora: albo `fullDescriptor`
powstaje z tych ośmiu pól przez funkcję `describeSpeaker()` w `compile/`, albo osiem
pól znika, a opis pisze się ręcznie. Związanie inputów UI z martwymi polami jest
najgorszym z wyjść.

## 2. `Shot.composition` też nie trafia do promptu

Pole istnieje wyłącznie po to, żeby reguła `CUT_SHOULD_BE_MOVE` mogła porównać
sąsiednie ujęcia. Rzeczywisty opis kompozycji żyje w segmencie tekstowym `body` i nic
tych dwóch miejsc nie synchronizuje. Ten sam wybór co wyżej: albo pole zasila prozę,
albo znika.

## 3. `Shot.anchor` jest pojedyncze, a FL2VA potrzebuje dwóch kotwic

Tryb FL2VA w swoim głównym przypadku to jedno ujęcie zakotwiczone jednocześnie na
pierwszej i ostatniej klatce. Dzisiejsze `anchor: Anchor` tego nie wyraża — fixture
złoty ustawia tylko `picture-first`, a `ANCHOR_REQUIRED` to akceptuje. Rozszerzenie
do `anchors: Anchor[]` przed napisaniem edytora kosztuje kilka linii; po — migrację.

**Rozstrzygnięcie (commit `1c597d9`, korekty rdzenia przed budową edytora):**
zamknięte dokładnie tak, jak zalecał ten wpis — pole ma dziś postać
`anchors: Anchor[]` (`shared/src/model/types.ts:135`), a schemat przyjmuje
tablicę wartości `picture-first | picture-last | keyframe`
(`shared/src/model/schema.ts:99`). Zmiana weszła przed edytorem, więc migracja
plików projektów nie była potrzebna. Plan 3 oparł na tym odznaki kotwic na
klipie (`web/src/timeline/AnchorBadges.tsx`): FL2VA ustawia obie kotwice na
jednym ujęciu bez żadnego obejścia, co przy pojedynczym `anchor` nie było
wyrażalne.

## 4. `COMPILE_FAILED` nie jest regułą

`buildPrompt` po nieudanej kompilacji dokłada syntetyczną diagnostykę o tym
identyfikatorze, ale nie ma go w rejestrze 42 reguł. Każde przyszłe wyszukiwanie
metadanych reguły po `ruleId` — na przykład panel walidacji pokazujący cytat z
guide'a — musi to przewidzieć.

## 5. Kotwica mapy tokenów w trybie REF jest tekstowa

`buildTokens` ustawia kursor na pierwszym wystąpieniu literału
`detailed_description:` w wyrenderowanym tekście. Gdyby użytkownik wpisał ten ciąg w
`summaryText` albo w definicję podmiotu, kursor zakotwiczy się za wcześnie i tokeny
pierwszego ujęcia znów wskażą złą sekcję. Skutek jest wyłącznie nawigacyjny — prompt
pozostaje poprawny — ale docelowo emitery powinny zwracać offsety sekcji zamiast
zgadywać je z tekstu.

## 6. Poziom `REF_WORD_COUNT` nie jest przypięty testem

Reguła jest wskazówką (`hint`), bo przykład dostawcy sam nie mieści się w zalecanym
zakresie 350–500 słów. Żaden test nie pilnuje tego poziomu — cofnięcie go do
`warning` przechodzi niezauważone.

## 7. `mmh3c` jest skryptem npm, nie binarką

Uruchamia się przez `npm run mmh3c --workspace @mmh3/shared -- <ścieżka>`.
`npx mmh3c` nie zadziała, dopóki pakiet nie dostanie pola `bin` i kroku budowania.

## 8. Rejestr reguł to globalny stan modułu

`registerAllRules()` jest idempotentne dzięki fladze, więc dziś jest bezpiecznie.
Zaboli, kiedy edytor zechce zestawów reguł per projekt. Wyjściem awaryjnym jest
`validateWith(rules, project, compiled)`, eksportowane z `shared/src/index.ts`
właśnie po to.

## 9. `AssetSchema.path` jest nieograniczonym `z.string()`

Trasa `GET /api/projects/:slug/assets/:assetId/raw` składa ścieżkę pliku z katalogu
projektu i `asset.path`, a ta wartość trafia do `project.json` przez `PUT
/api/projects/:slug`, czyli w całości spod kontroli klienta. Potwierdzone: projekt
z `path: "../../../../etc/passwd"` zwracał **200 z treścią pliku spoza projektu**.

Dziś zamknięte po stronie serwera — trasa woła `assertInsideRoot(projectDir, resolved)`
i odpowiada 400. Właściwym domknięciem jest zawężenie samego schematu do
`/^assets\/[A-Za-z0-9._-]+$/`, ale to zmiana w zamrożonym `shared/`.

**Rozstrzygnięcie (Plan 3, Task 1, commit `13b28ee`):** zrobione — pakiet został
odmrożony na czas spłaty długu i `AssetSchema.path` ma dziś dokładnie ten
wzorzec (`shared/src/model/schema.ts:140`). Migracja plików projektów nie była
potrzebna, bo `saveAsset` od początku zapisuje `join('assets', stored)`, co
wzorzec spełnia. Kontrola po stronie trasy (`assertInsideRoot`) została na
miejscu: schemat zawęża to, co wolno zapisać, a trasa broni się przed tym, co
już leży na dysku — patrz też punkt 13, gdzie pokazano, że sam wzorzec
dowiązania symbolicznego nie zamyka.

---

# Przeniesione z recenzji końcowej Planu 2

Rzeczy wykryte przy zamykaniu gałęzi `feat/aplikacja-fundament`, rozstrzygnięte
jako dług zamiast blokady scalenia. Każda ma uzasadnienie.

## 10. Równoległe zapisy tego samego projektu nie są serializowane

`writeProject` zapisuje przez plik tymczasowy o stałej nazwie i `rename`, co
usuwa okno obcięcia pliku przy przerwaniu procesu. Nie usuwa jednak wyścigu
dwóch piszących naraz: dzielą ten sam plik tymczasowy, a jeśli pierwszy zdąży
z `rename`, drugi dostanie `ENOENT`. Ścieżka wgrywania assetu i autozapis mogą
się na to nałożyć.

**Rozstrzygnięcie:** nie blokuje scalenia. Przed poprawką ta sama zbieżność dawała
uszkodzony `project.json`; teraz daje widoczny błąd zapisu, co jest zamianą cichej
utraty danych na głośną awarię. Właściwe domknięcie to kolejka zapisów per slug po
stronie serwera — należy do Planu 3, razem z drugim pisarzem, którego wprowadzi
oś czasu.

**Domknięte (Plan 3, Task 1, commit `13b28ee`):** kolejka powstała dokładnie w
zapowiedzianej postaci — `writeQueues` w `server/src/storage/projectStore.ts`
trzyma po jednej obietnicy na slug, a `writeProject` dokłada swój zapis na jej
koniec, więc dwaj piszący nigdy nie dzielą pliku tymczasowego. Kolejka jest per
slug, więc różne projekty nadal zapisują się równolegle; wpis usuwa się dopiero
wtedy, gdy jest ostatni w łańcuchu, żeby nie porzucić czekających.

## 11. Ostatnia zmiana ginie przy wyjściu z edytora

Sprzątanie efektu w `useAutosave` kasuje zaplanowany zapis bez opróżnienia, więc
kliknięcie „← Projekty" w oknie opóźnienia gubi ostatnią zmianę. Reset sklepu przy
zmianie sluga nieznacznie to poszerza, ale był konieczny, żeby zamknąć zapis do
cudzego projektu.

**Rozstrzygnięcie:** dług. Domknięcie to opróżnienie przy odmontowaniu albo
blokada nawigacji przy `dirty` — jedno i drugie należy do warstwy nawigacji,
której ten plan nie budował.

**Stan po Planie 3 (nadal otwarte, wyższa stawka):** oś czasu zwielokrotniła
drogi, którymi projekt staje się „brudny" — podział i usuwanie ujęć skrótami,
przeciąganie granicy, odznaki kotwic, pole czasu cięcia w inspektorze. Każda z
nich potrafi zabrudzić projekt jednym naciśnięciem klawisza, bez dotykania
formularza, więc okno, w którym wyjście z edytora gubi ostatnią zmianę, jest
dziś nieporównanie łatwiejsze do trafienia niż przy samym pisaniu w polach.

## 12. Odnośniki eksportu są wyłączane tylko wizualnie

`pointer-events-none` i `aria-disabled` powstrzymują mysz, ale `href` zostaje, więc
klawiatura, środkowy przycisk i „otwórz w nowej karcie" nadal pobiorą nieaktualny
stan. Twardą strażą jest dziś tylko sprawdzenie `dirty` w eksporcie workflow.

**Rozstrzygnięcie:** dług. Właściwie eksport `.txt` i `.json` powinien powstawać
w przeglądarce z modelu w pamięci — kompilator i tak działa po stronie klienta —
a do serwera powinno iść wyłącznie wstrzyknięcie do workflow ComfyUI.

**Stan po Planie 3 (nadal otwarte, wyższa stawka):** ta sama przyczyna co przy
punkcie 11 — oś czasu dołożyła kilka pisarzy projektu, więc stan `dirty` zapala
się teraz znacznie częściej i na dłużej. Odnośnik wyłączony wyłącznie wizualnie
tym częściej odda plik sprzed ostatniej zmiany: dziś wystarczy przeciągnąć
granicę ujęcia i od razu otworzyć eksport w nowej karcie.

## 13. `assertInsideRoot` jest leksykalne, nie oparte o `realpath`

Dowiązanie symboliczne podłożone w katalogu projektu obeszłoby tę kontrolę. Żadna
obecna ścieżka zapisu takiego dowiązania nie tworzy — wgrywanie zapisuje zwykłe
pliki pod generowanymi nazwami — więc dziś to nieosiągalne. Warto o tym pamiętać,
bo zawężenie `AssetSchema.path` w odmrożonym `shared/` też tego nie zamknie.

**Rozstrzygnięcie (Task 1, runda poprawek 2/5):** zamknięte na ścieżce odczytu.
Zawężenie `AssetSchema.path` (`assets/[A-Za-z0-9._-]+`) rzeczywiście tego nie
zamyka — dowiązanie symboliczne nazwane zgodnie ze wzorcem przechodzi schemat
i leksykalny `assertInsideRoot` bez zastrzeżeń, a system plików i tak podąża za
nim gdziekolwiek. Trasa `GET /api/projects/:slug/assets/:assetId/raw` w
`server/src/routes/assets.ts` woła teraz, obok istniejącego `assertInsideRoot`,
nową `assertRealPathInside` (`server/src/storage/paths.ts`) — porównuje ścieżki
po `realpath`, więc dowiązanie prowadzące poza katalog projektu jest wykrywane
niezależnie od nazwy. Dowiedzione eksperymentem różnicującym: z usuniętą
kontrolą trasa oddawała realną zawartość pliku spoza projektu (dowiązanie
`assets/kadr.img` → `SEKRET.txt`, odpowiedź 200 z treścią sekretu); z
przywróconą kontrolą — 400, bez treści.

Ścieżki zapisu (`writeProject`, `saveAsset` i reszta magazynu) nadal używają
wyłącznie leksykalnego `assertInsideRoot`, celowo bez zmian: piszą pod cele,
które jeszcze nie istnieją na dysku, a `realpath` rzuca `ENOENT` dla
nieistniejącej ścieżki — `assertRealPathInside` nadaje się więc tylko do stron
odczytu, gdzie plik z definicji już jest obecny (albo jego brak to osobny,
rozróżniony przypadek 404).

---

# Przeniesione z recenzji końcowej Planu 3

Rzeczy wykryte przy zamykaniu gałęzi `feat/os-czasu-rdzen`, rozstrzygnięte jako
dług zamiast blokady scalenia.

## 14. Porządek ujęć nie ma właściciela

Trzy miejsca liczą „kolejność ujęć" na dwa sposoby: `renumber`
(`web/src/timeline/shotOperations.ts`) sortuje po `startMs`, a `shotSpans`
(`web/src/timeline/spans.ts`) i domknięcie `removeShots` sortują po `index`.
Zgadzają się tylko dopóki niezmiennik trzyma, a żadna funkcja go nie pilnuje —
`useDragBoundary` pisze `startMs` i nigdy nie woła `renumber`.

**Rozstrzygnięcie:** nie blokuje scalenia. Wszystkie trzy pisarze w aplikacji
przycinają dziś każde ujęcie do co najmniej dwóch klatek, więc rozjazd wymaga
projektu napisanego z zewnątrz. Właściwym domknięciem jest jedna funkcja
normalizująca listę ujęć, przez którą przechodzi każdy zapis — należy do planu,
który doda kolejne ścieżki osi czasu, bo one podwoją liczbę pisarzy.

## 15. `ProjectSchema` dopuszcza dwa ujęcia o tym samym `id`

Krytyczna usterka z recenzji końcowej (`splitAtMs` numerował po liczbie ujęć,
więc identyfikator wracał po usunięciu) jest zamknięta po stronie aplikacji:
sufiks bierze się dziś z maksimum istniejących, a fuzz na 300 przebiegach po 60
losowych operacji nie znalazł kolizji. Sam schemat nadal jednak przyjmuje
duplikat, więc ręcznie zredagowany `project.json` albo łatka od modelu może go
wnieść.

**Rozstrzygnięcie:** dług. Zawężenie schematu zaczęłoby zwracać 400 na
projektach, które dziś przechodzą, więc wymaga świadomej migracji.

## 16. Pole czasu cięcia w inspektorze zatwierdza na blur/Enter, nie na każdy znak

Recenzja końcowa kazała przepuścić to pole przez tę samą politykę co
przeciąganie granicy (przyciąganie do klatki, ograniczenie sąsiadami). Zmierzone:
te dwie rzeczy wykluczają się z zapisem na każdy znak — pierwsza cyfra „5000"
staje się 83 ms, a reszta dopisuje się do poprawionej liczby, dając 7917.
Zatwierdzanie na blur i Enter jest jedynym wyjściem, które nie walczy z
piszącym, i tak zachowują się pola liczbowe w programach montażowych.

Zostają dwie drobne konsekwencje: wyczyszczenie pola i wyjście z niego
zatwierdza 83 ms (minimalną długość ujęcia) zamiast zostawiać wartość, i nie ma
Escape cofającego edycję.

---

# Przeniesione z recenzji końcowej Planu 4

Rzeczy wykryte przy zamykaniu gałęzi `feat/sciezki-osi-czasu`, rozstrzygnięte jako
dług zamiast blokady scalenia.

## 17. Kotwice klatek to piąty niezmiennik zależny od kolejności ujęć — i jedyny bez właściciela

Recenzja końcowa Planu 4 dała `normalizeProject`
(`web/src/timeline/normalizeProject.ts`) własność czterech rzeczy wyprowadzalnych
z kolejności i rozpiętości ujęć: samej kolejności, zaciśnięcia ruchów kamery do
swojego ujęcia, formy pierwszego wprowadzenia mówcy i zakresów w
`retention_analysis`. Piąta rzecz tego samego kształtu została poza funkcją:
**umiejscowienie kotwic**.

Zmierzone w przemiocie: w projekcie L2VA z jednym ujęciem niosącym `picture-last`
podział tego ujęcia (`S`) zostawia kotwicę na ujęciu, które przestało być ostatnie
— `L2VA_ANCHOR_LAST_SHOT` zapala się na projekcie, który przed naciśnięciem
klawisza był czysty. Usunięcie ostatniego ujęcia niosącego jedyną wymaganą kotwicę
daje w tym samym trybie `ANCHOR_REQUIRED`.

**Rozstrzygnięcie:** nie blokuje scalenia i **nie** jest zwykłym naruszeniem zasady
„akcja interfejsu nie może wnieść diagnostyki do czystego projektu" — bo w
przeciwieństwie do czterech pozostałych niezmienników ten jest już złagodzony w
interfejsie. `AnchorBadges` (`web/src/timeline/AnchorBadges.tsx`) świadomie rysuje
kotwicę spoza trybu jako odznakę „nieświeżą" z etykietą `anchor.stale` („kliknij,
aby zdjąć"), więc użytkownik widzi problem na klipie i zdejmuje go jednym
kliknięciem. Diagnostyka jest tu uczciwym opisem stanu, który sam interfejs
pokazuje.

Właściwym domknięciem jest przyjęcie kotwic przez `normalizeProject` jako piątego
niezmiennika — **to pierwsza rzecz, którą ta funkcja powinna adoptować.** Wymaga
jednak rozstrzygnięcia projektowego, którego recenzja Planu 4 nie miała prawa
podjąć sama: przy podziale ujęcia niosącego `picture-last` kotwica może
**wędrować** za końcem materiału (przenieść się na nowe ostatnie ujęcie) albo
**zostawać** tam, gdzie ją postawiono, i tylko świecić na czerwono. Pierwsze jest
wygodniejsze, ale przesuwa decyzję użytkownika o klatce kluczowej bez pytania —
czyli robi dokładnie to, czego zabrania zasada wypracowana w zadaniu 8
(„propozycja nie ma prawa zdecydować czegokolwiek za użytkownika"). Drugie jest
dzisiejszym zachowaniem i wymaga tylko tego, żeby diagnostyka była widoczna —
co już jest.

## 18. `FL2VA_PREFER_SINGLE_SHOT` przy podziale ujęcia jest wynikiem uczciwym

Podział ujęcia w trybie FL2VA zapala tę regułę na projekcie, który jej nie miał —
ale nie ma tu nic do naprawienia: użytkownik naprawdę właśnie zrobił drugie ujęcie
w trybie, który preferuje jedno, a reguła jest ostrzeżeniem opisującym dokładnie
to. Dopisane do listy przyjętych wyjątków obok `SPEECH_FITS`,
`SOUNDSCAPE_NA_ONLY_IF_SILENT` i `SPEAKER_SILENT_NO_ID`.

Ten wpis istnieje dlatego, że przy trzech poprzednich wyjątkach zabrakło go w
dokumentacji i każda kolejna recenzja odkrywała je od nowa jako rzekomą regresję.

**Rozstrzygnięcie sporu z punktu 17 (kotwica wędruje czy zostaje):** kotwica
**zostaje** na swoim ujęciu i reguła świeci na czerwono. Wędrowanie jest
wygodniejsze, ale przenosi decyzję użytkownika o klatce kluczowej bez pytania —
a to dokładnie to, czego zakazuje zasada wyprowadzona w Planie 4, zadanie 8:
propozycja ani normalizacja nie decydują niczego za użytkownika. Odznaka
`anchor.stale` jest już zbudowana tak, żeby przetrwałą kotwicę dało się zdjąć
jednym kliknięciem, więc droga wyjścia istnieje i jest widoczna.

## 19. Model ma pola, których nikt nie czyta

Zebrane po pięciu planach, bo przestało być przypadkiem:

- `Shot.composition` — istnieje wyłącznie po to, żeby reguła `CUT_SHOULD_BE_MOVE`
  mogła porównać sąsiednie ujęcia; do promptu nie trafia (punkt 2 tego dokumentu,
  otwarty od Planu 1).
- `CameraMove.startMs` i `endMs` — walidowane przez `CAM_IN_SHOT_BOUNDS`, sterują
  ograniczeniami przeciągania na osi czasu, a `renderCameraMove` w ogóle ich nie
  czyta. Kolejność segmentów w prompcie bierze się z `shot.body`, nie z czasu.
- **Cała ścieżka `diegeticSfx`** — nie ma wariantu `Segment` dla dźwięku, więc nie
  ma jak trafić do `body`, a `emitBase` ani `emitRef` nie czytają tablicy. Jedyny
  ślad, jaki dźwięk zostawia w systemie, to zliczenie obecności w regule
  `SOUNDSCAPE_NA_ONLY_IF_SILENT`.
- `Label.role` — wykryte przy Planie 5, zadanie 15: żaden emiter ani żadna reguła
  go nie czyta. `emitRef` renderuje wyłącznie `definition`, i to tylko dla etykiet
  `standalone`.
- `video.aspect` i `video.resolution` — wykryte przy przeglądzie skilli MiniMaxa.
  Nie docierają do promptu, nie czyta ich żadna reguła i **nie mają nawet
  kontrolki w interfejsie**: `newProject` ustawia `16:9` i `768p`, i tak zostaje.
  Klucz słownikowy `project.aspect` istnieje w obu językach i nie ma czytelnika.
  To najczystszy przypadek z tej listy — pole nie tylko nikogo nie obchodzi, ale
  nawet nie da się go zmienić.

**Rozstrzygnięcie:** nie blokuje niczego, ale trzeba to nazwać, zamiast odkrywać
za każdym razem od nowa. Każde z tych pól da się edytować w interfejsie, więc
użytkownik ma prawo sądzić, że coś zmienia. Domknięcie jest jedno z dwóch dla
każdego pola osobno: albo zasila prompt, albo znika z modelu i z interfejsu.
Trzecia droga — zostawić edytowalne pole bez konsumenta — jest tą, którą idziemy
dziś i której nie należy przedłużać w nieskończoność.

Zadanie 15 Planu 5 zastosowało tu regułę roboczą, którą warto zachować:
**tłumaczy się to, co model wideo przeczyta**. Pola bez konsumenta zostały poza
tłumaczeniem całego projektu, bo przekładanie tekstu, którego nikt nie zobaczy,
kosztuje kontekst modelu i niczego nie poprawia.

## 20. `RedactTarget.shotText` istnieje po stronie serwera, ale żaden interfejs go nie woła

Lustrzane odbicie punktu 19 — tam pole edytowalne w interfejsie nie ma
konsumenta w modelu; tutaj zdolność serwera nie ma konsumenta w interfejsie.

Trasa `POST /api/llm/run` z zadaniem `redact` (Plan 5, zadanie 7,
`server/src/llm/tasks/redact.ts`) przyjmuje cztery kształty `target`: `style`,
`audio` (dwa pola stałe), `speaker` (dwa pola na mówcę, mówca ma stabilny
`id`/`code`) i `shotText` — pojedynczy segment tekstowy wewnątrz `shot.body`,
wskazany parą `shotId`/`segmentIndex`. Wszystkie cztery są zwalidowane
Zodem (`RedactTargetSchema`) i mają pełne pokrycie testami po stronie serwera.

Panel LLM (Plan 5, zadanie 10, `web/src/llm/LlmPanel.tsx`) buduje rozwijaną
listę celów redakcji z bieżącego projektu i pokrywa pierwsze trzy warianty —
`shotText` został poza nią świadomie, nie przez przeoczenie: w przeciwieństwie
do stylu/audio/mówcy (identyfikują się same, dają się wypisać płaską listą bez
dodatkowego kontekstu), `shotText` wymaga wskazania KONKRETNEGO ujęcia i
KONKRETNEGO segmentu jego `body`. To miejsce, gdzie użytkownik już patrzy na
treść tego segmentu — inspektor ujęcia albo klip na osi czasu — nie rozwijana
lista w panelu dostawcy, z dala od projektu, którego dotyczy.

**Co by to domknęło:** przycisk „redaguj" przy polu tekstowym segmentu w
`Inspector.tsx` (albo bezpośrednio na klipie osi czasu), wołający ten sam
`POST /api/llm/run` z `target: { kind: 'shotText', shotId, segmentIndex }` —
dokładnie ten kształt, który trasa już przyjmuje i waliduje. Nic po stronie
serwera nie wymaga zmiany; brakuje wyłącznie miejsca w interfejsie, z którego
dałoby się to wywołać.

**Stan po planie „okno dialogowe LLM" (2026-08-06):** punkt zostaje otwarty, ale
zmienił się jego kształt. Zadanie `redact` przestało mieć własne wejście w
panelu — zastąpiła je rozmowa o polu (`web/src/llm/FieldChat.tsx`), która
przyjmuje ten sam `RedactTarget` i tę samą listę celów, więc `shotText` nadal
nie ma skąd zostać wywołany. To, czego brakuje, jest teraz jednym przyciskiem:
„Rozmawiaj o tym polu" przy polu tekstowym segmentu w `Inspector.tsx`,
otwierający `FieldChat` z `target: { kind: 'shotText', shotId, segmentIndex }`.
Cała reszta — trasa, wątek, historia, przegląd operacji — już działa i jest
pokryta testami; brakuje wyłącznie miejsca, z którego użytkownik może w to
kliknąć.

## 21. `replaceShots` może zastosować się dwukrotnie przy dwóch kliknięciach złapanych w jedną, niezatwierdzoną partię Reactu

Plan 5, zadanie 11 (`web/src/llm/PatchReview.tsx`), fix round 2 — zgłoszone
wprost przez recenzenta, świadomie zostawione bez naprawy w tej rundzie.

Zatwierdzona operacja znika z listy `remaining`, więc kolejne kliknięcie
„Zatwierdź" czyta `chosen = remaining.filter(op => selected.has(op.id))` z
LISTY, która już nie zawiera właśnie zastosowanej operacji — to działa
niezawodnie dla dwóch PRAWDZIWYCH, osobnych zdarzeń kliknięcia (każde
domyka własny cykl reakcji Reacta, więc drugie widzi już zaktualizowany
stan). Druga linia obrony — `applyOps` na wartości już zastosowanej zwraca
dokładnie ten sam obiekt referencyjnie (`shared/src/patch/apply.ts`) — chroni
przed DUPLIKATEM zmiany dla wszystkich pięciu rodzajów operacji poza jednym:
`replaceShots` porównuje referencję TABLICY `shots`, nie jej zawartość (zadanie
4, celowo — nowa tablica o identycznej treści to wciąż realna podmiana na tym
poziomie), więc dwa zastosowania TEJ SAMEJ operacji `replaceShots` z dwóch
kliknięć, które trafiłyby do `apply` w jednej, jeszcze niezatwierdzonej
partii reakcji Reacta (obie strony `onConfirm` czytają ten sam, jeszcze
niezaktualizowany `remaining`/`selected` z domknięcia), wykonałyby się
DWUKROTNIE — druga też realnie „zmienia" `project.shots`, bo porównanie jest
referencyjne, nie głębokie.

**Dlaczego to nie problem w tej rundzie:** prawdziwe, osobne zdarzenia
klawiatury i myszy (klik, Enter, Spacja) nie produkują dwóch wywołań
handlera w jednej partii — każde jest osobnym zdarzeniem DOM, między którymi
React zdąży scommitować poprzednią aktualizację stanu. Scenariusz wymaga
dwóch zdarzeń złapanych SYNCHRONICZNIE w jednym tasku JS (np. programowe
`dispatchEvent` dwa razy pod rząd bez oddania sterowania), czego żaden
prawdziwy gest użytkownika nie tworzy.

**Co by to domknęło:** blokada na poziomie `onConfirm` niezależna od stanu
komponentu — np. `useRef` z flagą „zatwierdzenie w toku", zerowaną dopiero po
commicie stanu, albo przeniesienie logiki zatwierdzenia do reduktora, który
serializuje kolejne wywołania. Nie zrobione w tej rundzie, bo koszt (kolejna
warstwa stanu w komponencie, który i tak ma już trzy) przewyższa realne
ryzyko przy prawdziwych zdarzeniach przeglądarki.

## 22. Lista przyjętych wyjątków musiała nazwać reguły TREŚCI

Plan 5, recenzja końcowa gałęzi, punkt 5 — rozstrzygnięcie i lista mówiły co
innego, więc czytelnik znajdował dwie odpowiedzi zamiast jednej.

Zadanie 11 rozstrzygnęło, że schemat odpowiedzi modelu pilnuje **kształtu**, a
nie **treści**: zła liczba zdań to kształt, który model po prostu pomylił i
który da się odrzucić w rozmowie z nim, a słowo o nastroju w muzyce albo
kwestia dialogowa powtórzona w pejzażu to **uczciwa informacja zwrotna** dla
człowieka na ekranie przeglądu — walidator ma rację, a nie kod jest wadliwy.
Rozstrzygnięcie jest słuszne i zostaje. Ale lista przyjętych wyjątków od reguły
„żadna nowa diagnostyka" — noszona przez pięć plików testowych — nigdy tych
identyfikatorów nie dostała, więc pierwsza prawdziwa odpowiedź modelu ze słowem
o nastroju czerwieniłaby test, który tę odpowiedź ma uznawać za w porządku.

**Rozstrzygnięcie:** lista zostaje rozszerzona o dwie reguły treści —
`MUSIC_NO_MOOD_WORDS` i `SOUNDSCAPE_NO_DIALOGUE`. Pełna lista przyjętych
wyjątków dla zadań językowych ma dziś sześć pozycji:

- **kształt/czas, wynik uczciwy przy akcji, o którą użytkownik prosił** (punkt
  18 wyżej): `SPEECH_FITS`, `SOUNDSCAPE_NA_ONLY_IF_SILENT`,
  `SPEAKER_SILENT_NO_ID`, `FL2VA_PREFER_SINGLE_SHOT`;
- **treść, którą model wymyślił, a walidator słusznie kwestionuje**:
  `MUSIC_NO_MOOD_WORDS`, `SOUNDSCAPE_NO_DIALOGUE`.

Dwie subtelności, bez których ta lista byłaby rozluźnieniem, a nie
uporządkowaniem:

1. `SOUNDSCAPE_NO_DIALOGUE` niesie pod jednym identyfikatorem **dwa** pytania:
   o kształt (czy tekst zawiera blok `<d>`) i o treść (czy powtarza istniejącą
   kwestię). Połowa kształtu jest od tej rundy pilnowana w schemacie
   (`server/src/llm/tasks/audioFieldText.ts`, wspólnym dla trzech zadań
   piszących do pól audio) i ma tam własne testy w każdych z trzech drzwi, więc
   przyjęcie identyfikatora na liście nie zostawia jej bez dowodu.
2. `DIEGETIC_IN_DESCRIPTION` — reguła tej samej klasy co
   `MUSIC_NO_MOOD_WORDS` — **nie** została dopisana: rozstrzygnięcie zadania 11
   wymienia słowa o nastroju i powtórzony dialog, a nie „wszystkie reguły
   treści", a żadne zadanie nie zostało przyłapane na jej produkowaniu. Gdyby
   kiedyś zapaliła się na przyjętej łatce, właściwą odpowiedzią jest dopisanie
   jej tutaj i do pięciu list — nie zdejmowanie asercji.

Lista żyje fizycznie w pięciu plikach testowych (`server/test/llm/tasks/`
×4 i `web/test/llm/patchReview.test.tsx`), bo każdy z nich liczy różnicę
diagnostyk samodzielnie. Listy w `web/test/timeline/` (akcje osi czasu) tych
dwóch identyfikatorów **nie** dostają: żaden przycisk osi czasu nie pisze prozy
do pól audio, więc reguły treści są tam nieosiągalne, a wpisanie ich tylko
rozluźniłoby asercję bez powodu — dokładnie tak samo, jak `FL2VA_PREFER_SINGLE_SHOT`
świadomie nie stoi na liście w `trackCreation.test.tsx`.

## 23. `REF_NO_NEW_LABELS_IN_SUMMARY` nie odróżnia etykiety `standalone`

Zmierzone przy Planie 5, zadanie 15: token `<Subject 2>` wstawiony do
`ref.summaryText` **nie** zapala tej reguły, a `<Subject 3>` — zapala. Powód:
`definedLabelTexts` w `shared/src/validate/rules/ref.ts` buduje zbiór znanych
etykiet z całego `project.labels`, nie filtrując po `standalone`. Tymczasem
`renderSubjectDefinitions` w `emitRef.ts` renderuje do sekcji
`subject_definitions` **wyłącznie** etykiety `standalone`.

Skutek: summary wolno powołać się na etykietę, której skompilowany prompt nigdzie
nie definiuje. Czytelnik reguły — i model, któremu tę regułę tłumaczymy w
prompcie — rozsądnie oczekuje, że obie etykiety zachowają się tak samo.

**Rozstrzygnięcie:** nie blokuje niczego i nie zmienialiśmy tego w Planie 5, bo
reguła jest starsza niż ten plan, a zaostrzenie jej zmieniłoby werdykt na
projektach, które dziś przechodzą. Domknięcie to jedna linia — ten sam filtr
`standalone`, którego używa emiter — plus test na obu wariantach.

Test `translateAll.test.ts` używa dziś `<Subject 3>` właśnie z tego powodu i
mówi o tym w komentarzu; gdyby regułę zaostrzono, `<Subject 2>` też by zadziałał
i komentarz można będzie usunąć.


## 24. Proporcje kadru: brakujące 3:4 i jedyne sensowne miejsce, gdzie mogłyby działać

Przy przeglądzie katalogu `skills` w repozytorium MiniMax-H3 wyszło, że osiem
skilli produkcyjnych oferuje użytkownikowi **16:9, 9:16, 1:1, 4:3 i 3:4**, a nasz
typ `Aspect` zna cztery pierwsze bez `3:4`. Pionowe zdjęcie z iPhone'a ma
dokładnie 3:4, a w trybach obrazowych (I2VA, FL2VA, L2VA) to właśnie wgrany kadr
ustala proporcję — więc brak tej wartości jest realną luką wobec tego, co
MiniMax proponuje własnym użytkownikom.

Same przewodniki nie wymieniają żadnych proporcji, więc **to nie jest złamanie
reguły promptu**, tylko rozjazd z resztą narzędzi dostawcy.

**Rozstrzygnięcie:** samo dopisanie `3:4` do typu i schematu byłoby gorsze niż
nic — powiększyłoby punkt 19 zamiast go spłacać, bo powstałaby kolejna wartość,
której nikt nie może wybrać i która nigdzie nie dociera.

Sensowne domknięcie jest jedno i mieści się w zasadzie „tylko eksport, bez
połączeń sieciowych", na której stoi cała integracja z ComfyUI:
**wstrzykiwanie wymiarów do workflow**. `injectPrompt`
(`server/src/export/comfyWorkflow.ts`, 37 linii) jest już generyczne — wstawia
dowolną wartość we wskazany węzeł i pole. Wystarczyłoby drugie mapowanie obok
mapowania promptu: węzeł wymiarów plus pola szerokości i wysokości, liczone z
proporcji i rozdzielczości projektu i zaokrąglone do wielokrotności wymaganej
przez ComfyUI. Dopiero wtedy wybór proporcji miałby widoczny skutek:
wygenerowane wideo ma kadr, dla którego pisało się prompt.

Ta sama zmiana automatycznie uzasadniłaby kontrolkę proporcji w inspektorze i
uczyniłaby `video.resolution` polem, które też coś robi — czyli spłaciłaby dwie
pozycje z punktu 19 naraz.

Decyzja właściciela projektu (6 sierpnia 2026): **nie teraz**. Zapisane, żeby
wróciło z gotową analizą, a nie jako odkrycie od zera.

## 25. Wariant `task: 'redact'` trasy uruchomienia stracił konsumenta w interfejsie

Plan „okno dialogowe LLM" (2026-08-06), zadanie 7. Rozmowa o polu zastąpiła w
panelu przycisk „Redakcja PL→EN", żeby do pola prowadziły jedne drzwi, a nie
dwoje. Uzasadnienie zapisane wtedy w planie i w komunikacie commita brzmiało:
„zadanie `redact` zostaje, bo korzysta z niego tłumaczenie całego projektu".

**To uzasadnienie było w połowie nieprawdziwe** i wychodzi to dopiero z
przeglądu całej gałęzi. `translateAll.ts` importuje `redactToPatch` — samą
funkcję budującą operację — a NIE `redactTaskFor` ani trasy. Po podmianie
kontrolki wariant `task: 'redact'` w `RunBody` (`server/src/routes/llm.ts:56`)
oraz `redactTaskFor` wraz z własnym promptem systemowym nie są wołane przez nic
w aplikacji. Trzyma je przy życiu wyłącznie 22 testy w `redact.test.ts`.

Zostawione świadomie, nie przeoczone: to działająca, przetestowana zdolność
dostępna po HTTP, a jednorazowe „przetłumacz to pole" bez pisania polecenia ma
sens jako operacja sama w sobie. Ale koszt jest realny i trzeba go nazwać: to
DRUGIE wejście do tych samych czterech pól, z osobnym promptem systemowym,
który może się rozejść z promptem rozmowy — a rozjazd promptów jest
niewidoczny dla typów i dla testów każdego z zadań osobno.

**Dwa uczciwe wyjścia:** albo usunąć wariant trasy i `redactTaskFor` (zostawiając
`redactToPatch` i `fieldTextSchema`, których używa tłumaczenie), albo dać
redakcji z powrotem wejście w interfejsie — na przykład jako jedno kliknięcie
wewnątrz okna rozmowy („przetłumacz to pole"), które wysyła turę bez pisania
polecenia. Drugie wyjście zachowuje jedne drzwi i odzyskuje funkcję.
