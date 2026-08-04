# MMH3 Prompt Studio — specyfikacja projektowa

Data: 2026-08-04
Status: zatwierdzona do planowania wdrożenia

## 1. Cel

Profesjonalne narzędzie do budowania promptów wideo dla modelu **MiniMax-H3**, w którym metaforą interfejsu jest montażownia (NLE): wielościeżkowa oś czasu, program monitor, inspektor kontekstowy, undo/redo, skróty klawiszowe.

Powód, dla którego to nie jest ozdobnik: format promptu MiniMax-H3 jest formatem **czasowym**. Timestampy cięć muszą być ściśle rosnące i mieścić się w długości wideo (4–15 s), klatki kluczowe kotwiczą się na 0.00 s i S.SS s, dialog przecinający cięcie wymaga osobnych znaczników, a mowa musi się zmieścić w oknie czasowym. To są dosłownie problemy montażowe, więc oś czasu niesie walidację, a nie tylko wygląd.

Aplikacja **nie generuje wideo**. Generowanie odbywa się w ComfyUI; aplikacja produkuje prompt i opcjonalnie workflow JSON do wrzucenia tam ręcznie.

### 1.1 Źródła prawdy

Dwa dokumenty MiniMaxAI, skopiowane do `docs/guide_base.md` i `docs/guide_ref.md`:

- `VIDEO_PROMPT_WRITING_GUIDE_base_en.md` — tryby T2VA / I2VA / FL2VA / L2VA
- `VIDEO_PROMPT_WRITING_GUIDE_ref_en.md` — tryb pełnoreferencyjny (Ref2VA)

Każda reguła walidatora cytuje sekcję źródłową. Gdy guide i ta specyfikacja się rozjeżdżają, wygrywa guide.

### 1.2 Parametry modelu istotne dla aplikacji

- długość 4–15 s, 24 FPS, do 2K (domyślnie 768p), audio stereo 32 kHz
- proporcje 16:9, 4:3, 1:1, pionowe
- Ref2VA: maksymalnie 9 obrazów, 3 klipy wideo, 3 klipy audio

## 2. Decyzje zakresowe

| Decyzja | Wybór |
|---|---|
| Wyjście | prompt (tekst + JSON), bez generowania wideo |
| ComfyUI | tylko eksport pliku, bez połączenia sieciowego |
| Tryby | wszystkie: T2VA, I2VA, FL2VA, L2VA, REF |
| LLM | lokalny: endpoint OpenAI-compatible **oraz** zarządzany `llama-server` z pliku `.gguf` |
| Role LLM | pomysł→struktura, redakcja PL→EN, podpowiedzi audio, krytyk promptu |
| Forma | lokalna aplikacja webowa, React + TypeScript + Vite + lekki backend Node |
| Edytor | NLE-first — wielościeżkowa oś czasu jest centrum aplikacji |
| Język UI | dwujęzyczny przełącznik PL/EN; prompt wyjściowy zawsze po angielsku |
| Lokalizacja | `~/mmh3-studio` |

## 3. Model domeny

Jeden model obsługuje wszystkie tryby. Tryb decyduje, które ścieżki i sekcje są aktywne oraz jak kompilator ustawia kotwice klatek.

```
Project
  meta       id, nazwa, schemaVersion, createdAt, updatedAt
  mode       T2VA | I2VA | FL2VA | L2VA | REF
  video      durationMs (4000–15000), fps 24, aspect (16:9|4:3|1:1|9:16), resolution
  style      visualStyle, lighting, palette
  assets[]   pliki na dysku, miniatury, waveformy
  labels[]   <Subject N> | <Picture N> | <Video N> | <Audio N>, wiązane z assetami
  speakers[] S1..Sn
  shots[]    ujęcia w kolejności
  audio      overallSoundscape, nonDiegeticMusic
  ref        taskTypes[], summaryText, retention[]
```

Umiejscowienie stylu różni się między trybami: w trybach bazowych styl trafia **po** `[Shot 1]`, w trybie REF jako 1–2 zdania **przed** `[Shot 1]`. Obsługuje to kompilator, użytkownik wypełnia jedno pole.

```
Shot
  id, index
  startMs        Shot 1 = 0 i nie dostaje timestampu; kolejne → [Shot N] At MM:SS.mmm
  cutType        cut | cross-dissolve | fade | wipe
  cutPhrase      the camera cuts to | the shot cuts to | the shot transitions to |
                 the shot changes to | the shot switches to
  composition    plan i kadr
  body[]         Segment — proza ujęcia jako lista segmentów (patrz niżej)
  cameraMoves[]  CameraMove
  dialogue[]     DialogueEvent
  screenText[]   tekst widoczny w kadrze
  diegeticSfx[]  dźwięk zsynchronizowany z ujęciem
  labelRefs[]    pierwsze wystąpienia etykiet
  anchor         picture-first | picture-last | keyframe | none

Segment — jednostka prozy w ciele ujęcia. Konkatenacja wyrenderowanych
segmentów daje dokładny tekst ujęcia, dzięki czemu ruch kamery, opis mówcy
i dialog mogą znaleźć się w jednym zdaniu, tak jak wymaga guide.
  { kind: 'text',     text }
  { kind: 'camera',   moveId }        → "The camera pushes in with small amplitude at slow speed"
  { kind: 'speaker',  speakerId, descriptor, form: full | short | idOnly }
                                      → "the middle-aged baker with a calm, slightly raspy voice (S1)"
  { kind: 'dialogue', eventId }       → "says: <d>[English] First batch of the morning.</d>"
  { kind: 'label',    labelId, speakerId?, bracketed }
                                      → "<Subject 3> (S1)" albo "Picture 1" bez nawiasów kątowych
  { kind: 'screenText', id }          → "\"营业中\""

Guide bywa niekonsekwentny w zapisie etykiet (raz `<Picture 1>`, raz `Picture 1`),
dlatego zapis w nawiasach kątowych jest własnością pojedynczego wystąpienia.

CameraMove
  type       12 kategorii ruchu z tabeli guide'a, 20 konkretnych wartości:
             Zoom In | Zoom Out | Push In | Pull Out | Pan Left | Pan Right |
             Truck Left | Truck Right | Tilt Up | Tilt Down | Pedestal Up |
             Pedestal Down | Arc Shot | Tracking Shot | Static Shot |
             Shake Slightly | Shake Strongly | POV | Roll Clockwise |
             Roll Counterclockwise
  amplitude  small | large | (pominięte = średnia)
  speed      slow | fast | (pominięte = normalna)
  target     tekst, np. "toward the folded letter in her hands"
  startMs, endMs   w granicach ujęcia

Speaker
  id (S1, S2, …), characterType, age, gender, pitch, timbre, rate, accent,
  onScreen: bool
  Pola tożsamości renderują się przy pierwszym wystąpieniu, potem skrócona referencja.

DialogueEvent
  speakerIds[]   jeden lub wiele → (S1) albo (S1,S2)
  language       tag do <d>[Language] …</d>
  text           verbatim, nietykalne
  delivery       sposób podania, renderowany POZA <d>
  voiceover      bool → fraza "says in an off-screen voiceover" + klauzula o zamkniętych ustach
  crossesCut     bool → <scenetrans> po obu stronach + zdanie o ciągłości
  cutoff         bool → <cutoff>
  startMs        pozycja na osi; długość szacowana z liczby słów i tempa mowy

Label
  kind: subject | picture | video | audio
  index          numeracja niezależna w każdej kategorii
  assetIds[]     jeden subject może pochodzić z wielu assetów
  definition     treść linii w subject_definitions
  role           rola referencyjna
  standalone     czy dostaje własną linię, czy jest cytowany wewnątrz innej definicji

RetentionEntry
  labelId
  scope          np. "appears in [Shot 1], [Shot 3]" — wyliczane z osi czasu
  marker         wizualne: fully_preserved | partially_preserved | attribute_transfer |
                 weak_reference
                 audio: fully_copy | partially_copy | reference | weak_reference
  note
```

## 4. Tryby i ich objaśnienia w aplikacji

Wybór trybu to pełnoekranowy ekran z diagramem osi czasu dla każdego trybu, a nie lista rozwijana. Dla każdego trybu: co dostarczasz, gdzie model zostaje zakotwiczony, kiedy tego użyć, jaka struktura powstanie.

| Tryb | Co dajesz | Kotwica | Kiedy | Reguła szczególna |
|---|---|---|---|---|
| T2VA | sam tekst | brak | budujesz oś od zera | jedyny tryb bez linii alignmentu |
| I2VA | 1 obraz | `<Picture 1>` = 0.00 s w `[Shot 1]` | masz kadr otwarcia | tożsamość, ubiór, kolory, relacje przestrzenne muszą zostać zachowane |
| FL2VA | 2 obrazy | Picture 1 → 0.00 s, Picture 2 → S.SS s | znasz początek i koniec | preferowane pojedyncze ujęcie; ostrzeżenie przy dodaniu cięcia |
| L2VA | 1 obraz | `<Picture 1>` = S.SS s w ostatnim ujęciu | znasz pointę | Picture 1 należy do `[Shot N]`, nie do Shot 1 |
| REF | ≤9 obrazów, ≤3 wideo, ≤3 audio | etykiety | spójność postaci, montaż, kontynuacja, barwa głosu | sześć sekcji, opis 350–500 słów |

Linie alignmentu generowane przez kompilator, dosłownie według guide'a:

- I2VA: `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.`
- FL2VA: `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.`
- L2VA: `How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.`

Po linii instrukcji następuje jedna pusta linia, potem pola główne.

Do każdego pola w inspektorze przypisany jest kontekstowy przycisk pomocy cytujący właściwą regułę guide'a, w języku wybranym przełącznikiem.

## 5. Kompilator

Czysta funkcja bez React i bez I/O:

```
compile(project) → { text, tokens, diagnostics }
```

`tokens` to mapa zakresów tekstu na identyfikatory obiektów modelu — dzięki temu kliknięcie w panelu promptu zaznacza klip na osi i odwrotnie.

Dwa emitery:

**Emiter bazowy** (T2VA / I2VA / FL2VA / L2VA):

```
[linia alignmentu — poza T2VA]

integrated_multimodal_description: [Shot 1] …

overall_soundscape: …

non_diegetic_music: …
```

**Emiter referencyjny** (REF), sześć sekcji w kolejności:

```
subject_definitions:
summary:
retention_analysis:
detailed_description:
overall_soundscape:
non_diegetic_music:
```

Różnica układu między emiterami: w trybach bazowych wszystkie ujęcia idą **w jednym akapicie**, oddzielone spacją (`… </d> [Shot 2] At 00:05.000, …`). W trybie REF `detailed_description:` zaczyna się od zdania o stylu w nowej linii, a **każde ujęcie zaczyna nową linię**.

Zasady składania, które kompilator realizuje automatycznie:

- Shot 1 bez timestampu; kolejne jako `[Shot N] At MM:SS.mmm, <cutPhrase> …`
- ruch kamery jako naturalne zdanie angielskie wewnątrz ujęcia, nie doklejona etykieta na końcu: `The camera pushes in with small amplitude at slow speed toward the folded letter in her hands.`
- amplituda i prędkość pomijane, gdy średnia/normalna
- opis tożsamości mówcy przy pierwszym wystąpieniu, skrócona referencja przy kolejnych
- `<d>[Language] …</d>` zawiera wyłącznie tag języka i treść verbatim; sposób podania i akcja poza znacznikiem
- voiceover: dokładna fraza `says in an off-screen voiceover`, a bezpośrednio po bloku `<d>` klauzula o całkowicie zamkniętych ustach postaci
- dialog przecinający cięcie: `<scenetrans>` po obu stronach plus zdanie o ciągłości z dozwolonej listy (`continues seamlessly across the cut`, `continues uninterrupted into the next shot`, `carries over from the previous shot`, `remains audible across the transition`)
- tekst ekranowy w angielskich cudzysłowach podwójnych, bez tłumaczenia
- `S.SS` zawsze z dokładnie dwoma miejscami po przecinku
- w trybie REF `retention_analysis` w formatach: `<Subject 1> (appears in [Shot 1], [Shot 3]): fully_preserved - …`, `<Picture 2> ([Shot 1] first frame): fully_preserved - …`, `<Video 1> (cut and pacing structure): weak_reference - …`, `<Audio 1>: fully_copy - …`
- prefiks `summary` z typów zadania połączonych przez ` + `, bez powtórzeń; przy montażu wideo summary zaczyna się od `The target video is an edited version of <Video 1>.`
- gdy subject mówi, forma `<Subject N> (Sx)`

## 6. Walidator

Zbiór nazwanych reguł. Każda ma identyfikator, poziom (błąd / ostrzeżenie / wskazówka), wskaźnik na obiekt modelu i cytat źródłowy z guide'a. Panel walidacji jest klikalny: przejście do obiektu na osi i otwarcie właściwego pola w inspektorze.

**Czas**

- `SHOT1_NO_TIMESTAMP` — pierwsze ujęcie bez timestampu
- `SHOT_TIME_MONOTONIC` — czasy cięć ściśle rosnące
- `SHOT_TIME_IN_RANGE` — czasy w granicach długości wideo
- `DURATION_RANGE` — długość 4000–15000 ms
- `FRAME_SNAP` — czasy przyciągane do klatki przy 24 fps
- `ALIGNMENT_DECIMALS` — `S.SS` z dwoma miejscami po przecinku

**Kamera**

- `CAM_VOCAB` — wyłącznie typy z zamkniętego słownika
- `CAM_REDUNDANT_MODIFIER` — pomijaj amplitudę/prędkość, gdy średnia/normalna
- `CAM_IN_SHOT_BOUNDS` — ruch mieści się w granicach ujęcia
- `CUT_SHOULD_BE_MOVE` — ostrzeżenie, gdy sąsiednie ujęcia różnią się tylko dystansem lub drobnym kątem; guide każe wtedy użyć ruchu kamery zamiast cięcia
- `BODY_REFS_COMPLETE` — każdy ruch kamery i każde zdarzenie dialogowe jest przywołane w `body` ujęcia dokładnie raz; żaden segment nie wskazuje na nieistniejący obiekt
- `TRANSITION_EXPLICIT` — cross-dissolve/fade/wipe tylko przy świadomym wyborze

**Mówcy i dialog**

- `SPEAKER_ID_STABLE` — ID stałe między ujęciami
- `SPEAKER_SILENT_NO_ID` — postać niemówiąca nie dostaje ID
- `SPEAKER_FIRST_INTRO` — przy pierwszym wystąpieniu wymagany opis tożsamości głosu
- `DIALOGUE_D_TAG_PURE` — wewnątrz `<d>` tylko tag języka i treść
- `DIALOGUE_VERBATIM` — treść `<d>` nigdy nie jest tłumaczona ani przepisywana, także przez LLM
- `VO_EXACT_PHRASE` — voiceover używa dokładnej frazy z guide'a
- `VO_LIPS_CLAUSE` — po bloku `<d>` voiceoveru musi wystąpić klauzula o zamkniętych ustach
- `SCENETRANS_BOTH_SIDES` — `<scenetrans>` po obu stronach cięcia plus zdanie o ciągłości
- `CUTOFF_AT_END` — `<cutoff>` przy mowie uciętej końcem wideo
- `SPEECH_FITS` — ostrzeżenie, gdy szacowana długość mowy nie mieści się w oknie czasowym

**Audio**

- `SOUNDSCAPE_SENTENCES` — 1–4 zdania, jeden akapit
- `MUSIC_SENTENCES` — 1–3 zdania
- `SOUNDSCAPE_NO_DIALOGUE` — dialog, śpiew i muzyka diegetyczna nie powtarzają się w soundscape
- `SOUNDSCAPE_NA_ONLY_IF_SILENT` — `N/A` tylko przy wyraźnie żądanej ciszy
- `MUSIC_NO_MOOD_WORDS` — wykrywanie abstrakcyjnych słów o nastroju; guide wymaga instrumentacji, tempa, rytmu i dynamiki
- `DIEGETIC_IN_DESCRIPTION` — muzyka słyszalna dla postaci należy do opisu ujęcia, nie do `non_diegetic_music`

**Tryb REF**

- `REF_LABEL_DEFINED` / `REF_LABEL_USED` — każda etykieta zdefiniowana i użyta
- `REF_RETENTION_COMPLETE` — komplet wpisów w `retention_analysis`
- `REF_MARKER_VOCAB` — markery wyłącznie z zamkniętych list
- `REF_NO_SPEAKER_IN_RETENTION` — zakaz `(Sx)` w `retention_analysis`
- `REF_TASK_TYPES` — typy zadania z zamkniętej listy sześciu, bez powtórzeń
- `REF_ASSET_LIMITS` — ≤9 obrazów, ≤3 wideo, ≤3 audio
- `REF_WORD_COUNT` — `detailed_description` 350–500 słów, z paskiem postępu
- `REF_STYLE_BEFORE_SHOT1` — zdanie o stylu przed `[Shot 1]`
- `REF_NO_NEW_LABELS_IN_SUMMARY` — summary nie wprowadza nowych etykiet

**Tryby klatek kluczowych**

- `ANCHOR_REQUIRED` — I2VA/FL2VA/L2VA wymagają wskazanych obrazów
- `FL2VA_PREFER_SINGLE_SHOT` — ostrzeżenie przy więcej niż jednym ujęciu
- `L2VA_ANCHOR_LAST_SHOT` — Picture 1 należy do ostatniego ujęcia

Nagłówek panelu pokazuje stan „gotowy do eksportu" albo liczbę błędów.

## 7. Interfejs

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Projekt ▾   [FL2VA]  8.00s · 24fps · 16:9      ● gotowy   PL/EN   ⚙    │
├───────────────┬─────────────────────────────────────┬───────────────────┤
│ BIN ASSETÓW   │        PROGRAM MONITOR              │  INSPEKTOR        │
│ ETYKIETY      │   kadr ujęcia spod playheada        │  kontekstowy do   │
│ MÓWCY         │   + animowana strzałka ruchu kamery │  zaznaczenia      │
│               │   + pasek dialogu                   │                   │
│               │   + maska bezpieczna proporcji      │                   │
│               ├─────────────────────────────────────┤                   │
│               │ linijka: sekundy i klatki, zoom     │                   │
│               │ SHOTS   [ Shot 1 ][ Shot 2 ][Shot3] │                   │
│               │ KAMERA  [push in ][ static ][arc ]  │                   │
│               │ (S1)      [—dialog——]               │                   │
│               │ (S2)              [——dialog———]     │                   │
│               │ TEKST         ["OTWARTE"]           │                   │
│               │ SFX      [krok][   ][ trzask ]      │                   │
│               │ SOUNDSC. [═════ całe wideo ══════]  │                   │
│               │ MUZYKA   [═════ całe wideo ══════]  │                   │
│               │ REFER.   <Subject 1>■■■□■■   (REF)  │                   │
├───────────────┴─────────────────────────────────────┴───────────────────┤
│  PROMPT (na żywo)  │  WALIDACJA  │  LLM  │  DZIENNIK                     │
└─────────────────────────────────────────────────────────────────────────┘
```

Zachowania, które odróżniają narzędzie od formularza:

- **Klip dialogowy ma realną długość** liczoną z liczby słów i ustawialnego tempa mowy — widać, czy kwestia mieści się w oknie 4–15 s. Przejście klipu przez cięcie proponuje `<scenetrans>` po obu stronach; wystawanie poza koniec proponuje `<cutoff>`.
- **Ruch kamery jest klipem wewnątrz ujęcia**: typ ze słownika, opcjonalna amplituda i prędkość, cel jako tekst.
- **Przeciągnięcie granicy ujęcia** przelicza `At MM:SS.mmm` ze snapowaniem do klatki; złamanie monotoniczności jest niewykonalne, a nie zgłaszane po fakcie.
- **Ścieżka REFERENCJE** (tryb REF) pokazuje występowanie etykiet w ujęciach i zasila `(appears in …)` w `retention_analysis`.
- **Odtwarzanie**: spacja przesuwa playhead w czasie rzeczywistym, monitor przełącza karty ujęć i pokazuje dialogi.
- **Dwukierunkowe zaznaczanie** między panelem promptu a osią czasu.
- **Kotwice klatek** na osi w trybach I2VA/FL2VA/L2VA (znaczniki 0.00 i S.SS).

Skróty: `Spacja` odtwarzanie, `S` podział ujęcia na playheadzie, `←/→` klatka, `Shift+←/→` sekunda, `Ctrl+Z` / `Ctrl+Shift+Z`, `+/−` zoom, `F` dopasuj, `Delete` usuń zaznaczone. Undo/redo obejmuje wszystkie operacje na modelu.

## 8. Integracja LLM

Jedna abstrakcja dostawcy, dwie implementacje mówiące tym samym protokołem OpenAI:

1. **Endpoint OpenAI-compatible** — URL, opcjonalny klucz, lista modeli z `/v1/models`. Działa z LM Studio, llama-server, Ollama, vLLM, lokalnie lub w LAN.
2. **Zarządzany llama-server** — wskazany plik `.gguf`, ustawialne `--n-gpu-layers` i rozmiar kontekstu. Backend startuje proces, sonduje zdrowie, strumieniuje logi do panelu i potrafi go zatrzymać.

Cztery zadania, każde z wymuszonym schematem JSON na wyjściu (`response_format`, walidacja Zodem, jedna próba naprawy przy niezgodności):

| Zadanie | Wejście | Wyjście |
|---|---|---|
| Pomysł → struktura | 2 zdania po polsku, tryb, długość | ujęcia z czasami, ruchami kamery, mówcami, dialogami |
| Redakcja PL→EN | pojedyncze pole | tekst zgodny z konwencją guide'a; treść `<d>` nietknięta |
| Podpowiedź audio | treść ujęć | soundscape (1–4 zdania) i muzyka (1–3 zdania), bez słów o nastroju |
| Krytyk | skompilowany prompt | lista uwag ze wskaźnikiem na obiekt |

Zasady twarde:

- LLM **nigdy** nie pisze tekstu wyjściowego bezpośrednio — zwraca łatkę do modelu domeny, prezentowaną jako diff z akceptacją całościową lub wybiórczą.
- Uwagi krytyka trafiają do **osobnej grupy** w panelu walidacji, oddzielonej od reguł deterministycznych.
- Bez skonfigurowanego modelu aplikacja działa w pełni; panel LLM jest wyszarzony.
- Strumieniowanie z anulowaniem, licznik tokenów i czasu.

## 9. Persystencja i eksport

Projekty jako foldery na dysku:

```
~/mmh3-studio/projects/<nazwa>/
    project.json
    assets/
    exports/
```

Autozapis z debounce, ręczne migawki wersji, `schemaVersion` i migracje przy odczycie.

Eksport:

- tekst promptu — plik `.txt` i schowek
- projekt — `.json`
- pojedyncze sekcje osobno
- **workflow ComfyUI** — użytkownik wgrywa swój workflow JSON raz i wskazuje w UI node oraz pole, które ma otrzymać prompt; mapowanie zapisuje się jako preset, aplikacja generuje gotowy plik do ręcznego wrzucenia do ComfyUI. Bez połączenia sieciowego.

## 10. Stos i struktura

```
~/mmh3-studio/
    shared/    model domeny, kompilator, walidator, słowniki — czysty TypeScript
    src/       frontend
    server/    backend
    docs/      guide'y źródłowe i specyfikacje
```

`shared/` nie zależy od Reacta ani od Node'a i jest importowany przez oba pozostałe pakiety.

- Frontend: React 18, TypeScript, Vite, Zustand z warstwą undo, Tailwind, Radix. Klipy jako DOM/CSS (trafianie myszą, dostępność); linijka i waveformy na canvasie.
- Backend: Fastify, Zod. Miniatury obrazów przez sharp; klatki wideo i waveformy przez ffmpeg, gdy jest dostępny — bez niego placeholdery.
- i18n: własna typowana warstwa słownikowa PL/EN, bez ciężkiej biblioteki.
- Porty: **5173** (UI), **8899** (API). Oba zweryfikowane jako wolne.

## 11. Testy

Kompilator i walidator powstają jako pierwsze, w TDD.

**Testy złote** — najważniejsza weryfikacja zgodności. Cztery przykłady z guide'a bazowego (T2VA, I2VA, FL2VA, L2VA) oraz pełny przykład z guide'a referencyjnego są odtworzone jako projekty i muszą się skompilować **znak w znak** do oryginalnego tekstu z dokumentacji. Przejście tych testów oznacza zgodność kompilatora z dokumentacją, a nie z interpretacją autora.

Dalej:

- test jednostkowy na każdą regułę walidatora: przypadek naruszający i przypadek czysty
- testy operacji na modelu i undo/redo
- testy parsowania odpowiedzi LLM ze schematem, w tym ścieżka naprawy
- smoke Playwrighta: utworzenie projektu, dodanie ujęć, przeciągnięcie cięcia, eksport

## 12. Poza zakresem tej wersji

- generowanie wideo i jakiekolwiek połączenie sieciowe z ComfyUI
- import istniejącego promptu tekstowego z powrotem do modelu (parser odwrotny)
- praca wielu osób i synchronizacja w chmurze
- automatyczne pobieranie modeli LLM
