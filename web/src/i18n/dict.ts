export type Lang = 'pl' | 'en'

const pl = {
  'app.title': 'MMH3 Prompt Studio',
  'app.language': 'Język',

  'projects.title': 'Projekty',
  'projects.new': 'Nowy projekt',
  'projects.name': 'Nazwa projektu',
  'projects.create': 'Utwórz',
  'projects.empty': 'Nie masz jeszcze żadnego projektu.',
  'projects.open': 'Otwórz',
  'projects.delete': 'Usuń',
  'projects.deleteConfirm': 'Usunąć projekt „{name}" bez możliwości cofnięcia?',

  'mode.pick': 'Wybierz tryb generowania',
  'mode.whatYouGive': 'Co dostarczasz',
  'mode.anchor': 'Gdzie model zostaje zakotwiczony',
  'mode.whenToUse': 'Kiedy tego użyć',
  'mode.note': 'Reguła szczególna',

  'editor.prompt': 'Prompt',
  'prompt.copy': 'Kopiuj prompt',
  'prompt.copied': 'Skopiowano',
  'prompt.copyFailed': 'Nie udało się skopiować — zaznacz tekst i użyj Ctrl+C.',
  'editor.validation': 'Walidacja',
  'editor.inspector': 'Inspektor',
  'editor.assets': 'Assety',
  'editor.labels': 'Etykiety',
  'editor.speakers': 'Mówcy',
  'editor.makeLabel': 'Utwórz etykietę',
  'editor.addSpeaker': 'Dodaj mówcę',
  'editor.undo': 'Cofnij',
  'editor.redo': 'Ponów',
  'editor.copy': 'Kopiuj',
  'editor.copied': 'Skopiowano',

  'timeline.ruler': 'Linijka czasu',
  'timeline.title': 'Oś czasu',
  'timeline.zoomIn': 'Przybliż',
  'timeline.zoomOut': 'Oddal',
  'timeline.zoomFit': 'Dopasuj',
  'timeline.play': 'Odtwarzaj',
  'timeline.pause': 'Zatrzymaj',
  'timeline.trackShots': 'Ujęcia',
  'timeline.trackCamera': 'Kamera',
  'timeline.trackDialogue': 'Dialog {speaker}',
  // Pas zastępczy pokazywany WYŁĄCZNIE w projekcie bez żadnego mówcy — patrz
  // komentarz nad `DialogueTracks`. Nie jest to dawny pas „bez mówcy": kwestia
  // bez mówcy nie przechodzi przez `DialogueEventSchema`, więc taki pas nie
  // mógł niczego pomieścić.
  'timeline.trackDialogueEmpty': 'Dialogi — brak mówców',
  // Tytuł CAŁEJ grupy pasów dialogowych w kolumnie nagłówków (zadanie 12) —
  // `timeline.trackDialogue` niesie parametr mówcy i nie nadaje się na
  // wspólny tytuł, gdy pasów jest kilka (jeden na mówcę plus zbiorczy).
  'timeline.trackDialogueAll': 'Dialogi',
  'timeline.trackScreenText': 'Tekst na ekranie',
  'timeline.trackSfx': 'SFX',
  'timeline.trackSoundscape': 'Pejzaż dźwiękowy',
  'timeline.trackMusic': 'Muzyka',
  'timeline.trackReferences': 'Referencje',
  'timeline.clipLabel': 'Ujęcie {number}, od {start} ms do {end} ms',
  'timeline.boundaryHandle': 'Ujęcie {number} — przeciągnij granicę, aby zmienić czas cięcia',
  'timeline.addShot': 'Dodaj ujęcie',
  'timeline.shortcuts': 'Spacja odtwarza, S dzieli ujęcie, Delete usuwa zaznaczone',

  // Zwijanie/rozwijanie pasa w kolumnie nagłówków (zadanie 12).
  'timeline.collapse': 'Zwiń ścieżkę {track}',
  'timeline.expand': 'Rozwiń ścieżkę {track}',
  'timeline.tracks': 'Ścieżki osi czasu',

  // Etykiety przycisków dodawania na ścieżkach (zadanie 14) — treść
  // interfejsu, więc idzie przez słownik normalnie w obu językach.
  'track.addCamera': 'Dodaj ruch kamery na playheadzie',
  'track.addDialogue': 'Dodaj kwestię na playheadzie',
  'track.addScreenText': 'Dodaj tekst na ekranie w tym ujęciu',
  'track.addSfx': 'Dodaj dźwięk na playheadzie',
  // Poniższe trzy klucze to treść MODELU (tekst nowo utworzonych obiektów),
  // nie interfejsu — prompt idzie do modelu po angielsku niezależnie od
  // języka aplikacji. Mimo to trzymamy je w słowniku (a nie jako gołe stringi
  // w `createOnTrack.ts`), żeby treść placeholdera miała jedno źródło prawdy;
  // kod, który z nich korzysta, zawsze czyta wersję angielską (`DICT.en`),
  // nigdy `useT()` — patrz komentarz przy użyciu w `createOnTrack.ts`.
  'track.newDialogue': 'nowa kwestia',
  'track.newScreenText': 'TEKST',
  'track.newSfx': 'nowy dźwięk',

  'camera.clipLabel': 'Ruch kamery {type} nr {position} w ujęciu {shot}',
  'camera.dragStart': 'Przesuń początek ruchu {type}',
  'camera.dragEnd': 'Przesuń koniec ruchu {type}',

  'dialogue.clipLabel': 'Kwestia {speaker} nr {position} w ujęciu {shot}: {text}',
  'dialogue.dragStart': 'Przesuń początek kwestii {speaker}',
  'dialogue.dragEnd': 'Przesuń koniec kwestii {speaker}',
  'dialogue.tooShort': 'Kwestia nie mieści się w klipie: potrzeba {needed} s, jest {actual} s',

  // Numer pozycji w obrębie własnego ujęcia, tak jak przy kamerze i dialogu —
  // dwa teksty na ekranie albo dwa dźwięki o identycznej treści w tym samym
  // ujęciu inaczej dostałyby tę samą nazwę dostępną.
  'screenText.clipLabel': 'Tekst na ekranie w ujęciu {shot} nr {position}: {text}',

  'sfx.clipLabel': 'Dźwięk: {description} (nr {position} w ujęciu {shot})',
  'sfx.dragStart': 'Przesuń początek dźwięku {description}',
  'sfx.dragEnd': 'Przesuń koniec dźwięku {description}',

  // {text} niesie treść opisu (albo `audio.empty`, gdy pusty) — tak samo jak
  // `text`/`description` w etykietach innych ścieżek: czytnik ekranu ma
  // usłyszeć to samo, co widzi osoba widząca na klipie.
  'audio.soundscapeClip': 'Pejzaż dźwiękowy całego wideo: {text}',
  'audio.musicClip': 'Muzyka całego wideo: {text}',
  'audio.empty': 'nie opisano',

  'references.cell': 'Etykieta {label} w ujęciu {shot}',
  'references.rowLabel': 'Występowanie etykiety {label}',

  'proposal.scenetrans': 'Kwestia przechodzi przez cięcie — dodaj <scenetrans>',
  'proposal.cutoff': 'Kwestia wystaje poza koniec materiału — oznacz <cutoff>',

  'monitor.title': 'Monitor',
  'monitor.empty': 'Playhead nie stoi nad żadnym ujęciem.',
  'monitor.shot': 'Ujęcie {number}',

  'anchor.picture-first': 'Pierwsza klatka',
  'anchor.picture-last': 'Ostatnia klatka',
  'anchor.keyframe': 'Klatka kluczowa',
  'anchor.toggle': 'Przełącz kotwicę: {name} — ujęcie {number}',
  'anchor.stale': 'Kotwica spoza trybu: {name} — ujęcie {number}, kliknij, aby zdjąć',

  'validation.ready': 'Gotowy do eksportu',
  'validation.count': 'Problemy: {count}',
  'validation.none': 'Walidator nie zgłasza uwag.',
  'validation.error': 'Błąd',
  'validation.warning': 'Ostrzeżenie',
  'validation.hint': 'Wskazówka',
  'validation.source': 'Źródło',
  // Nagłówek grupy uwag krytyka (zadanie 12) — treść MUSI mówić, że uwagi
  // pochodzą z modelu językowego, nie z reguł: to jest cały sens oddzielenia
  // (brief).
  'validation.criticTitle': 'Uwagi modelu językowego',
  'validation.criticSource': 'Źródło: model językowy',
  'validation.criticStale': 'Nieaktualna — projekt zmienił się od tej uwagi',

  'shot.number': 'Ujęcie {number}',
  'shot.startMs': 'Czas cięcia',
  'shot.composition': 'Kompozycja',
  'shot.cutPhrase': 'Fraza cięcia',
  'shot.cutType': 'Rodzaj przejścia',
  'shot.anchors': 'Kotwice klatek',

  'project.style': 'Styl wizualny',
  'project.duration': 'Długość wideo',
  'project.aspect': 'Proporcje',
  'project.soundscape': 'Tło dźwiękowe',
  'project.music': 'Muzyka niediegetyczna',

  'export.title': 'Eksport',
  'export.prompt': 'Prompt (.txt)',
  'export.project': 'Projekt (.json)',
  'export.comfy': 'Workflow ComfyUI',
  'export.comfyNode': 'Identyfikator węzła',
  'export.comfyField': 'Pole węzła',
  'export.comfyUpload': 'Wgraj workflow',
  'export.blocked': 'Eksport zablokowany — walidator zgłasza błędy.',
  'export.unsaved': 'Poczekaj na zapis — eksport czyta stan z dysku.',
  'export.invalidJson': 'Plik nie jest poprawnym JSON-em',
  'export.serverError': 'Serwer odpowiedział kodem {status}',

  'common.cancel': 'Anuluj',
  'common.save': 'Zapisz',
  'common.close': 'Zamknij',
  'common.loading': 'Wczytywanie…',
  'common.error': 'Coś poszło nie tak: {message}',

  // Hak `useLlmRun` (zadanie 9) — komunikaty, których serwer nie dostarcza
  // gotowych po polsku, bo do niego w ogóle nie dotarliśmy (sieć) albo
  // odpowiedział bez treści JSON do odczytania (błąd HTTP bez ciała `error`).
  'llm.networkError': 'Nie udało się połączyć z serwerem.',
  'llm.httpError': 'Serwer odpowiedział kodem {status}.',
  'llm.unknownError': 'Błąd modelu.',
  // Round 1 recenzji zadania 9: kawałek strumienia, którego nie da się
  // rozebrać jako JSON — połączenie samo w sobie działa, więc komunikat
  // sieciowy byłby mylący.
  'llm.streamError': 'Błąd podczas odczytu odpowiedzi strumienia.',

  // Panel LLM (zadanie 10) — konfiguracja dostawcy i pięć przycisków zadań.
  'llm.title': 'Model językowy',
  'llm.settingsTitle': 'Ustawienia dostawcy',
  'llm.modeOff': 'Wyłączony',
  'llm.modeEndpoint': 'Endpoint',
  'llm.modeManaged': 'Zarządzany serwer',
  'llm.notConfigured': 'Model nie jest skonfigurowany',
  'llm.notConfiguredHint': 'Ustaw tryb dostawcy poniżej i zapisz ustawienia, aby włączyć zadania modelu.',
  'llm.endpointBaseUrl': 'Adres endpointu',
  'llm.endpointApiKey': 'Klucz API',
  // Pusty ciąg w PUT znaczy „nie zmieniaj" (trasa nigdy nie odda klucza z
  // powrotem — odczyt go redaguje), więc pole zawsze startuje puste, nawet
  // gdy klucz jest zapisany na serwerze.
  'llm.endpointApiKeyHint': 'Puste pole zostawia zapisany klucz bez zmian.',
  // Fix round 1/5, punkt 1: `null` w PUT czyści klucz (zadanie 1), ale bez
  // tego przycisku nic w panelu nigdy nie wysyłało `null` — tylko pusty ciąg
  // (co znaczy „zostaw bez zmian") albo nowy klucz. Bez jawnej akcji „wyczyść"
  // ta gałąź API była nieosiągalna z jedynego miejsca, gdzie ktoś jej realnie
  // potrzebuje: cofnięcie klucza wklejonego wcześniej na współdzieloną maszynę.
  'llm.clearKey': 'Wyczyść klucz',
  'llm.keyCleared': 'Klucz wyczyszczony.',
  'llm.endpointModel': 'Identyfikator modelu',
  'llm.managedBinary': 'Ścieżka binarki serwera',
  'llm.managedModelPath': 'Ścieżka pliku modelu (.gguf)',
  'llm.managedGpuLayers': 'Warstwy GPU',
  'llm.managedContextSize': 'Rozmiar kontekstu',
  'llm.managedStart': 'Uruchom serwer',
  'llm.managedStop': 'Zatrzymaj serwer',
  'llm.managedStatus': 'Stan serwera',
  'llm.managedStateStopped': 'Zatrzymany',
  'llm.managedStateStarting': 'Uruchamianie…',
  'llm.managedStateReady': 'Gotowy',
  'llm.managedStateFailed': 'Nie udało się uruchomić',
  'llm.managedStateError': 'Nie udało się pobrać stanu serwera: {message}',
  'llm.saveSettings': 'Zapisz ustawienia',
  'llm.saveError': 'Nie udało się zapisać ustawień: {message}',
  'llm.loadError': 'Nie udało się wczytać ustawień dostawcy: {message}',
  'llm.tasksTitle': 'Zadania',
  'llm.taskStructure': 'Struktura z pomysłu',
  'llm.taskAudio': 'Podpowiedź audio',
  'llm.taskCritic': 'Krytyk',
  'llm.taskTranslateAll': 'Tłumaczenie całego projektu',
  'llm.ideaA': 'Pomysł — zdanie pierwsze',
  'llm.ideaB': 'Pomysł — zdanie drugie',
  'llm.redactTarget': 'Cel redakcji',
  'llm.chatOpen': 'Rozmawiaj o tym polu',
  'llm.structureNeedsIdea': 'Wypełnij oba zdania pomysłu, żeby uruchomić to zadanie.',
  'llm.chatTitle': 'Rozmowa o polu',
  'llm.chatMessage': 'Twoje polecenie',
  'llm.chatSend': 'Wyślij',
  'llm.chatClear': 'Wyczyść rozmowę',
  'llm.chatClose': 'Zamknij',
  'llm.chatEmpty': 'Napisz, co zmienić w tym polu — na przykład „dodaj deszcz i zimne światło".',
  'llm.chatYou': 'Ty',
  'llm.chatModel': 'Model',
  'llm.chatNoChange': 'Ta odpowiedź niczego nie zmienia w polu.',
  'llm.redactStyle': 'Styl wizualny',
  'llm.redactSoundscape': 'Tło dźwiękowe',
  'llm.redactMusic': 'Muzyka niediegetyczna',
  'llm.redactSpeakerFull': '{code} — opis pełny',
  'llm.redactSpeakerShort': '{code} — opis krótki',
  'llm.tokens': 'Tokeny',
  'llm.time': 'Czas',
  'llm.status': 'Stan',
  'llm.statusIdle': 'Bezczynny',
  'llm.statusRunning': 'W toku…',
  'llm.statusDone': 'Gotowe',
  'llm.statusError': 'Błąd',
  'llm.statusCancelled': 'Anulowano',
  'llm.retrying': 'Model jest pytany ponownie…',
  'llm.opsReady': 'Gotowe — {count} operacji do przeglądu',
  'llm.streamPreview': 'Podgląd strumienia',
  'llm.noProject': 'Brak wczytanego projektu',

  // Zwolnienie modelu z pamięci karty (zadanie 14) — sposób zależy od
  // dostawcy i żaden nie jest uniwersalny, więc każda możliwość ma własny,
  // konkretny opis zamiast jednego ogólnego zdania dla wszystkich.
  'llm.unload': 'Zwolnij pamięć karty',
  'llm.unloadManaged': 'Zatrzymuje serwer modelu i zwalnia całą pamięć karty',
  'llm.unloadOllama': 'Prosi Ollamę o wyładowanie modelu z pamięci karty',
  'llm.unloadLmStudio': 'Prosi LM Studio o wyładowanie modelu z pamięci karty',
  'llm.unloadUnsupported': 'Ten dostawca nie umie zwolnić pamięci na żądanie — zatrzymaj go po swojej stronie',
  'llm.unloadDone': 'Pamięć karty zwolniona',
  'llm.unloadFailed': 'Nie udało się zwolnić pamięci: {reason}',

  // Przegląd łatki z wybiórczym przyjmowaniem operacji (zadanie 11).
  'patchReview.title': 'Przegląd łatki',
  'patchReview.empty': 'Łatka nie zawiera żadnych operacji.',
  // Fix round 1/5, punkt 2: lista może się wyczerpać przed pełnym zakresem
  // `patch.ops` (każde zatwierdzenie usuwa rozpatrzone operacje) — osobny
  // komunikat od `patchReview.empty`, bo tu łatka MIAŁA operacje, tylko już
  // wszystkie przeszły przez decyzję użytkownika.
  'patchReview.allReviewed': 'Wszystkie operacje zostały już rozpatrzone.',
  'patchReview.before': 'Przed',
  'patchReview.after': 'Po',
  'patchReview.confirm': 'Zatwierdź',
  // Trzy warianty liczby mnogiej (1 / 2–4 poza 12–14 / reszta) — wybierane
  // przez `pluralCategory` w `PatchReview.tsx`, fix round 1/5, punkt 7:
  // jeden szablon dawał gramatycznie złe „1 operacji"/„2 operacji".
  'patchReview.appliedOne': 'Zastosowano {count} operację.',
  'patchReview.appliedFew': 'Zastosowano {count} operacje.',
  'patchReview.appliedMany': 'Zastosowano {count} operacji.',
  // Placeholder pustej wartości — `describeOp` (shared/) zwraca dla niej
  // wariant `{ kind: 'empty' }`, nie gotowy string, żeby to WŁAŚNIE ten
  // ekran decydował o języku (fix round 1/5, punkt 5).
  'patchReview.notDescribed': '(nieopisane)',
  'patchReview.shotCount': 'liczba ujęć: {count}',
  // Fix round 1/5, punkt 6: podsumowanie `replaceShots` po IDENTYFIKATORZE
  // ujęcia, nie po pozycji — mówi wprost, ile ujęć zostanie dodanych,
  // usuniętych i zmienionych, zamiast samej arytmetyki liczby ujęć.
  'patchReview.shotSummary': 'dodane: {added}, usunięte: {removed}, zmienione: {altered}',
  // Powody, dla których operacja się nie zastosuje (`InapplicableReason` w
  // `shared/src/patch/describe.ts`) — każdy z własnym kluczem zamiast
  // gotowego zdania po polsku zaszytego w `shared/` (fix round 1/5, punkt 5).
  'patchReview.reasonMissingShot': 'Operacja się nie zastosuje — nie ma ujęcia o tym identyfikatorze.',
  'patchReview.reasonMissingSegment': 'Operacja się nie zastosuje — ujęcie nie ma segmentu pod tym indeksem.',
  'patchReview.reasonWrongSegmentKind': 'Operacja się nie zastosuje — wskazany segment jest typu „{kind}", nie tekstem.',
  'patchReview.reasonMissingSpeaker': 'Operacja się nie zastosuje — nie ma mówcy o tym identyfikatorze.',
  'patchReview.reasonMissingLabel': 'Operacja się nie zastosuje — nie ma etykiety o tym identyfikatorze.',
  'patchReview.reasonMissingRetentionEntry': 'Operacja się nie zastosuje — nie ma wpisu retencji o tym identyfikatorze.',
} as const

export type TKey = keyof typeof pl

const en: Record<TKey, string> = {
  'app.title': 'MMH3 Prompt Studio',
  'app.language': 'Language',

  'projects.title': 'Projects',
  'projects.new': 'New project',
  'projects.name': 'Project name',
  'projects.create': 'Create',
  'projects.empty': 'You have no projects yet.',
  'projects.open': 'Open',
  'projects.delete': 'Delete',
  'projects.deleteConfirm': 'Delete project "{name}" permanently?',

  'mode.pick': 'Choose a generation mode',
  'mode.whatYouGive': 'What you supply',
  'mode.anchor': 'Where the model is anchored',
  'mode.whenToUse': 'When to use it',
  'mode.note': 'Special rule',

  'editor.prompt': 'Prompt',
  'prompt.copy': 'Copy prompt',
  'prompt.copied': 'Copied',
  'prompt.copyFailed': 'Copy failed — select the text and press Ctrl+C.',
  'editor.validation': 'Validation',
  'editor.inspector': 'Inspector',
  'editor.assets': 'Assets',
  'editor.labels': 'Labels',
  'editor.speakers': 'Speakers',
  'editor.makeLabel': 'Create label',
  'editor.addSpeaker': 'Add speaker',
  'editor.undo': 'Undo',
  'editor.redo': 'Redo',
  'editor.copy': 'Copy',
  'editor.copied': 'Copied',

  'timeline.ruler': 'Time ruler',
  'timeline.title': 'Timeline',
  'timeline.zoomIn': 'Zoom in',
  'timeline.zoomOut': 'Zoom out',
  'timeline.zoomFit': 'Fit',
  'timeline.play': 'Play',
  'timeline.pause': 'Pause',
  'timeline.trackShots': 'Shots',
  'timeline.trackCamera': 'Camera',
  'timeline.trackDialogue': 'Dialogue {speaker}',
  'timeline.trackDialogueEmpty': 'Dialogue — no speakers',
  'timeline.trackDialogueAll': 'Dialogue',
  'timeline.trackScreenText': 'On-screen text',
  'timeline.trackSfx': 'SFX',
  'timeline.trackSoundscape': 'Soundscape',
  'timeline.trackMusic': 'Music',
  'timeline.trackReferences': 'References',
  'timeline.clipLabel': 'Shot {number}, from {start} ms to {end} ms',
  'timeline.boundaryHandle': 'Shot {number} — drag the boundary to change the cut time',
  'timeline.addShot': 'Add shot',
  'timeline.shortcuts': 'Space plays, S splits a shot, Delete removes the selection',

  'timeline.collapse': 'Collapse track {track}',
  'timeline.expand': 'Expand track {track}',
  'timeline.tracks': 'Timeline tracks',

  'track.addCamera': 'Add camera move at the playhead',
  'track.addDialogue': 'Add line at the playhead',
  'track.addScreenText': 'Add on-screen text in this shot',
  'track.addSfx': 'Add sound at the playhead',
  'track.newDialogue': 'new line',
  'track.newScreenText': 'TEXT',
  'track.newSfx': 'new sound',

  'camera.clipLabel': 'Camera move {type} #{position} in shot {shot}',
  'camera.dragStart': 'Move start of {type}',
  'camera.dragEnd': 'Move end of {type}',

  'dialogue.clipLabel': 'Line by {speaker} #{position} in shot {shot}: {text}',
  'dialogue.dragStart': 'Move start of line by {speaker}',
  'dialogue.dragEnd': 'Move end of line by {speaker}',
  'dialogue.tooShort': 'Line does not fit the clip: needs {needed} s, has {actual} s',

  'screenText.clipLabel': 'On-screen text in shot {shot} #{position}: {text}',

  'sfx.clipLabel': 'Sound: {description} (#{position} in shot {shot})',
  'sfx.dragStart': 'Move start of sound {description}',
  'sfx.dragEnd': 'Move end of sound {description}',

  'audio.soundscapeClip': 'Soundscape of the whole video: {text}',
  'audio.musicClip': 'Music of the whole video: {text}',
  'audio.empty': 'not described',

  'references.cell': 'Label {label} in shot {shot}',
  'references.rowLabel': 'Occurrences of label {label}',

  'proposal.scenetrans': 'Line crosses a cut — add <scenetrans>',
  'proposal.cutoff': 'Line runs past the end of the material — mark <cutoff>',

  'monitor.title': 'Monitor',
  'monitor.empty': 'The playhead is not over any shot.',
  'monitor.shot': 'Shot {number}',

  'anchor.picture-first': 'First frame',
  'anchor.picture-last': 'Last frame',
  'anchor.keyframe': 'Keyframe',
  'anchor.toggle': 'Toggle anchor: {name} — shot {number}',
  'anchor.stale': 'Anchor outside this mode: {name} — shot {number}, click to remove',

  'validation.ready': 'Ready to export',
  'validation.count': 'Issues: {count}',
  'validation.none': 'The validator has nothing to report.',
  'validation.error': 'Error',
  'validation.warning': 'Warning',
  'validation.hint': 'Hint',
  'validation.source': 'Source',
  'validation.criticTitle': 'Language-model notes',
  'validation.criticSource': 'Source: language model',
  'validation.criticStale': 'Stale — the project has changed since this note',

  'shot.number': 'Shot {number}',
  'shot.startMs': 'Cut time',
  'shot.composition': 'Composition',
  'shot.cutPhrase': 'Cut phrase',
  'shot.cutType': 'Transition type',
  'shot.anchors': 'Frame anchors',

  'project.style': 'Visual style',
  'project.duration': 'Video duration',
  'project.aspect': 'Aspect ratio',
  'project.soundscape': 'Overall soundscape',
  'project.music': 'Non-diegetic music',

  'export.title': 'Export',
  'export.prompt': 'Prompt (.txt)',
  'export.project': 'Project (.json)',
  'export.comfy': 'ComfyUI workflow',
  'export.comfyNode': 'Node id',
  'export.comfyField': 'Node field',
  'export.comfyUpload': 'Upload workflow',
  'export.blocked': 'Export blocked — the validator reports errors.',
  'export.unsaved': 'Waiting for the save — export reads from disk.',
  'export.invalidJson': 'The file is not valid JSON',
  'export.serverError': 'The server responded with status {status}',

  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.close': 'Close',
  'common.loading': 'Loading…',
  'common.error': 'Something went wrong: {message}',

  'llm.networkError': 'Could not connect to the server.',
  'llm.httpError': 'The server responded with status {status}.',
  'llm.unknownError': 'Model error.',
  'llm.streamError': 'Error while reading the streamed response.',

  'llm.title': 'Language model',
  'llm.settingsTitle': 'Provider settings',
  'llm.modeOff': 'Off',
  'llm.modeEndpoint': 'Endpoint',
  'llm.modeManaged': 'Managed server',
  'llm.notConfigured': 'Model is not configured',
  'llm.notConfiguredHint': 'Set a provider mode below and save settings to enable model tasks.',
  'llm.endpointBaseUrl': 'Endpoint address',
  'llm.endpointApiKey': 'API key',
  'llm.endpointApiKeyHint': 'An empty field leaves the saved key unchanged.',
  'llm.clearKey': 'Clear key',
  'llm.keyCleared': 'Key cleared.',
  'llm.endpointModel': 'Model id',
  'llm.managedBinary': 'Server binary path',
  'llm.managedModelPath': 'Model file path (.gguf)',
  'llm.managedGpuLayers': 'GPU layers',
  'llm.managedContextSize': 'Context size',
  'llm.managedStart': 'Start server',
  'llm.managedStop': 'Stop server',
  'llm.managedStatus': 'Server status',
  'llm.managedStateStopped': 'Stopped',
  'llm.managedStateStarting': 'Starting…',
  'llm.managedStateReady': 'Ready',
  'llm.managedStateFailed': 'Failed to start',
  'llm.managedStateError': 'Could not fetch server status: {message}',
  'llm.saveSettings': 'Save settings',
  'llm.saveError': 'Could not save settings: {message}',
  'llm.loadError': 'Could not load provider settings: {message}',
  'llm.tasksTitle': 'Tasks',
  'llm.taskStructure': 'Structure from idea',
  'llm.taskAudio': 'Audio suggestion',
  'llm.taskCritic': 'Critic',
  'llm.taskTranslateAll': 'Translate whole project',
  'llm.ideaA': 'Idea — first sentence',
  'llm.ideaB': 'Idea — second sentence',
  'llm.redactTarget': 'Redaction target',
  'llm.chatOpen': 'Discuss this field',
  'llm.structureNeedsIdea': 'Fill in both idea sentences to enable this task.',
  'llm.chatTitle': 'Field conversation',
  'llm.chatMessage': 'Your instruction',
  'llm.chatSend': 'Send',
  'llm.chatClear': 'Clear conversation',
  'llm.chatClose': 'Close',
  'llm.chatEmpty': 'Say what to change in this field — for example "add rain and cold light".',
  'llm.chatYou': 'You',
  'llm.chatModel': 'Model',
  'llm.chatNoChange': 'This answer changes nothing in the field.',
  'llm.redactStyle': 'Visual style',
  'llm.redactSoundscape': 'Soundscape',
  'llm.redactMusic': 'Non-diegetic music',
  'llm.redactSpeakerFull': '{code} — full descriptor',
  'llm.redactSpeakerShort': '{code} — short descriptor',
  'llm.tokens': 'Tokens',
  'llm.time': 'Time',
  'llm.status': 'Status',
  'llm.statusIdle': 'Idle',
  'llm.statusRunning': 'Running…',
  'llm.statusDone': 'Done',
  'llm.statusError': 'Error',
  'llm.statusCancelled': 'Cancelled',
  'llm.retrying': 'Asking the model again…',
  'llm.opsReady': 'Done — {count} operations ready for review',
  'llm.streamPreview': 'Stream preview',
  'llm.noProject': 'No project loaded',

  'llm.unload': 'Free GPU memory',
  'llm.unloadManaged': 'Stops the model server and frees all GPU memory',
  'llm.unloadOllama': 'Asks Ollama to unload the model from GPU memory',
  'llm.unloadLmStudio': 'Asks LM Studio to unload the model from GPU memory',
  'llm.unloadUnsupported': 'This provider cannot free memory on request — stop it on your side',
  'llm.unloadDone': 'GPU memory freed',
  'llm.unloadFailed': 'Could not free memory: {reason}',

  'patchReview.title': 'Patch review',
  'patchReview.empty': 'The patch has no operations.',
  'patchReview.allReviewed': 'All operations have already been reviewed.',
  'patchReview.before': 'Before',
  'patchReview.after': 'After',
  'patchReview.confirm': 'Confirm',
  'patchReview.appliedOne': '{count} operation applied.',
  'patchReview.appliedFew': '{count} operations applied.',
  'patchReview.appliedMany': '{count} operations applied.',
  'patchReview.notDescribed': '(not described)',
  'patchReview.shotCount': 'shot count: {count}',
  'patchReview.shotSummary': 'added: {added}, removed: {removed}, altered: {altered}',
  'patchReview.reasonMissingShot': "This operation won't apply — there is no shot with this id.",
  'patchReview.reasonMissingSegment': "This operation won't apply — the shot has no segment at this index.",
  'patchReview.reasonWrongSegmentKind': 'This operation won\'t apply — the targeted segment is of type "{kind}", not text.',
  'patchReview.reasonMissingSpeaker': "This operation won't apply — there is no speaker with this id.",
  'patchReview.reasonMissingLabel': "This operation won't apply — there is no label with this id.",
  'patchReview.reasonMissingRetentionEntry': "This operation won't apply — there is no retention entry with this id.",
}

export const DICT: Record<Lang, Record<TKey, string>> = { pl, en }
