import { describe, expect, it } from 'vitest'
import { buildPrompt, MS_PER_FRAME, type Project } from '@mmh3/shared'
import {
  addCameraMove, addDialogue, addScreenText, addSfx, removeSelected,
} from '../../src/timeline/createOnTrack.js'
import { baseProject, emptyShot } from './fixtures.js'

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
    const next = addDialogue(twoShots(), 1000, 's1')
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
})
