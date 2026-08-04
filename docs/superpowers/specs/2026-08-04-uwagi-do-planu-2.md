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
wzorzec (`shared/src/model/schema.ts:134`). Migracja plików projektów nie była
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
