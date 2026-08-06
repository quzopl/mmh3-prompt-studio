# Model bez konfiguracji: autodetekcja, VRAM, pobranie silnika i modelu — projekt

**Data:** 2026-08-06
**Stan:** zatwierdzony przez użytkownika

## Cel

Dziś, żeby aplikacja zaczęła korzystać z modelu językowego, użytkownik musi sam
zdobyć binarkę `llama-server`, sam pobrać plik `.gguf` i sam wpisać obie ścieżki
w panel. Postawienie tego na czystej maszynie zajęło mi (2026-08-06, serwer
`154.54.100.218`) kilka kroków ręcznych i jeden restart maszyny w połowie
pobierania 8,4 GB.

Trzy funkcje mają to zdjąć z użytkownika:

1. **Autodetekcja** — jeśli na maszynie już stoi Ollama albo LM Studio, znaleźć
   je i wypełnić ustawienia jednym kliknięciem.
2. **Zużycie VRAM** — pokazać, ile pamięci karty jest zajęte, żeby decyzja
   „który model się zmieści" i „czy zwolnić pamięć przed ComfyUI" miała oparcie
   w liczbach.
3. **Pobranie** — gdy nie ma nic, pobrać silnik i model i skonfigurować je same.

## Wzorzec, z którego to wyrasta

Użytkownik wskazał własny projekt `ideogram4-flux2-lora-studio` jako źródło
gotowych funkcji. **Kodu nie da się przenieść** i trzeba to powiedzieć wprost:
tam pobieranie robi `from_pretrained()` z `transformers`, a VRAM daje
`torch.cuda.mem_get_info()`. Ten projekt jest w Node i używa llama.cpp — nie ma
tam ani torcha, ani `transformers`.

Przenoszą się natomiast trzy rozstrzygnięcia projektowe i to one kształtują ten
dokument:

- **Lista kuratorowana zamiast pola na URL** (`CAPTIONERS` w `backend/captioner.py`:
  `"Qwen/Qwen2.5-VL-3B-Instruct": "Qwen2.5-VL 3B (fp16, fast, ~7 GB VRAM)"`).
  Użytkownik wybiera z opisanych pozycji, nie wkleja adresu.
- **VRAM jako `używane/całkowite` w jednej linijce statusu**
  (`frontend/app.js`: `VRAM ${g.vram_used_gb}/${g.vram_total_gb} GB`).
- **Brak karty to brak liczb**, nie zera — `gpu_status()` dokłada pola VRAM
  tylko gdy `torch.cuda.is_available()`.

## Rozstrzygnięcia

| Pytanie | Decyzja |
|---|---|
| Co pobieramy | Model **i** silnik — na czystej maszynie sam `.gguf` niczego nie uruchomi |
| Kiedy | Po kliknięciu, z podanym rozmiarem — nigdy samo |
| Skąd model | Trzy pozycje z listy kuratorowanej, bez pola na URL |
| Windows | Wariant CPU silnika (uzasadnienie niżej) |

---

## 1. Autodetekcja dostawców

### Co robi

Skanuje **wyłącznie `127.0.0.1`** po trzech znanych portach i rozpoznaje, co na
nich stoi:

| Port | Sonda | Rozpoznanie |
|---|---|---|
| 11434 | `GET /api/tags` | Ollama |
| 1234 | `GET /api/v0/models` | LM Studio |
| 8080 | `GET /v1/models` | serwer zgodny z OpenAI (np. `llama-server`) |

Kolejność sond na jednym porcie jest istotna: `/v1/models` odpowiada TAKŻE
Ollama i LM Studio (oba udają API OpenAI), więc sondy specyficzne idą pierwsze,
a ogólna jest ostatnią deską ratunku. Bez tego każdy dostawca zostałby nazwany
„zgodny z OpenAI" i użytkownik straciłby informację, że ma Ollamę — a od niej
zależy, czy działa zwalnianie pamięci karty (`unload.ts`).

Dla każdego znalezionego dostawcy pobieramy listę modeli, żeby panel mógł
napisać „3 modele" zamiast „coś tam stoi".

**Tylko pętla lokalna.** Skanowanie cudzych adresów z serwera aplikacji to
skaner portów, nie wygoda — a aplikacja bywa wystawiona na `0.0.0.0`.

### Co ponownie używa

`probeOk` z `server/src/llm/unload.ts` — ta sama funkcja, która dziś rozpoznaje
Ollamę i LM Studio na potrzeby zwalniania pamięci. Detekcja nie dostaje własnej
kopii sondowania; obie strony mają wiedzieć to samo o tym samym dostawcy.

### Interfejs

W panelu dostawcy, nad przełącznikiem trybu: przycisk **„Szukaj lokalnych
serwerów"**, a po skanie lista znalezionych z przyciskiem przy każdej pozycji,
który wypełnia `baseUrl`, ustawia tryb `endpoint` i zapisuje ustawienia.
Gdy nic nie znaleziono — jedno zdanie, że nic nie stoi, i to jest normalny stan,
nie błąd.

### Trasa

`GET /api/llm/discover` → `{ found: Array<{ kind, baseUrl, models: string[] }> }`

---

## 2. Zużycie VRAM

### Co robi

`nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader,nounits`
daje trzy wartości na kartę. Bierzemy pierwszą kartę.

Zwracamy `null`, gdy: `nvidia-smi` nie istnieje, kończy się błędem, albo jego
wyjście nie parsuje się na dwie liczby. **`null` znaczy „nie wiem" i interfejs
wtedy nie pokazuje nic** — zero udające pomiar jest gorsze niż brak pomiaru
(ta sama zasada, którą `useLlmRun` stosuje do liczników tokenów: `null` to
kreska, nie zero).

### Interfejs

Jedna linijka w panelu dostawcy: `RTX PRO 6000 · VRAM 10,6 / 97,9 GB`.

**Wymaga odpytywania cyklicznego, którego dziś NIE MA.** Sprawdziłem przed
napisaniem tego akapitu: `LlmPanel` pobiera `GET /api/llm/managed/state`
DOKŁADNIE RAZ, w `useEffect` z pustą tablicą zależności — nie ma żadnej pętli.
Pierwsza wersja tego dokumentu twierdziła, że „odświeża się tym samym
odpytywaniem, które już chodzi"; to była nieprawda, a VRAM pokazany raz przy
otwarciu panelu byłby bezużyteczny — nie pokazałby ani wzrostu po starcie
modelu, ani spadku po kliknięciu „Zwolnij pamięć karty", czyli obu momentów, w
których liczba ma znaczenie.

Dokładamy więc odpytywanie co **5 sekund**, dopóki panel jest zamontowany, tą
samą trasą (nowe pole w odpowiedzi). Koszt: jedno uruchomienie `nvidia-smi` na
5 sekund, ~50 ms procesu, wyłącznie gdy panel jest otwarty. Gdy odczyt karty
zwróci `null`, odpytywanie **przestaje pytać o kartę** do końca życia panelu —
maszyna bez NVIDII nie ma powodu uruchamiać nieistniejącego polecenia co pięć
sekund.

Wartość ma znaczenie w dwóch miejscach poza samą ciekawością: podpowiada, który
model z listy się zmieści (punkt 3), i pokazuje efekt przycisku zwolnienia
pamięci karty, który dziś działa „na słowo".

### Trasa

Rozszerzenie istniejącego `GET /api/llm/managed/state` o pole
`gpu: { name: string; usedMb: number; totalMb: number } | null`.

---

## 3. Pobranie silnika i modelu

### Lista modeli

Trzy pozycje, rozmiary **zmierzone** (`curl -sIL`, 2026-08-06), nie przepisane
z opisu:

| Pozycja | Plik | Rozmiar | Zalecany VRAM |
|---|---|---|---|
| Qwen2.5 7B Instruct Q4_K_M | `Qwen2.5-7B-Instruct-Q4_K_M.gguf` | 4,4 GB | ~6 GB |
| Qwen2.5 14B Instruct Q4_K_M | `Qwen2.5-14B-Instruct-Q4_K_M.gguf` | 8,4 GB | ~11 GB |
| Qwen2.5 32B Instruct Q4_K_M | `Qwen2.5-32B-Instruct-Q4_K_M.gguf` | 19 GB | ~22 GB |

Źródło: `https://huggingface.co/bartowski/<repo>/resolve/main/<plik>`.
Model 14B jest domyślny — to ten, na którym przeszły wszystkie testy prozy na
serwerze 2026-08-05 i 2026-08-06.

Gdy VRAM jest znany (punkt 2), pozycje wymagające więcej pamięci, niż jest
WOLNE, dostają ostrzeżenie przy nazwie. Nie blokujemy ich: model większy niż
VRAM nadal działa, tylko wolniej (llama.cpp przenosi część warstw na CPU), a
decyzja należy do użytkownika.

### Silnik

Wybór wydania po platformie (`process.platform` + `process.arch`):

| Platforma | Zasób wydania |
|---|---|
| linux x64 | `llama-<v>-bin-ubuntu-vulkan-x64.tar.gz` |
| linux arm64 | `llama-<v>-bin-ubuntu-vulkan-arm64.tar.gz` |
| darwin arm64 | `llama-<v>-bin-macos-arm64.tar.gz` |
| darwin x64 | `llama-<v>-bin-macos-x64.tar.gz` |
| win32 x64 | `llama-<v>-bin-win-cpu-x64.zip` |

Nieobsługiwana kombinacja → czytelny komunikat ze wskazaniem strony wydań, nie
próba pobrania czegokolwiek.

**Dlaczego Vulkan na Linuksie:** działa na NVIDII bez instalowania toolkitu
CUDA — sprawdzone wprost na `154.54.100.218` (RTX PRO 6000 Blackwell,
`llama-server --list-devices` widzi kartę). Wariant `ubuntu-x64` jest wyłącznie
CPU, a `ubuntu-rocm`/`sycl` celują w inny sprzęt.

**Dlaczego Windows na CPU:** warianty CUDA wymagają DRUGIEGO pobrania
(`cudart-llama-bin-win-cuda-*.zip`), a nie mam maszyny z Windows, żeby
sprawdzić, czy złożenie obu działa. Obiecywanie akceleracji, której nie
zweryfikowałem, byłoby zgadywaniem. Zapisane jako znane ograniczenie w README.

**Wersja wydania jest PRZYPIĘTA** (`b10295`), nie „najnowsza". Powód jest
konkretny: 2026-08-06 najnowsze wydanie llama.cpp (`b10297`) niosło wyłącznie
binaria Windows — pobieranie „latest" wywróciłoby się na Linuksie. Podniesienie
przypięcia to świadoma zmiana w kodzie, nie loteria zależna od dnia.

### Miejsce na dysku

```
~/mmh3-studio/
    projects/           dane projektów (dziś, bez zmian)
    runtime/
        engine/         rozpakowane wydanie llama.cpp
        models/         pliki .gguf
```

`runtime/` stoi OBOK `projects/`, nie w środku: to nie są dane projektu i nie
mają wędrować przy kopiowaniu katalogu projektu. Ścieżkę nadpisuje
`MMH3_RUNTIME_ROOT`, tak jak `MMH3_DATA_ROOT` nadpisuje dane.

### Przebieg pobrania

1. **Sprawdzenie miejsca** — `statfs` na `runtime/`; gdy wolnego mniej niż
   rozmiar pobrania + 1 GB zapasu, odmowa z podaniem obu liczb. Zapełnienie
   dysku w połowie 19 GB jest gorsze niż niezaczęcie.
2. **Silnik** — pobranie archiwum, rozpakowanie do `runtime/engine/`, nadanie
   prawa wykonywania, **weryfikacja uruchomieniem** `llama-server --version`.
   Binarka, która się nie uruchamia, ma się ujawnić tu, a nie przy pierwszym
   zadaniu użytkownika. (Przy stawianiu ręcznym skopiowałem samą binarkę bez
   bibliotek obok i nie działała — dlatego rozpakowujemy CAŁE wydanie i
   zostawiamy strukturę katalogu nietkniętą.)
3. **Model** — pobranie do pliku tymczasowego, na koniec `rename`. Ten sam
   powód co w `projectStore.ts`: przerwanie nie ma zostawić pliku, który wygląda
   na kompletny.
4. **Wznawianie** — nagłówek `Range: bytes=<rozmiar dotychczasowy>-` gdy plik
   tymczasowy już istnieje. Nie z teorii: przy ręcznym stawianiu maszyna
   zrestartowała się w połowie 8,4 GB i wznowienie oszczędziło całe pobieranie
   od nowa.
5. **Zapis ustawień** — tryb `managed`, ścieżki wskazane na pobrane pliki,
   `gpuLayers: 99`, `contextSize: 8192`. Użytkownikowi zostaje kliknięcie
   „Uruchom serwer".

### Postęp

Strumień SSE, ten sam mechanizm co `POST /api/llm/run`: zdarzenia `progress`
(pobrane bajty / całość / etap), `done`, `error`. Panel pokazuje pasek z
procentem i etapem („silnik", „model"), plus przycisk przerwania.

Przerwanie zostawia plik tymczasowy — następne kliknięcie wznawia, nie zaczyna
od zera.

### Trasy

- `GET /api/llm/catalog` → lista modeli z rozmiarami i wymaganym VRAM oraz
  wskazanie zasobu silnika dla TEJ platformy (albo informacja, że jej nie
  obsługujemy).
- `POST /api/llm/install` (SSE) → `{ modelId }`, pobiera silnik (jeśli go nie ma)
  i wskazany model, na koniec zapisuje ustawienia.

---

## Testy

**Autodetekcja**
1. Atrapa serwera HTTP odpowiadająca jak Ollama → rozpoznana jako `ollama`.
2. Atrapa odpowiadająca WYŁĄCZNIE na `/v1/models` → rozpoznana jako `openai`,
   nie jako Ollama.
3. Atrapa odpowiadająca i na `/api/tags`, i na `/v1/models` → `ollama`
   (kolejność sond ma znaczenie i jest testowana wprost).
4. Nic nie nasłuchuje → pusta lista, bez wyjątku.

**VRAM**
5. Nagrane wyjście `nvidia-smi` → poprawnie sparsowane trzy wartości.
6. Brak `nvidia-smi` (polecenie nieistniejące) → `null`, nie wyjątek.
7. Wyjście nieparsowalne („N/A") → `null`.
8. Interfejs przy `gpu: null` nie pokazuje linijki VRAM w ogóle.

**Pobranie**
9. Mapowanie platforma→zasób: pięć obsługiwanych par daje oczekiwane nazwy,
   nieobsługiwana daje błąd, nie ciche pobranie czegokolwiek.
10. Pobranie z lokalnego serwera bajtów kończy się plikiem o właściwym rozmiarze
    pod właściwą nazwą, a plik tymczasowy znika.
11. Przerwanie w połowie i ponowne wywołanie → drugie żądanie niesie nagłówek
    `Range`, a plik wynikowy jest kompletny i identyczny z pobranym za jednym
    razem.
12. Zbyt mało miejsca na dysku → odmowa PRZED pierwszym bajtem.
13. Weryfikacja silnika: gdy `--version` kończy się błędem, instalacja zgłasza
    porażkę zamiast zapisać ustawienia wskazujące na zepsutą binarkę.
14. Po udanej instalacji ustawienia wskazują na pobrane pliki, a tryb to
    `managed`.

**Reguła wspólna:** każdy test musi paść po cofnięciu kodu, który sprawdza.
W tym repozytorium cztery testy okazały się dotąd bezczynne albo poprawne wobec
złej próbki — krok weryfikacji odwrotnej jest obowiązkowy.

## Świadomie poza zakresem

- **Akceleracja na Windows** — patrz uzasadnienie wyżej; wariant CPU działa
  wszędzie, a reszta wymaga sprzętu, którego nie mam.
- **Skanowanie sieci poza `127.0.0.1`** — to skaner portów, nie funkcja.
- **Suma kontrolna pobranego modelu** — HuggingFace podaje ETag, ale nie jest to
  stabilny SHA pliku dla wszystkich repozytoriów. Kompletność sprawdzamy
  rozmiarem względem `Content-Length`, a uszkodzony model i tak ujawni się przy
  starcie `llama-server`, którego wynik użytkownik widzi w logu panelu.
- **Automatyczne pobieranie bez pytania** — odrzucone przez użytkownika;
  kilka gigabajtów rusza wyłącznie po kliknięciu, z podanym rozmiarem.
- **Wiele kart GPU** — pokazujemy pierwszą. Druga karta to inny problem
  (wybór urządzenia dla llama.cpp), którego ta zmiana nie dotyka.
