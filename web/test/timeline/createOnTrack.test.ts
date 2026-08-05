import { describe, expect, it } from 'vitest'
import { buildPrompt, MS_PER_FRAME, type Project } from '@mmh3/shared'
import {
  addCameraMove, addDialogue, addScreenText, addSfx, removeSelected,
} from '../../src/timeline/createOnTrack.js'
import { baseProject, emptyShot, line, speaker } from './fixtures.js'

const twoShots = () => baseProject([emptyShot('a', 0, 0), emptyShot('b', 1, 4000)])

/** Same identyfikatory reguł, których diagnostyka nie wolno nowej zapalić. */
const diagnosticIds = (project: Project): string[] => buildPrompt(project).diagnostics.map(d => d.ruleId)

describe('addCameraMove', () => {
  it('wkłada ruch do ujęcia, na które wskazuje playhead', () => {
    const next = addCameraMove(twoShots(), 5000)
    expect(next.shots.find(s => s.id === 'a')?.cameraMoves).toHaveLength(0)
    expect(next.shots.find(s => s.id === 'b')?.cameraMoves).toHaveLength(1)
  })

  it('nowy ruch mieści się w swoim ujęciu', () => {
    const next = addCameraMove(twoShots(), 5000)
    const move = next.shots.find(s => s.id === 'b')?.cameraMoves[0]
    expect(move?.startMs).toBeGreaterThanOrEqual(4000)
    expect(move?.endMs).toBeLessThanOrEqual(8000)
  })

  it('nowy ruch leży na siatce klatek', () => {
    const move = addCameraMove(twoShots(), 5010).shots.find(s => s.id === 'b')?.cameraMoves[0]
    for (const ms of [move?.startMs ?? 0, move?.endMs ?? 0]) {
      expect(ms).toBe(Math.round(Math.round(ms / MS_PER_FRAME) * MS_PER_FRAME))
    }
  })

  it('dwa ruchy dodane w tym samym miejscu mają różne identyfikatory', () => {
    const once = addCameraMove(twoShots(), 5000)
    const twice = addCameraMove(once, 5000)
    const ids = twice.shots.flatMap(s => s.cameraMoves).map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('playhead poza jakimkolwiek ujęciem zwraca ten sam obiekt', () => {
    const project = { ...twoShots(), shots: [] }
    expect(addCameraMove(project, 5000)).toBe(project)
  })

  /**
   * `renderShot` (shared/src/compile/renderShot.ts) czyta `shot.body`, nie
   * `shot.cameraMoves` — a `BODY_REFS_COMPLETE` (shared/src/validate/rules/camera.ts)
   * wymaga, żeby każdy ruch był przywołany w `body` dokładnie raz. Dopisanie
   * samego obiektu do tablicy bez segmentu w `body` zapaliłoby ten błąd na
   * projekcie, który go wcześniej nie miał — dokładnie to, czego zabrania
   * globalne ograniczenie tego zadania.
   */
  it('nowy ruch trafia też do body, żeby kompilator go zobaczył i walidator się nie zapalił', () => {
    const next = addCameraMove(twoShots(), 5000)
    const shotB = next.shots.find(s => s.id === 'b')
    const moveId = shotB?.cameraMoves[0]?.id ?? ''
    expect(shotB?.body).toContainEqual({ kind: 'camera', moveId })
    expect(diagnosticIds(next)).not.toContain('BODY_REFS_COMPLETE')
  })
})

describe('addDialogue', () => {
  it('przypisuje kwestię wskazanemu mówcy', () => {
    // `s1` musi istnieć w `project.speakers` od rundy 1 recenzji (patrz
    // `addDialogue`'s guard) — `twoShots()` sam z siebie nie ma mówców.
    const project = { ...twoShots(), speakers: [speaker('s1', 'S1')] }
    const next = addDialogue(project, 1000, 's1')
    expect(next.shots.flatMap(s => s.dialogue)[0]?.speakerIds).toEqual(['s1'])
  })

  it('bez mówcy tworzy kwestię bez przypisania', () => {
    const next = addDialogue(twoShots(), 1000, null)
    expect(next.shots.flatMap(s => s.dialogue)[0]?.speakerIds).toEqual([])
  })

  it('treść nowej kwestii jest po angielsku, bo idzie do promptu', () => {
    const next = addDialogue(twoShots(), 1000, null)
    expect(next.shots.flatMap(s => s.dialogue)[0]?.text).toBe('new line')
  })

  /** Ten sam powód co przy ruchu kamery, dla `dialogue`/`SPEECH_FITS`/etc. */
  it('nowa kwestia trafia też do body i nie zapala BODY_REFS_COMPLETE', () => {
    const next = addDialogue(twoShots(), 1000, null)
    const shotA = next.shots.find(s => s.id === 'a')
    const lineId = shotA?.dialogue[0]?.id ?? ''
    expect(shotA?.body).toContainEqual({ kind: 'dialogue', eventId: lineId })
    expect(diagnosticIds(next)).not.toContain('BODY_REFS_COMPLETE')
  })

  /**
   * Runda 1 recenzji: `speakerId` spoza `project.speakers` musi wracać
   * projekt bez zmian, nie zapisywać kwestię, którą `renderSpeakerSegment`
   * (shared/src/compile/renderSpeaker.ts) i tak odrzuci wyjątkiem przy
   * pierwszej kompilacji (`.find(...)` nie trafi, funkcja rzuca jawnie).
   * Referencyjna równość (`toBe`), jak przy innych odmowach w tym pliku
   * (`spanAt` poza ujęciem) — żaden fragment projektu się nie zmienił.
   */
  it('nieznany speakerId (spoza project.speakers) zwraca ten sam obiekt', () => {
    const project = twoShots()
    expect(addDialogue(project, 1000, 'kto-to')).toBe(project)
  })
})

describe('addScreenText i addSfx', () => {
  it('tekst trafia do ujęcia spod playheada', () => {
    const next = addScreenText(twoShots(), 5000)
    expect(next.shots.find(s => s.id === 'b')?.screenText).toHaveLength(1)
  })

  /**
   * `screenText` ma własny rodzaj segmentu (`Segment` w shared/src/model/types.ts)
   * i `renderShot` go czyta tak samo jak ruch kamery czy kwestię — bez wpisu w
   * `body` nowy tekst byłby stworzony, ale nigdy nie trafiłby do promptu.
   * Żadna reguła walidatora tego akurat nie pilnuje (nie ma odpowiednika
   * `BODY_REFS_COMPLETE` dla tekstu ekranowego), więc to nie diagnostyka, tylko
   * martwa funkcja — ale to właśnie „niewidoczne dla kompilatora", przed czym
   * ostrzega brief zadania.
   */
  it('nowy tekst trafia też do body ujęcia', () => {
    const next = addScreenText(twoShots(), 5000)
    const shotB = next.shots.find(s => s.id === 'b')
    const textId = shotB?.screenText[0]?.id ?? ''
    expect(shotB?.body).toContainEqual({ kind: 'screenText', id: textId })
  })

  it('dźwięk dostaje czasy zaczynające się na playheadzie', () => {
    const sound = addSfx(twoShots(), 5000).shots.flatMap(s => s.diegeticSfx)[0]
    expect(sound?.startMs).toBe(5000)
    expect(sound?.endMs).toBeGreaterThan(5000)
  })

  it('dźwięk przy samym końcu materiału nie wychodzi poza niego', () => {
    const sound = addSfx(twoShots(), 7990).shots.flatMap(s => s.diegeticSfx)[0]
    expect(sound?.endMs).toBeLessThanOrEqual(8000)
  })

  /**
   * `diegeticSfx` nie ma odpowiednika w `Segment` (sprawdzone w
   * shared/src/model/types.ts) — żaden segment `body` go nie przywołuje, więc
   * w przeciwieństwie do kamery/kwestii/tekstu na ekranie nie ma czego dopiąć.
   * Test pilnuje tego faktu: dodanie dźwięku nie rusza `body` w ogóle.
   */
  it('dźwięk nie rusza body ujęcia — nie ma dla niego rodzaju segmentu', () => {
    const before = twoShots()
    const next = addSfx(before, 5000)
    expect(next.shots.find(s => s.id === 'b')?.body).toEqual(before.shots.find(s => s.id === 'b')?.body)
  })
})

describe('removeSelected', () => {
  it('usuwa ruch kamery po referencji', () => {
    const withMove = addCameraMove(twoShots(), 5000)
    const moveId = withMove.shots.flatMap(s => s.cameraMoves)[0]?.id ?? ''
    const next = removeSelected(withMove, [{ kind: 'camera', id: moveId }])
    expect(next.shots.flatMap(s => s.cameraMoves)).toHaveLength(0)
  })

  it('usuwa kilka obiektów różnych rodzajów naraz', () => {
    const withBoth = addSfx(addCameraMove(twoShots(), 5000), 1000)
    const moveId = withBoth.shots.flatMap(s => s.cameraMoves)[0]?.id ?? ''
    const soundId = withBoth.shots.flatMap(s => s.diegeticSfx)[0]?.id ?? ''
    const next = removeSelected(withBoth, [
      { kind: 'camera', id: moveId }, { kind: 'sfx', id: soundId },
    ])
    expect(next.shots.flatMap(s => s.cameraMoves)).toHaveLength(0)
    expect(next.shots.flatMap(s => s.diegeticSfx)).toHaveLength(0)
  })

  it('puste zaznaczenie zwraca ten sam obiekt', () => {
    const project = twoShots()
    expect(removeSelected(project, [])).toBe(project)
  })

  it('zaznaczenie samych ujęć zostawia je nietknięte, bo od tego jest osobna operacja', () => {
    const project = twoShots()
    expect(removeSelected(project, [{ kind: 'shot', id: 'a' }])).toBe(project)
  })

  /**
   * Symetria do dodawania: skoro `addCameraMove` dopina segment w `body`,
   * usunięcie musi go sprzątnąć. Bez tego `renderShot` rzuciłby wyjątkiem na
   * segmencie wskazującym nieistniejący ruch (`if (!move) throw` w
   * `shared/src/compile/renderShot.ts`) — `buildPrompt` łapie taki wyjątek i
   * zamienia go w diagnostykę `COMPILE_FAILED`, więc samo kliknięcie Delete
   * zapaliłoby walidator na projekcie, który przed tym był czysty.
   */
  it('usunięcie ruchu kamery sprząta po sobie segment w body', () => {
    const withMove = addCameraMove(twoShots(), 5000)
    const moveId = withMove.shots.flatMap(s => s.cameraMoves)[0]?.id ?? ''
    const next = removeSelected(withMove, [{ kind: 'camera', id: moveId }])
    const shotB = next.shots.find(s => s.id === 'b')
    expect(shotB?.body.some(seg => seg.kind === 'camera')).toBe(false)
    expect(diagnosticIds(next)).not.toContain('COMPILE_FAILED')
  })

  it('usunięcie kwestii i tekstu na ekranie też sprząta swoje segmenty w body', () => {
    const withDialogue = addDialogue(twoShots(), 1000, null)
    const lineId = withDialogue.shots.flatMap(s => s.dialogue)[0]?.id ?? ''
    const withText = addScreenText(withDialogue, 5000)
    const textId = withText.shots.flatMap(s => s.screenText)[0]?.id ?? ''

    const next = removeSelected(withText, [
      { kind: 'dialogue', id: lineId }, { kind: 'screenText', id: textId },
    ])
    expect(next.shots.flatMap(s => s.body).some(seg => seg.kind === 'dialogue')).toBe(false)
    expect(next.shots.flatMap(s => s.body).some(seg => seg.kind === 'screenText')).toBe(false)
    expect(diagnosticIds(next)).not.toContain('COMPILE_FAILED')
  })

  /**
   * Runda 1 recenzji, bug krytyczny: usunięcie jedynej kwestii mówcy w danym
   * UJĘCIU musi zdjąć też JEGO segment `speaker` (i separator) z `body` tego
   * ujęcia, nie tylko segment `dialogue`. Mówca ma tu DRUGĄ, istniejącą
   * kwestię w ujęciu 'b' (przetrwa niedotknięta), żeby ten test mierzył
   * WYŁĄCZNIE sprzątanie `body` — bez drugiej kwestii usunięcie jedynej
   * kwestii mówcy w całym projekcie zapaliłoby też (poprawnie! patrz opis
   * niżej w pliku) `SPEAKER_SILENT_NO_ID`, co zaciemniłoby, co dokładnie ten
   * test sprawdza.
   */
  it('usunięcie jedynej kwestii mówcy w jednym ujęciu zdejmuje jego segment mówcy z body tego ujęcia', () => {
    const project: Project = {
      ...twoShots(),
      speakers: [speaker('s1', 'S1')],
      shots: [
        emptyShot('a', 0, 0),
        {
          ...emptyShot('b', 1, 4000),
          dialogue: [line('d0', ['s1'], 'istniejąca', 4000, 4500)],
          body: [
            { kind: 'speaker', speakerIds: ['s1'], form: 'full' },
            { kind: 'text', text: ' ' },
            { kind: 'dialogue', eventId: 'd0' },
          ],
        },
      ],
    }
    const withLine = addDialogue(project, 1000, 's1') // trafia do pustego ujęcia 'a'
    const newLineId = withLine.shots.find(s => s.id === 'a')?.dialogue[0]?.id ?? ''
    const next = removeSelected(withLine, [{ kind: 'dialogue', id: newLineId }])
    const shotA = next.shots.find(s => s.id === 'a')
    // `body` ujęcia 'a' było puste przed `addDialogue` — round-trip do tego
    // samego kształtu dowodzi, że ZARÓWNO segment mówcy, JAK I separator
    // między nim a kwestią, zniknęły razem z samą kwestią.
    expect(shotA?.body).toEqual([])
    // Ujęcie 'b' — z drugą, nietkniętą kwestią tego samego mówcy — zostaje
    // bez zmian: sprzątanie działa per ujęcie, nie globalnie po mówcy.
    expect(next.shots.find(s => s.id === 'b')?.body).toHaveLength(3)
    expect(diagnosticIds(next)).not.toContain('SPEAKER_SILENT_NO_ID')
    expect(diagnosticIds(next)).not.toContain('BODY_REFS_COMPLETE')
  })

  /**
   * Sprzątanie mówcy jest pozycyjne (segmenty między nim a NASTĘPNYM mówcą w
   * `body`), nie dowiązane do konkretnego id usuniętej kwestii — inaczej
   * mówca wprowadzający dwie kwestie z rzędu straciłby atrybucję po usunięciu
   * TYLKO jednej z nich, mimo że druga wciąż tam jest i wciąż jej potrzebuje.
   * `body` budowane tu ręcznie (nie przez `addDialogue`, który zawsze tworzy
   * WŁASNY segment mówcy na kwestię) właśnie po to, żeby przetestować ten
   * ogólny, pozycyjny przypadek.
   */
  it('mówca wprowadzający kilka kwestii z rzędu przeżywa usunięcie tylko jednej z nich', () => {
    const project: Project = {
      ...twoShots(),
      speakers: [speaker('s1', 'S1')],
      shots: [
        {
          ...emptyShot('a', 0, 0),
          dialogue: [
            line('d1', ['s1'], 'pierwsza', 1000, 2000),
            line('d2', ['s1'], 'druga', 2500, 3500),
          ],
          body: [
            { kind: 'speaker', speakerIds: ['s1'], form: 'full' },
            { kind: 'text', text: ' ' },
            { kind: 'dialogue', eventId: 'd1' },
            { kind: 'text', text: ' ' },
            { kind: 'dialogue', eventId: 'd2' },
          ],
        },
        emptyShot('b', 1, 4000),
      ],
    }
    const next = removeSelected(project, [{ kind: 'dialogue', id: 'd1' }])
    const shotA = next.shots.find(s => s.id === 'a')
    expect(shotA?.body).toEqual([
      { kind: 'speaker', speakerIds: ['s1'], form: 'full' },
      { kind: 'text', text: ' ' },
      { kind: 'dialogue', eventId: 'd2' },
    ])
  })

  /**
   * Runda 1 recenzji, bug ważny: trzy cykle „dodaj obiekt, usuń go" na
   * ujęciu z jednym przetrwałym ruchem kamery nie mogą zostawić w `body`
   * ŻADNEGO osieroconego separatora. Naiwne filtrowanie tylko po id obiektu
   * (bez `pruneBody`) zostawiało po każdym cyklu jedną spację nawiasową —
   * po trzech cyklach trzy, i prompt kończący się trzema spacjami zapisany w
   * `project.json`. Asercja na końcu porównuje `body` do jego kształtu
   * SPRZED pierwszego cyklu — nie tylko „brak spacji", tak żeby złapać też
   * ewentualne inne artefakty sprzątania.
   */
  it('trzy cykle „dodaj-usuń" nie zostawiają w body żadnych osieroconych separatorów', () => {
    const seeded: Project = {
      ...twoShots(),
      shots: [
        {
          ...emptyShot('a', 0, 0),
          cameraMoves: [{ id: 'move-1', type: 'static', startMs: 0, endMs: 1000 }],
          body: [{ kind: 'camera', moveId: 'move-1' }],
        },
        emptyShot('b', 1, 4000),
      ],
    }
    const originalBodyOfA = seeded.shots.find(s => s.id === 'a')?.body

    let project = seeded
    for (let cycle = 0; cycle < 3; cycle += 1) {
      project = addCameraMove(project, 500)
      const newMoveId = project.shots.flatMap(s => s.cameraMoves)
        .find(move => move.id !== 'move-1')?.id ?? ''
      project = removeSelected(project, [{ kind: 'camera', id: newMoveId }])
    }

    expect(project.shots.find(s => s.id === 'a')?.body).toEqual(originalBodyOfA)
  })
})

/**
 * Runda 1 recenzji: te dwie diagnostyki są poprawnym, uczciwym wynikiem
 * interfejsu robiącego dokładnie to, o co proszony — nie błędem do ukrycia.
 * Testy tu je jawnie DOKUMENTUJĄ (asercja, że diagnostyka SIĘ POJAWIA), żeby
 * ktoś przyszły nie próbował ich "naprawić" jako regresji.
 */
describe('wyniki uczciwe — walidator ma rację, nie próbujemy tego ukryć', () => {
  /**
   * Materiał `twoShots()` ma 8000 ms. Dla domyślnego tekstu placeholdera
   * ("new line", 2 słowa, ok. 741 ms przy tempie `WORDS_PER_SECOND=2.7`) i
   * domyślnej tolerancji `FIT_TOLERANCE=1.5`, okno musi być krótsze niż
   * ok. 494 ms, żeby reguła się zapaliła — a `rangeFrom` przycina okno do
   * tego, co zostało do końca materiału. Policzone dokładnie (patrz raport
   * zadania): dla tego materiału próg leży przy playheadzie ok. 7521 ms,
   * czyli w ostatnim ok. pół sekundy (479 ms) z 8000 ms — nie w ostatniej
   * sekundzie, jak sugerowałaby sama `DEFAULT_LENGTH_MS`. Kwestia naprawdę
   * się nie mieści — 741 ms tekstu w oknie krótszym niż 83 ms przy
   * playheadzie na samym końcu materiału.
   */
  it('kwestia dodana w ostatnim ~pół sekundy materiału łapie SPEECH_FITS, bo naprawdę się nie mieści', () => {
    const next = addDialogue(twoShots(), 7990, null)
    expect(diagnosticIds(next)).toContain('SPEECH_FITS')
  })

  /**
   * `SOUNDSCAPE_NA_ONLY_IF_SILENT` (shared/src/validate/rules/audio.ts)
   * czyta, czy `diegeticSfx` jest OBECNE — projekt, który deklaruje pełną
   * ciszę (`overallSoundscape: 'N/A'`) i dostaje pierwszy dźwięk, naprawdę
   * zaczyna sobie przeczyć. To dokładnie przypadek, przed którym ostrzega
   * brief zadania w akapicie o `SOUNDSCAPE_NA_ONLY_IF_SILENT`.
   */
  it('dodanie dźwięku do projektu z overallSoundscape="N/A" łapie SOUNDSCAPE_NA_ONLY_IF_SILENT', () => {
    const project = { ...twoShots(), audio: { overallSoundscape: 'N/A', nonDiegeticMusic: '' } }
    const next = addSfx(project, 1000)
    expect(diagnosticIds(next)).toContain('SOUNDSCAPE_NA_ONLY_IF_SILENT')
  })
})
