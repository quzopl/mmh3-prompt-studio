# Okno dialogowe LLM przy polu — projekt

**Data:** 2026-08-06
**Stan:** zatwierdzony przez użytkownika

## Cel

Użytkownik chce wpisać polecenie i dostać rozszerzoną wersję pola — z efektami —
a potem doprecyzowywać ją w rozmowie: „a teraz mocniej", „mniej deszczu",
„skróć". Dziś każde takie doprecyzowanie wymaga napisania polecenia od zera,
bo redakcja pola jest jednostrzałowa i niczego nie pamięta.

## Co już istnieje

Zadanie `redact` (`server/src/llm/tasks/redact.ts`) celuje w jedno pole przez
`RedactTarget` — cztery warianty: `style`, `shotText` (`shotId` +
`segmentIndex`), `audio` (`overallSoundscape` | `nonDiegeticMusic`), `speaker`
(`speakerId` + `fullDescriptor` | `shortDescriptor`). Przyjmuje polecenie
użytkownika, zwraca `{ english }`, a `redactToPatch` zamienia to na operację.
`redactSchemaFor(target)` nakłada dla celu `audio` strażnika `audioFieldText`
(liczba zdań, brak bloku `<d>`).

Brakuje mu trzech rzeczy: pamięci rozmowy, prozy do przeczytania obok operacji
oraz wiedzy o tym, czym w MMH3 są „efekty".

## Rozstrzygnięcia

### 1. Czat zastępuje jednostrzałową redakcję

Kontrolka redakcji w `web/src/llm/LlmPanel.tsx` (lista celów + pole polecenia)
zostaje zastąpiona przyciskiem otwierającym rozmowę o wybranym polu. Pierwsza
tura rozmowy robi dokładnie to, co robiła redakcja, więc nic nie ubywa.

Powód, dla którego nie zostawiamy obu wejść: w tym projekcie trzykrotnie wracała
ta sama klasa usterki — strażnik postawiony w jednych drzwiach, gdy drzwi jest
kilka (`audioFieldText.ts` powstał właśnie dlatego, że trzy zadania pisały do
pól audio trzema drogami). Jedno wejście do pola to jedne drzwi do pilnowania.

### 2. Operacje powstają tą samą drogą co dziś

Zadanie czatu zwraca `{ reply, english? }`, gdzie `english` to proponowana nowa
treść pola, a operację buduje **istniejący** `redactToPatch(result, target,
project)` — nie ma osobnej ścieżki do budowania operacji, więc nie ma czego
ominąć.

Strażnika treści dzielimy przez wyciągnięcie go o poziom niżej.
`redactSchemaFor` deklaruje typ zwrotu jako `z.ZodType<RedactResult>`, więc
`.extend()` na nim nie istnieje i czat nie może go po prostu rozszerzyć.
Zamiast tego powstaje `fieldTextSchema(target): z.ZodType<string>` — reguła
„co wolno treści przeznaczonej na TO pole", dziś rozproszona wewnątrz
`redactSchemaFor`. Oba zadania budują z niej swój schemat:

```ts
// redact.ts
const redactSchemaFor = (t: RedactTarget) => z.object({ english: fieldTextSchema(t) })
// fieldChat.ts
const chatSchemaFor = (t: RedactTarget) =>
  z.object({ reply: z.string().min(1), english: fieldTextSchema(t).optional() })
```

To ten sam ruch, którym powstał `audioFieldText.ts`: jedna definicja reguły,
którą importuje każde zadanie zdolne pisać do danego pola — zamiast trzech
schematów, które zgadzają się tylko z oglądu.

`english` jest opcjonalne: tura może być samą odpowiedzią („czym różni się
`push in` od `dolly in`?") bez propozycji zmiany. Wtedy `ops` jest puste.

`reply` to proza dla człowieka — komentarz modelu, co zmienił i dlaczego.
Odpowiada to wyborowi użytkownika „jedno i drugie": czytasz prozę, a operację
stosujesz osobno.

### 3. Rozmowy mieszkają w katalogu projektu

Każdy projekt to katalog (`server/src/storage/paths.ts`): `project.json`,
`assets/`, `exports/`. Dochodzi **`chats.json`**:

```json
{
  "version": 1,
  "threads": [
    {
      "key": "audio:overallSoundscape",
      "target": { "kind": "audio", "field": "overallSoundscape" },
      "messages": [
        { "role": "user", "text": "dodaj deszcz" },
        { "role": "assistant", "text": "Dodałem...", "english": "Rain taps..." }
      ]
    }
  ]
}
```

Rozmowy podróżują z projektem i przeżywają restart, a `ProjectSchema`
(`schemaVersion: z.literal(1)`, `shared/src/model/schema.ts`) zostaje nietknięty
— żadnej migracji i żadnego puchnięcia pliku, który obraca się w każdej
walidacji i każdej łatce.

**Tożsamość wątku** wyprowadzamy z celu, nie z losowego identyfikatora — jeden
wątek na pole, deterministycznie:

| cel | klucz |
|---|---|
| `style` | `style` |
| `shotText` | `shot:<shotId>:<segmentIndex>` |
| `audio` | `audio:<field>` |
| `speaker` | `speaker:<speakerId>:<field>` |

**Limity.** Wątek trzyma 20 ostatnich wiadomości; starsze są odcinane przy
zapisie. Cały plik ma twardy limit 256 KB — po przekroczeniu odpadają całe
najstarsze wątki. Bez limitu plik rośnie bez końca, bo nic go nie sprząta.

**Sieroty.** Ujęcie albo mówca mogą zniknąć z projektu, a ich wątek zostaje.
Przy każdym zapisie odpadają wątki, których cel nie rozwiązuje się już w
projekcie (`redactSourceText(project, target) === undefined`).

### 4. Efekty żyją w prozie, nie w osobnym polu

MMH3 nie ma pola na efekty. Przewodnik (`docs/guide_base.md`) prowadzi je jako
**obserwowalny opis fizyczny** wewnątrz ciała ujęcia — przykład dostawcy:
„cracks spread through it as fragments slide outward", „the scene or lighting
transitions" — oraz jako amplitudę i prędkość we frazie kamery („pushes in with
small amplitude at slow speed").

Prompt systemowy czatu uczy więc modelu czterech rodzin efektów:

1. **Światło** — przejścia, źródła, kierunek, kontrast.
2. **Pogoda i atmosfera** — deszcz, mgła, kurz, para, iskry.
3. **Zachowanie materii** — pękanie, rozlewanie, opadanie, tracenie pędu.
4. **Tempo ruchu** — szybkość i amplituda, także we frazie kamery.

I wprost zakazuje słów nastroju („melancholic", „dramatic", „eerie"): dla pola
`nonDiegeticMusic` zapalają one regułę `MUSIC_NO_MOOD_WORDS`, co potwierdziło
uruchomienie na serwerze 2026-08-05.

### 5. Reguła wiążąca

Czat nie może wyprodukować diagnostyki na projekcie, który jej nie miał — poza
przyjętymi wyjątkami z `docs/superpowers/specs/2026-08-04-uwagi-do-planu-2.md`.
Operacje idą przez zwykły `PatchReview` (`web/src/llm/PatchReview.tsx`), gdzie
domyślnie nic nie jest zaznaczone, więc żadna zmiana nie wchodzi do projektu bez
decyzji użytkownika.

## Architektura

### Serwer

**`server/src/llm/chatStore.ts`** (nowy) — czyta i zapisuje `chats.json`.
Odpowiada za przycinanie do 20 wiadomości, limit 256 KB i usuwanie sierot.
Zapis przez plik tymczasowy i `rename`, tak jak `projectStore.ts` — z tego
samego powodu: `writeFile` najpierw obcina plik.

**`server/src/llm/tasks/fieldChat.ts`** (nowy) — definicja zadania:
- `name`: `'rozmowa o polu'`
- `schema`: `redactSchemaFor(target).extend({ reply: z.string().min(1) })`
  z `english` uczynionym opcjonalnym
- `buildMessages`: prompt systemowy (reguły kształtu pola + rodziny efektów +
  zakaz słów nastroju), potem historia wątku jako naprzemienne `user`/
  `assistant`, na końcu nowa wiadomość
- `maxTokens`: 900

**`server/src/routes/llm.ts`** — `POST /api/llm/run` zyskuje wariant
`task: 'fieldChat'` z polami `target` i `message`. Trasa ładuje wątek, buduje
wiadomości, a **po** zdarzeniu `done` dopisuje obie tury do `chats.json`.
Zapis po sukcesie, nie przed: przerwana albo błędna tura nie ma czego zapisywać.

**`server/src/routes/projects.ts`** — `GET /api/projects/:slug/chats` zwraca
wątki, `DELETE /api/projects/:slug/chats/:key` czyści jeden wątek. Klucz wątku
zawiera dwukropki (`shot:s-1:0`), więc w ścieżce jedzie zakodowany
(`encodeURIComponent`) i jest dekodowany po stronie trasy.

### Web

**`web/src/llm/FieldChat.tsx`** (nowy) — okno dialogowe: lista tur, pole
wiadomości, przycisk wysyłki, przycisk czyszczenia wątku. Każda tura modelu,
która przyniosła operację, pokazuje ją przez `PatchReview`.

**`web/src/llm/LlmPanel.tsx`** — lista celów zostaje, ale pole polecenia i
przycisk „Redaguj" ustępują przyciskowi „Rozmawiaj o tym polu", który otwiera
`FieldChat` dla wybranego celu.

## Testy

1. **Round-trip zapisu** — wątek zapisany i odczytany wraca identyczny.
2. **Przycinanie** — 25 wiadomości na wejściu, 20 najnowszych na wyjściu.
3. **Limit pliku** — przekroczenie 256 KB usuwa najstarsze wątki, nie tnie
   pliku w połowie.
4. **Sieroty** — wątek ujęcia usuniętego z projektu znika przy zapisie.
5. **Strażnik audio** — odpowiedź czatu z pięcioma zdaniami dla
   `overallSoundscape` jest odrzucona przez schemat (ta sama asercja, co dla
   `redact`, bo ta sama droga).
6. **Reguła wiążąca** — projekt bez diagnostyk po zastosowaniu operacji z czatu
   nadal nie ma diagnostyk poza przyjętymi wyjątkami.
7. **Historia trafia do promptu** — druga tura widzi pierwszą.
8. **Tura bez zmiany** — odpowiedź bez `english` daje pustą listę operacji.

Każdy test musi paść po cofnięciu kodu, który sprawdza. To nie jest formalność:
w tym projekcie trzy testy okazały się bezczynne (dwa zestawy pustych reguł,
regex bez jednej litery, brak rejestracji reguł poza `buildPrompt`).

## Świadomie poza zakresem

- **Czat dla etykiet i retencji** — `redact` też ich nie obejmuje; dołożenie
  ich to osobna decyzja, nie efekt uboczny tej.
- **Rozmowa o całym projekcie** — użytkownik wybrał okno na pole.
- **Strumieniowanie częściowych operacji** — operacja powstaje z całej
  odpowiedzi; strumień `chunk` służy podglądowi tekstu, tak jak dziś.
- **Edycja wielu pól jedną turą** — wątek należy do jednego pola.
