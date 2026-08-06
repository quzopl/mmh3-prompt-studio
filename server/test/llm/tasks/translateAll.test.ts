import { describe, expect, it, vi } from 'vitest'
import {
  applyOps,
  buildPrompt,
  parseProject,
  VIDEO_EDIT_SUMMARY_OPENING,
  type Diagnostic,
  type Label,
  type Project,
  type Speaker,
} from '@mmh3/shared'
import type { Provider } from '../../../src/llm/provider.js'
import {
  chunkFields,
  collectTranslatableFields,
  runTranslateAll,
  translateAllSchemaFor,
  translateAllTaskFor,
  translateAllToPatch,
  type TranslatableField,
  type TranslateAllResult,
} from '../../../src/llm/tasks/translateAll.js'
import { newProject } from '../../fixtures/newProject.js'

/**
 * Testujemy `collectTranslatableFields`/`translateAllToPatch`/`chunkFields`,
 * NIE rozmowę z modelem — rozmowa (budowa wiadomości, wymuszenie schematu,
 * naprawa) jest wspólna dla wszystkich zadań i pokryta przez `run.test.ts`
 * (zadanie 5). `runTranslateAll` jest jedynym miejscem, które faktycznie
 * woła `runTask` (przez podstawiony `Provider`), więc dla niej testujemy
 * WYŁĄCZNIE orkiestrację partii — to samo rozgraniczenie co
 * `structure.test.ts`/`redact.test.ts`.
 */

const speaker1: Speaker = {
  id: 'sp1', code: 'S1', characterType: 'kobieta', age: '30s', gender: 'female',
  pitch: 'mid', timbre: 'warm', rate: 'even', accent: 'neutral', onScreen: true,
  fullDescriptor: 'kobieta w niebieskim płaszczu', shortDescriptor: 'kobieta',
}
const speaker2: Speaker = {
  id: 'sp2', code: 'S2', characterType: 'mężczyzna', age: '40s', gender: 'male',
  pitch: 'low', timbre: 'gravelly', rate: 'slow', accent: 'neutral', onScreen: true,
  fullDescriptor: 'mężczyzna w szarym garniturze', shortDescriptor: 'mężczyzna',
}

/**
 * Projekt bez błędów walidatora, z wypełnionymi polami we WSZYSTKICH
 * miejscach, które `translateAllToPatch` umie zaadresować (style, dwa
 * segmenty tekstowe w jednym ujęciu, obie ścieżki dźwiękowe, opis obu
 * mówców) PLUS ruch kamery, segment mówcy i kwestia dialogowa w TYM SAMYM
 * ujęciu — żeby testy „czego nie ma w wejściu" mierzyły coś realne, nie
 * projekt, który i tak nigdy by tych pól nie zawierał.
 */
function cleanProject(): Project {
  const project = newProject()
  const shot = project.shots[0]
  if (shot === undefined) throw new Error('fixture bez ujęcia')
  return {
    ...project,
    style: 'Realistyczne ujęcia, naturalne światło.',
    speakers: [speaker1, speaker2],
    shots: [{
      ...shot,
      composition: 'szeroki plan pustego peronu o świcie',
      body: [
        { kind: 'text', text: 'Kobieta stoi sama przy krawędzi peronu.' },
        { kind: 'camera', moveId: 'move-1' },
        { kind: 'text', text: 'Pociąg nadjeżdża z oddali.' },
        { kind: 'speaker', speakerIds: ['sp1'], form: 'full' },
        { kind: 'dialogue', eventId: 'line-1' },
      ],
      cameraMoves: [{ id: 'move-1', type: 'static', startMs: 0, endMs: 4000 }],
      dialogue: [{
        id: 'line-1',
        speakerIds: ['sp1'],
        verb: 'says',
        punctuation: ':',
        language: 'Polish',
        text: 'Jeszcze zdążę zmienić zdanie.',
        voiceover: false,
        sceneTransBefore: false,
        sceneTransAfter: false,
        cutoff: false,
        startMs: 4000,
        endMs: 8000,
      }],
    }],
    audio: {
      overallSoundscape: 'W oddali słychać gwar ruchu ulicznego.',
      nonDiegeticMusic: 'Powolna melodia fortepianu gra nad rzadkimi smyczkami.',
    },
  }
}

// Przyjęte wyjątki od reguły „żadna nowa diagnostyka" — ustalone w poprzednich
// planach, wspólne dla wszystkich zadań językowych (patrz brief).
//
// Cztery pierwsze to reguły, których zapalenie jest UCZCIWYM skutkiem akcji, o
// którą użytkownik prosił (punkt 18
// `docs/superpowers/specs/2026-08-04-uwagi-do-planu-2.md`).
//
// Dwie ostatnie to reguły TREŚCI, dopisane w recenzji końcowej gałęzi (punkt
// 5): rozstrzygnięcie zadania 11 mówi, że schemat odpowiedzi modelu pilnuje
// KSZTAŁTU (liczba zdań, brak bloku `<d>`), a nie TREŚCI — więc słowo o
// nastroju w muzyce i kwestia dialogowa powtórzona w pejzażu to uczciwa
// informacja zwrotna na ekranie przeglądu, nie usterka kodu. Lista musiała je
// nazwać, żeby napisana reguła i napisane rozstrzygnięcie mówiły to samo
// (punkt 22 tego samego dokumentu). `SOUNDSCAPE_NO_DIALOGUE` niesie pod jednym
// identyfikatorem TAKŻE pytanie o kształt (blok `<d>`) — ono jest pilnowane w
// schemacie (`server/src/llm/tasks/audioFieldText.ts`) i ma tam własny test,
// więc przyjęcie identyfikatora tutaj nie zostawia go bez dowodu.
const ACCEPTED_NEW_DIAGNOSTICS = new Set([
  'SPEECH_FITS', 'SOUNDSCAPE_NA_ONLY_IF_SILENT', 'SPEAKER_SILENT_NO_ID', 'FL2VA_PREFER_SINGLE_SHOT',
  'MUSIC_NO_MOOD_WORDS', 'SOUNDSCAPE_NO_DIALOGUE',
])

function diagnosticsOf(project: Project): Diagnostic[] {
  return buildPrompt(project).diagnostics
}

function newDiagnostics(before: Diagnostic[], after: Diagnostic[]): Diagnostic[] {
  const beforeKeys = new Set(before.map(d => JSON.stringify(d)))
  return after.filter(d => !beforeKeys.has(JSON.stringify(d)))
}

function assertNoUnexpectedDiagnostics(before: Project, after: Project): void {
  const added = newDiagnostics(diagnosticsOf(before), diagnosticsOf(after))
  const unexpected = added.filter(d => !ACCEPTED_NEW_DIAGNOSTICS.has(d.ruleId))
  expect(unexpected).toEqual([])
}

// `newProject()` (fixture) NIE jest projektem bez prozy: `style` domyślnie
// niesie 'Live-action, cinematic', a `audio.nonDiegeticMusic` — 'N/A' (ten
// sam fakt, który komentarz w `routes/llm.test.ts` odnotowuje dla zadania 7).
// Testy „nic do przetłumaczenia" muszą jawnie wyzerować oba pola, inaczej
// mierzą coś innego, niż deklarują.
function emptyProject(): Project {
  return { ...newProject(), style: '', audio: { overallSoundscape: '', nonDiegeticMusic: '' } }
}

const standaloneLabel: Label = {
  id: 'lab-standalone', kind: 'subject', index: 1, assetIds: [],
  definition: 'kobieta w niebieskim płaszczu, lat 30', role: 'główna bohaterka', standalone: true,
}
const nonStandaloneLabel: Label = {
  id: 'lab-inline', kind: 'subject', index: 2, assetIds: [],
  definition: 'mężczyzna w tle', role: 'postać drugoplanowa', standalone: false,
}
/** Etykieta wideo istnieje po to, żeby `<Video 1>` z narzuconego zdania
 * otwierającego (`VIDEO_EDIT_SUMMARY_OPENING`) był etykietą ZDEFINIOWANĄ —
 * inaczej `REF_NO_NEW_LABELS_IN_SUMMARY` paliłoby się w fiksturze od pierwszej
 * klatki i test „ta reguła zapala się dopiero po złej odpowiedzi" nie
 * mierzyłby niczego. */
const videoLabel: Label = {
  id: 'lab-video', kind: 'video', index: 1, assetIds: [],
  definition: 'materiał źródłowy nakręcony z ręki', role: 'wideo wejściowe', standalone: true,
}

/**
 * `cleanProject()` w trybie REF — fikstura przebudowana w recenzji końcowej
 * gałęzi (punkt 2), bo poprzednia czyniła test „łatka nie wnosi diagnostyki"
 * NIEZDOLNYM DO UPADKU z dwóch niezależnych powodów:
 *
 * 1. `<Subject 1>` stał także w segmencie `label` ciała ujęcia, więc
 *    `REF_LABEL_USED` czytało go z opisu szczegółowego NIEZALEŻNIE od tego, co
 *    tłumaczenie zrobiło z podsumowaniem — token dało się z podsumowania
 *    skasować bez śladu w diagnostyce. Komentarz uzasadniający ten segment
 *    powoływał się na regułę `RETENTION_LABEL_IN_PROSE`, której W CAŁYM
 *    REPOZYTORIUM NIE MA (jedyne trafienie grepa to sam ten komentarz). Teraz
 *    token żyje WYŁĄCZNIE w `ref.summaryText`.
 * 2. `taskTypes` nie zawierało `'video editing'`, więc `REF_VIDEO_EDIT_OPENING`
 *    (BŁĄD) było martwe — model mógł przepisać narzucone zdanie otwierające i
 *    żadna asercja nie miała jak tego zobaczyć. Teraz zadanie JEST montażowe, a
 *    podsumowanie zaczyna się od `VIDEO_EDIT_SUMMARY_OPENING`.
 *
 * Cztery testy „fikstura nie jest bezwładna" niżej trzymają oba te warunki
 * przy życiu: każdy podaje jedną z odpowiedzi, które recenzent odtworzył na
 * prawdziwym modelu, i wymaga, żeby diagnostyka SIĘ POJAWIŁA.
 */
function refProject(): Project {
  const base = cleanProject()
  const shot = base.shots[0]
  if (shot === undefined) throw new Error('fixture bez ujęcia')
  return {
    ...base,
    mode: 'REF',
    labels: [standaloneLabel, nonStandaloneLabel, videoLabel],
    shots: [shot],
    ref: {
      taskTypes: ['video editing'],
      summaryText: `${VIDEO_EDIT_SUMMARY_OPENING} Zachowaj ten sam strój i twarz <Subject 1> we wszystkich ujęciach.`,
      retention: [
        {
          id: 'ret1', labelId: standaloneLabel.id, scope: '', marker: 'fully_preserved',
          note: 'twarz i płaszcz muszą pozostać identyczne',
        },
        {
          id: 'ret2', labelId: videoLabel.id, scope: '', marker: 'partially_preserved',
          note: 'montaż zachowuje kolejność scen z materiału źródłowego',
        },
      ],
    },
  }
}

/**
 * Poprawna odpowiedź modelu dla `retention:summary`: narzucone zdanie
 * otwierające przepisane CO DO ZNAKU, token `<Subject 1>` przeniesiony
 * dosłownie, reszta zdania po angielsku. Wspólna stała, bo używa jej i test
 * kształtu operacji, i test „żadna nowa diagnostyka" — a każda z pięciu
 * odpowiedzi wrogich niżej różni się od niej dokładnie jedną rzeczą.
 */
const GOOD_SUMMARY_ENGLISH =
  `${VIDEO_EDIT_SUMMARY_OPENING} Keep the same outfit and face of <Subject 1> in every shot.`

/** Cztery reguły, które czytają to, co tłumaczenie może zepsuć w polach REF —
 * wszystkie MUSZĄ być nieaktywne w samej fiksturze, inaczej testy niżej
 * mierzyłyby różnicę względem projektu, który diagnostykę miał już przed
 * tłumaczeniem. */
const REF_RULES_AT_RISK = [
  'REF_LABEL_USED', 'REF_NO_NEW_LABELS_IN_SUMMARY',
  'REF_VIDEO_EDIT_OPENING', 'REF_NO_SPEAKER_IN_RETENTION',
]

/**
 * Prompt systemowy jest JEDYNĄ rzeczą, która wymusza zachowanie po stronie
 * modelu — schemat może odpowiedź odrzucić, ale nie umie jej podpowiedzieć,
 * jak ma wyglądać. Te trzy asercje pilnują zdań dopisanych w recenzji
 * końcowej gałęzi (punkty 2 i 3): bez nich skasowanie każdego z nich
 * zostawiłoby całą resztę tego pliku zieloną.
 */
describe('translateAllTaskFor — prompt systemowy', () => {
  const system = (): string => {
    const messages = translateAllTaskFor([]).buildMessages({
      fields: [{ id: 'style', text: 'Realistyczne ujęcia, naturalne światło.' }],
    })
    return messages.find(m => m.role === 'system')?.content ?? ''
  }

  it('każe przenosić tokeny etykiet dosłownie i zabrania ich zmyślania', () => {
    expect(system()).toMatch(/VERBATIM/)
    expect(system()).toMatch(/<Subject 1>/)
    expect(system()).toMatch(/never introduce a token/i)
  })

  it('nakazuje odtworzyć narzucone zdanie otwierające bez zmian — z jego dosłowną treścią w promptcie', () => {
    expect(system()).toContain(VIDEO_EDIT_SUMMARY_OPENING)
  })

  it('zabrania znaczników i powtarzania kwestii w polach audio — tak samo jak prompt zadania audio', () => {
    expect(system()).toMatch(/never write a "<d>" tag/i)
    expect(system()).toMatch(/never repeat or paraphrase spoken dialogue/i)
  })
})

describe('collectTranslatableFields', () => {
  it('projekt bez żadnej prozy nie daje żadnego pola', () => {
    expect(collectTranslatableFields(emptyProject())).toEqual([])
  })

  it('zwraca dokładnie dziewięć pól z czystego projektu, po jednym identyfikatorze na pole', () => {
    const fields = collectTranslatableFields(cleanProject())
    const ids = fields.map(f => f.id).sort()
    expect(ids).toEqual([
      'audio:nonDiegeticMusic',
      'audio:overallSoundscape',
      'shotText:s1:0',
      'shotText:s1:2',
      'speaker:sp1:fullDescriptor',
      'speaker:sp1:shortDescriptor',
      'speaker:sp2:fullDescriptor',
      'speaker:sp2:shortDescriptor',
      'style',
    ].sort())
  })

  it('segment tekstowy dostaje identyfikator z prawdziwym indeksem w body, nie kolejnym numerem tekstów', () => {
    const fields = collectTranslatableFields(cleanProject())
    const shotTextIds = fields.filter(f => f.id.startsWith('shotText:')).map(f => f.id).sort()
    // Drugi segment tekstowy jest pod indeksem 2 w `body` (index 1 to kamera)
    // — identyfikator MUSI to odzwierciedlać, inaczej `setShotText` trafi w
    // zły segment.
    expect(shotTextIds).toEqual(['shotText:s1:0', 'shotText:s1:2'])
  })

  it('treść kwestii dialogowej nie pojawia się nigdzie w zebranych polach — sprawdzone na zbudowanej liście, nie na wierze', () => {
    const project = cleanProject()
    const dialogueText = project.shots[0]?.dialogue[0]?.text
    if (dialogueText === undefined) throw new Error('fixture bez kwestii')
    const fields = collectTranslatableFields(project)
    expect(fields.some(f => f.text === dialogueText)).toBe(false)
    expect(fields.some(f => f.id.includes('line-1'))).toBe(false)
  })

  it('pole słownikowe (cutPhrase) nie trafia do zebranych pól', () => {
    const project = cleanProject()
    const cutPhrase = project.shots[0]?.cutPhrase
    const fields = collectTranslatableFields(project)
    expect(fields.some(f => f.text === cutPhrase)).toBe(false)
    expect(fields.some(f => f.id.includes('cutPhrase'))).toBe(false)
  })

  it('SFX diegetyczny i composition nie trafiają do zebranych pól — w ŻADNYM trybie, bo żaden skompilowany prompt ich nie czyta', () => {
    const base = refProject()
    const shot = base.shots[0]
    if (shot === undefined) throw new Error('fixture bez ujęcia')
    const project: Project = {
      ...base,
      shots: [{
        ...shot,
        diegeticSfx: [{ id: 'sfx1', description: 'metaliczny zgrzyt hamulców pociągu', startMs: 0, endMs: 1000 }],
      }],
    }
    const texts = collectTranslatableFields(project).map(f => f.text)
    expect(texts).not.toContain('metaliczny zgrzyt hamulców pociągu')
    expect(texts).not.toContain(project.shots[0]?.composition)
  })

  it('etykiety i wpisy retencji nie trafiają do zebranych pól POZA trybem REF', () => {
    // Sam projekt REF, tylko ze zmienionym trybem — dowodzi, że to TRYB
    // bramkuje zbieranie tych pól, nie ich (nie)obecność w projekcie.
    const project: Project = { ...refProject(), mode: 'T2VA' }
    const ids = collectTranslatableFields(project).map(f => f.id)
    expect(ids.some(id => id.startsWith('label:'))).toBe(false)
    expect(ids.some(id => id.startsWith('retention:'))).toBe(false)
  })

  it('w trybie REF: definicja etykiety standalone, podsumowanie i notatka retencji TRAFIAJĄ do zebranych pól, z właściwym identyfikatorem', () => {
    const project = refProject()
    const fields = collectTranslatableFields(project)
    const byId = new Map(fields.map(f => [f.id, f]))

    const definitionField = byId.get(`label:${standaloneLabel.id}:definition`)
    expect(definitionField?.text).toBe(standaloneLabel.definition)

    const summaryField = byId.get('retention:summary')
    expect(summaryField?.text).toBe(project.ref.summaryText)

    const noteField = byId.get('retention:entry:ret1')
    expect(noteField?.text).toBe('twarz i płaszcz muszą pozostać identyczne')
  })

  it('w trybie REF: definicja etykiety NIE-standalone nie trafia do zebranych pól', () => {
    const project = refProject()
    const ids = collectTranslatableFields(project).map(f => f.id)
    expect(ids).not.toContain(`label:${nonStandaloneLabel.id}:definition`)
  })

  it('w trybie REF: pole "role" etykiety NIGDY nie trafia do zebranych pól, mimo że "definition" tej samej etykiety trafia', () => {
    const project = refProject()
    const fields = collectTranslatableFields(project)
    expect(fields.some(f => f.text === standaloneLabel.role)).toBe(false)
    expect(fields.some(f => f.id.endsWith(':role'))).toBe(false)
    // Kontrast: "definition" TEJ SAMEJ etykiety jest zebrane — to nie jest
    // etykieta pominięta w całości, tylko konkretnie pole "role".
    expect(fields.some(f => f.id === `label:${standaloneLabel.id}:definition`)).toBe(true)
  })

  it('pole puste nie trafia do zebranych pól', () => {
    const project = { ...newProject(), style: '   ' }
    expect(collectTranslatableFields(project).some(f => f.id === 'style')).toBe(false)
  })
})

describe('chunkFields', () => {
  const field = (id: string, chars: number): TranslatableField => ({
    id, target: { kind: 'style' }, text: 'x'.repeat(chars),
  })

  it('mieści wszystkie pola w jednej partii, gdy suma długości nie przekracza budżetu', () => {
    const fields = [field('a', 10), field('b', 10), field('c', 10)]
    expect(chunkFields(fields, 100)).toEqual([fields])
  })

  it('dzieli na kilka partii, żaden pojedynczy budżet nie jest przekroczony poza jednym, nieuniknionym polem', () => {
    const fields = [field('a', 40), field('b', 40), field('c', 40), field('d', 40)]
    const batches = chunkFields(fields, 100)
    expect(batches.length).toBeGreaterThan(1)
    for (const batch of batches) {
      const total = batch.reduce((sum, f) => sum + f.text.length, 0)
      expect(total).toBeLessThanOrEqual(100)
    }
  })

  it('pojedyncze pole przekraczające budżet dostaje własną partię zamiast blokować cały bieg', () => {
    const fields = [field('a', 10), field('huge', 500), field('b', 10)]
    const batches = chunkFields(fields, 100)
    const hugeBatch = batches.find(batch => batch.some(f => f.id === 'huge'))
    expect(hugeBatch).toHaveLength(1)
  })

  it('żadne pole nie ginie ani nie dubluje się między partiami', () => {
    const fields = [field('a', 30), field('b', 30), field('c', 30), field('d', 30), field('e', 30)]
    const batches = chunkFields(fields, 70)
    const flat = batches.flat().map(f => f.id).sort()
    expect(flat).toEqual(fields.map(f => f.id).sort())
  })

  it('żadna partia nie jest pusta', () => {
    const fields = [field('a', 10), field('b', 10)]
    const batches = chunkFields(fields, 5)
    expect(batches.every(batch => batch.length > 0)).toBe(true)
  })
})

describe('translateAllToPatch — jedna łatka, wiele operacji', () => {
  it('cztery rodzaje pola dają cztery rodzaje operacji, po właściwym identyfikatorze, w jednej łatce', () => {
    const before = cleanProject()
    const result: TranslateAllResult = {
      fields: [
        { id: 'style', english: 'Realistic footage, natural light.' },
        { id: 'shotText:s1:0', english: 'A woman stands alone at the edge of the platform.' },
        { id: 'shotText:s1:2', english: 'A train approaches from the distance.' },
        { id: 'audio:overallSoundscape', english: 'Distant traffic hums beyond the platform.' },
        { id: 'audio:nonDiegeticMusic', english: 'A slow piano melody plays over sparse strings.' },
        { id: 'speaker:sp1:fullDescriptor', english: 'a woman in a blue coat' },
        { id: 'speaker:sp1:shortDescriptor', english: 'the woman' },
        { id: 'speaker:sp2:fullDescriptor', english: 'a man in a grey suit' },
        { id: 'speaker:sp2:shortDescriptor', english: 'the man' },
      ],
    }
    const patch = translateAllToPatch(result, before)
    expect(patch.ops).toHaveLength(9)

    const kinds = patch.ops.map(op => op.kind).sort()
    expect(kinds).toEqual(['setAudio', 'setAudio', 'setShotText', 'setShotText', 'setSpeakerDescriptor', 'setSpeakerDescriptor', 'setSpeakerDescriptor', 'setSpeakerDescriptor', 'setStyle'])

    const styleOp = patch.ops.find(op => op.kind === 'setStyle')
    if (styleOp === undefined || styleOp.kind !== 'setStyle') throw new Error('oczekiwano setStyle')
    expect(styleOp.text).toBe('Realistic footage, natural light.')

    const shotTextOps = patch.ops.filter(op => op.kind === 'setShotText')
    expect(shotTextOps).toHaveLength(2)
    const bySegment = new Map(shotTextOps.map(op => op.kind === 'setShotText' ? [op.segmentIndex, op] : [-1, op]))
    const seg0 = bySegment.get(0)
    const seg2 = bySegment.get(2)
    if (seg0 === undefined || seg0.kind !== 'setShotText' || seg2 === undefined || seg2.kind !== 'setShotText') {
      throw new Error('oczekiwano setShotText dla segmentów 0 i 2')
    }
    expect(seg0.shotId).toBe('s1')
    expect(seg0.text).toBe('A woman stands alone at the edge of the platform.')
    expect(seg2.text).toBe('A train approaches from the distance.')

    const audioOps = patch.ops.filter(op => op.kind === 'setAudio')
    expect(audioOps.map(op => op.kind === 'setAudio' ? op.field : undefined).sort()).toEqual(['nonDiegeticMusic', 'overallSoundscape'])

    const speakerOps = patch.ops.filter(op => op.kind === 'setSpeakerDescriptor')
    expect(speakerOps).toHaveLength(4)
    expect(speakerOps.every(op => op.kind === 'setSpeakerDescriptor' && (op.speakerId === 'sp1' || op.speakerId === 'sp2'))).toBe(true)
  })

  it('w trybie REF: pole "label" daje setLabelField z właściwym labelId i "field"', () => {
    const before = refProject()
    const result: TranslateAllResult = {
      fields: [{ id: `label:${standaloneLabel.id}:definition`, english: 'a woman in a blue coat, in her 30s' }],
    }
    const patch = translateAllToPatch(result, before)
    expect(patch.ops).toHaveLength(1)
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'setLabelField') throw new Error('oczekiwano setLabelField')
    expect(op.labelId).toBe(standaloneLabel.id)
    expect(op.field).toBe('definition')
    expect(op.text).toBe('a woman in a blue coat, in her 30s')
  })

  it('w trybie REF: pole "retention" (scope: summary) daje setRetentionText ze scope { kind: "summary" }', () => {
    const before = refProject()
    const result: TranslateAllResult = {
      fields: [{ id: 'retention:summary', english: GOOD_SUMMARY_ENGLISH }],
    }
    const patch = translateAllToPatch(result, before)
    expect(patch.ops).toHaveLength(1)
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'setRetentionText') throw new Error('oczekiwano setRetentionText')
    expect(op.scope).toEqual({ kind: 'summary' })
    expect(op.text).toBe(GOOD_SUMMARY_ENGLISH)
  })

  it('w trybie REF: pole "retention" (scope: entry) daje setRetentionText ze scope { kind: "entry", entryId }', () => {
    const before = refProject()
    const result: TranslateAllResult = {
      fields: [{ id: 'retention:entry:ret1', english: 'face and coat must remain identical' }],
    }
    const patch = translateAllToPatch(result, before)
    expect(patch.ops).toHaveLength(1)
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'setRetentionText') throw new Error('oczekiwano setRetentionText')
    expect(op.scope).toEqual({ kind: 'entry', entryId: 'ret1' })
    expect(op.text).toBe('face and coat must remain identical')
  })

  it('w trybie REF: "label"/"retention" już po angielsku (ta sama treść) nie tworzą operacji', () => {
    const before = refProject()
    const result: TranslateAllResult = {
      fields: [
        { id: `label:${standaloneLabel.id}:definition`, english: standaloneLabel.definition },
        { id: 'retention:summary', english: before.ref.summaryText },
        { id: 'retention:entry:ret1', english: 'twarz i płaszcz muszą pozostać identyczne' },
      ],
    }
    expect(translateAllToPatch(result, before).ops).toEqual([])
  })

  it('identyfikator "label:...:role" — którego collectTranslatableFields nigdy nie wystawia — jest odrzucany bez śladu', () => {
    const before = refProject()
    const result: TranslateAllResult = {
      fields: [{ id: `label:${standaloneLabel.id}:role`, english: 'the protagonist' }],
    }
    const patch = translateAllToPatch(result, before)
    expect(patch.ops).toEqual([])
    const after = applyOps(before, patch.ops)
    expect(after.labels.find(l => l.id === standaloneLabel.id)?.role).toBe(standaloneLabel.role)
  })

  it('identyfikator wpisu retencji, który nie istnieje w projekcie, jest odrzucany bez śladu', () => {
    const before = refProject()
    const result: TranslateAllResult = {
      fields: [{ id: 'retention:entry:brak', english: 'y' }],
    }
    expect(translateAllToPatch(result, before).ops).toEqual([])
  })

  it('pole już po angielsku (model zwraca tę samą treść) nie tworzy operacji — reszta łatki jest nietknięta', () => {
    const before = cleanProject()
    const result: TranslateAllResult = {
      fields: [
        { id: 'style', english: before.style }, // bez zmiany
        { id: 'shotText:s1:0', english: 'A woman stands alone at the edge of the platform.' },
      ],
    }
    const patch = translateAllToPatch(result, before)
    expect(patch.ops).toHaveLength(1)
    expect(patch.ops[0]?.kind).toBe('setShotText')
  })

  it('pusta odpowiedź modelu dla pola nie tworzy operacji zastępującej treść pustką', () => {
    const before = cleanProject()
    const result: TranslateAllResult = { fields: [{ id: 'style', english: '' }] }
    expect(translateAllToPatch(result, before).ops).toEqual([])
  })

  it('identyfikator spoza oferowanej listy jest odrzucany bez śladu — treść kwestii dialogowej nie zmienia się po zastosowaniu łatki', () => {
    const before = cleanProject()
    const dialogueEvent = before.shots[0]?.dialogue[0]
    if (dialogueEvent === undefined) throw new Error('fixture bez kwestii')

    const result: TranslateAllResult = {
      fields: [
        { id: 'style', english: 'Realistic footage, natural light.' },
        // Identyfikator, którego `collectTranslatableFields` NIGDY nie
        // wystawia — model "zgadł" prawdziwy identyfikator kwestii
        // dialogowej, próbując zaadresować pole, które nie jest prozą do
        // redakcji.
        { id: dialogueEvent.id, english: 'I will still have time to change my mind.' },
      ],
    }
    const patch = translateAllToPatch(result, before)
    expect(patch.ops).toHaveLength(1)
    expect(patch.ops[0]?.kind).toBe('setStyle')

    const after = applyOps(before, patch.ops)
    const afterEvent = after.shots[0]?.dialogue[0]
    expect(afterEvent?.text).toBe(dialogueEvent.text)
  })

  it('identyfikator pola słownikowego (cutPhrase) jest odrzucany bez śladu', () => {
    const before = cleanProject()
    const result: TranslateAllResult = {
      fields: [{ id: 'cutPhrase:s1', english: 'the shot cuts to' }],
    }
    const patch = translateAllToPatch(result, before)
    expect(patch.ops).toEqual([])
    const after = applyOps(before, patch.ops)
    expect(after.shots[0]?.cutPhrase).toBe(before.shots[0]?.cutPhrase)
  })

  it('projekt bez żadnej polskiej treści (model odsyła wszystko bez zmian) daje łatkę PUSTĄ, nie łatkę operacji bez zmian', () => {
    const before = cleanProject()
    const fields = collectTranslatableFields(before)
    // Model "odsyła" każde pole dokładnie takim, jakim je dostał — dokładnie
    // to, co system prompt każe robić dla treści już po angielsku (tu:
    // treść, którą model rzekomo uznał za niewymagającą zmiany).
    const result: TranslateAllResult = { fields: fields.map(f => ({ id: f.id, english: f.text })) }
    expect(translateAllToPatch(result, before).ops).toEqual([])
  })

  it('łatka zastosowana do czystego projektu nie wprowadza diagnostyki poza przyjętymi wyjątkami', () => {
    const before = cleanProject()
    const result: TranslateAllResult = {
      fields: [
        { id: 'style', english: 'Realistic footage, natural daylight.' },
        { id: 'shotText:s1:0', english: 'A woman stands alone at the edge of the platform.' },
        { id: 'shotText:s1:2', english: 'A train approaches from the distance.' },
        { id: 'audio:overallSoundscape', english: 'Distant traffic hums beyond the platform.' },
        { id: 'audio:nonDiegeticMusic', english: 'A slow piano melody plays over sparse strings.' },
        { id: 'speaker:sp1:fullDescriptor', english: 'a woman in a blue coat' },
        { id: 'speaker:sp2:fullDescriptor', english: 'a man in a grey suit' },
      ],
    }
    const patch = translateAllToPatch(result, before)
    expect(patch.ops.length).toBeGreaterThan(0)
    const after = applyOps(before, patch.ops)
    assertNoUnexpectedDiagnostics(before, after)
  })

  it('w trybie REF: łatka z setLabelField i setRetentionText zastosowana do czystego projektu nie wprowadza diagnostyki poza przyjętymi wyjątkami', () => {
    const before = refProject()
    const result: TranslateAllResult = {
      fields: [
        { id: `label:${standaloneLabel.id}:definition`, english: 'a woman in a blue coat, in her 30s' },
        { id: 'retention:summary', english: GOOD_SUMMARY_ENGLISH },
        { id: 'retention:entry:ret1', english: 'face and coat must remain identical' },
      ],
    }
    const patch = translateAllToPatch(result, before)
    expect(patch.ops).toHaveLength(3)
    const after = applyOps(before, patch.ops)
    assertNoUnexpectedDiagnostics(before, after)
  })

  it('w trybie REF: projekt bez żadnej polskiej treści (model odsyła wszystko bez zmian) daje łatkę PUSTĄ', () => {
    const before = refProject()
    const fields = collectTranslatableFields(before)
    expect(fields.length).toBeGreaterThan(0)
    const result: TranslateAllResult = { fields: fields.map(f => ({ id: f.id, english: f.text })) }
    expect(translateAllToPatch(result, before).ops).toEqual([])
  })

  it('wynik zastosowania łatki przechodzi parseProject', () => {
    const before = cleanProject()
    const result: TranslateAllResult = {
      fields: [
        { id: 'style', english: 'Realistic footage, natural daylight.' },
        { id: 'shotText:s1:0', english: 'A woman stands alone at the edge of the platform.' },
        { id: 'speaker:sp1:fullDescriptor', english: 'a woman in a blue coat' },
      ],
    }
    const patch = translateAllToPatch(result, before)
    const after = applyOps(before, patch.ops)
    expect(() => parseProject(after)).not.toThrow()
  })

  it('w trybie REF: wynik zastosowania łatki z setLabelField/setRetentionText przechodzi parseProject', () => {
    const before = refProject()
    const result: TranslateAllResult = {
      fields: [
        { id: `label:${standaloneLabel.id}:definition`, english: 'a woman in a blue coat, in her 30s' },
        { id: 'retention:summary', english: GOOD_SUMMARY_ENGLISH },
        { id: 'retention:entry:ret1', english: 'face and coat must remain identical' },
      ],
    }
    const patch = translateAllToPatch(result, before)
    const after = applyOps(before, patch.ops)
    expect(() => parseProject(after)).not.toThrow()
  })
})

/**
 * Recenzja końcowa gałęzi, punkt 2. Test „łatka nie wnosi diagnostyki" dla
 * trybu REF NIE MÓGŁ PAŚĆ: token etykiety stał także w ciele ujęcia, a typy
 * zadania czyniły regułę zdania otwierającego martwą. Poniższe pięć testów to
 * te same pięć odpowiedzi, które recenzent odtworzył na prawdziwym modelu —
 * każdy z nich wymaga, żeby ZŁA odpowiedź faktycznie zapaliła diagnostykę
 * (albo została odrzucona przez schemat). Padają natychmiast, gdy fikstura
 * wróci do stanu bezwładnego: dopisanie segmentu `label` do ciała ujęcia
 * gasi dwa pierwsze, usunięcie `'video editing'` z typów zadania — czwarty.
 */
describe('translateAll — pięć odpowiedzi psujących pola REF (fikstura, która potrafi to zobaczyć)', () => {
  /** Diagnostyki, które POJAWIŁY SIĘ po zastosowaniu odpowiedzi modelu —
   * różnica zbiorów, dokładnie jak `assertNoUnexpectedDiagnostics`, tylko
   * zwrócona zamiast asercji, bo tu chodzi o to, żeby JAKAŚ się pojawiła. */
  function ruleIdsAddedBy(field: { id: string; english: string }): string[] {
    const before = refProject()
    const patch = translateAllToPatch({ fields: [field] }, before)
    expect(patch.ops).toHaveLength(1)
    const after = applyOps(before, patch.ops)
    return newDiagnostics(diagnosticsOf(before), diagnosticsOf(after)).map(d => d.ruleId)
  }

  it('sama fikstura NIE ma żadnej z czterech reguł, które te odpowiedzi psują', () => {
    // Bez tego wszystkie testy niżej mierzyłyby różnicę względem projektu,
    // który diagnostykę miał już przed tłumaczeniem — czyli nie mierzyłyby nic.
    const ids = diagnosticsOf(refProject()).map(d => d.ruleId)
    for (const rule of REF_RULES_AT_RISK) expect(ids).not.toContain(rule)
  })

  it('(1) podsumowanie bez <Subject 1> zapala REF_LABEL_USED — token żyje TYLKO w podsumowaniu', () => {
    expect(ruleIdsAddedBy({
      id: 'retention:summary',
      english: `${VIDEO_EDIT_SUMMARY_OPENING} Keep the same outfit and face in every shot.`,
    })).toContain('REF_LABEL_USED')
  })

  it('(2) token zlokalizowany na <Podmiot 1> zapala REF_LABEL_USED', () => {
    expect(ruleIdsAddedBy({
      id: 'retention:summary',
      english: `${VIDEO_EDIT_SUMMARY_OPENING} Keep the same outfit and face of <Podmiot 1> in every shot.`,
    })).toContain('REF_LABEL_USED')
  })

  // Token zmyślony musi być spoza `subject_definitions` — fikstura definiuje
  // etykiety 1 (standalone) i 2 (nie-standalone), więc pierwszym naprawdę
  // nieznanym jest `<Subject 3>`. Zmierzone: `<Subject 2>` NIE zapala tej
  // reguły, bo `definedLabelTexts` (`shared/src/validate/rules/ref.ts`) nie
  // filtruje po `standalone`.
  it('(3) zmyślony <Subject 3> zapala REF_NO_NEW_LABELS_IN_SUMMARY (BŁĄD — blokuje eksport)', () => {
    expect(ruleIdsAddedBy({
      id: 'retention:summary',
      english: `${VIDEO_EDIT_SUMMARY_OPENING} Keep <Subject 1> and <Subject 3> unchanged in every shot.`,
    })).toContain('REF_NO_NEW_LABELS_IN_SUMMARY')
  })

  it('(4) przepisane zdanie otwierające zapala REF_VIDEO_EDIT_OPENING (BŁĄD — blokuje eksport)', () => {
    expect(ruleIdsAddedBy({
      id: 'retention:summary',
      english: 'The final video is an edit of <Video 1>. Keep the same outfit and face of <Subject 1> in every shot.',
    })).toContain('REF_VIDEO_EDIT_OPENING')
  })

  it('(5) notatka retencji z identyfikatorem mówcy zapala REF_NO_SPEAKER_IN_RETENTION (BŁĄD — blokuje eksport)', () => {
    expect(ruleIdsAddedBy({
      id: 'retention:entry:ret1',
      english: 'the face and coat of the woman (S1) must remain identical',
    })).toContain('REF_NO_SPEAKER_IN_RETENTION')
  })
})

/**
 * Recenzja końcowa gałęzi, punkt 5: rozstrzygnięcie zadania 11 („schemat
 * pilnuje KSZTAŁTU, nie TREŚCI") i lista przyjętych wyjątków mówiły dotąd co
 * innego — lista nie znała reguł treści, więc pierwsza odpowiedź modelu ze
 * słowem o nastroju czerwieniłaby test, który tę odpowiedź ma uznawać za
 * uczciwą informację zwrotną. Ten test przypina rozstrzygnięcie do kodu:
 * diagnostyka MA się pojawić i MA być zaakceptowana. Padnie, gdy któraś
 * strona znów zacznie mówić co innego.
 */
describe('translateAll — reguły TREŚCI są uczciwą informacją zwrotną, nie usterką (punkt 5)', () => {
  it('słowo o nastroju w muzyce zapala MUSIC_NO_MOOD_WORDS, a mimo to łatka przechodzi asercję niezmiennika', () => {
    const before = cleanProject()
    const patch = translateAllToPatch({
      fields: [{ id: 'audio:nonDiegeticMusic', english: 'A tense drone hums under sparse strings.' }],
    }, before)
    expect(patch.ops).toHaveLength(1)
    const after = applyOps(before, patch.ops)

    // Reguła NAPRAWDĘ się zapala — bez tej asercji test niżej byłby spełniony
    // także przez odpowiedź, która nic nie zmienia.
    expect(newDiagnostics(diagnosticsOf(before), diagnosticsOf(after)).map(d => d.ruleId))
      .toContain('MUSIC_NO_MOOD_WORDS')
    assertNoUnexpectedDiagnostics(before, after)
  })
})

/**
 * Straż tokenów etykiet w SCHEMACIE odpowiedzi — pierwsza linia obrony, przed
 * `translateAllToPatch`: zła odpowiedź nie dociera nawet na ekran przeglądu,
 * tylko wraca do modelu jako runda naprawy (`runTask`). Schemat powstaje na
 * partię, ze źródeł tej partii — dlatego funkcja, nie stała.
 */
describe('translateAllTaskFor — straże działają też między partiami (recenzja poprawek końcowych)', () => {
  /**
   * Trzy straże potrzebujące treści źródłowej brały ją dotąd z mapy zbudowanej
   * z JEDNEJ partii. Model odpowiadający na partię N potrafi zwrócić wpis o
   * `id` z partii M — wtedy `sources.get(id)` było `undefined` i wszystkie
   * trzy się pomijały, a `translateAllToPatch` takiego pola nie odsiewa, bo
   * filtruje po pełnej liście celów projektu, na której to `id` stoi.
   */
  const batchOne: TranslatableField[] = [
    { id: 'style', target: { kind: 'style' }, text: 'Realistyczne ujęcia.' },
  ]
  const batchTwo: TranslatableField[] = [{
    id: 'retention:summary',
    target: { kind: 'retention', scope: { kind: 'summary' } },
    text: `${VIDEO_EDIT_SUMMARY_OPENING} Zachowaj twarz <Subject 1>.`,
  }]
  const allFields = [...batchOne, ...batchTwo]

  const parseInBatchOne = (english: string) =>
    translateAllTaskFor(batchOne, allFields).schema.safeParse({
      fields: [{ id: 'retention:summary', english }],
    })

  it('odpowiedź z identyfikatorem z INNEJ partii jest sprawdzana, nie pomijana', () => {
    const result = parseInBatchOne(
      'The final video is an edit of <Video 1>. Keep the face of <Subject 1>.',
    )
    if (result.success) throw new Error('oczekiwano odrzucenia — zdanie otwierające przepisane')
    expect(result.error.issues[0]?.path).toEqual(['fields', 0, 'english'])
  })

  it('poprawna odpowiedź o polu z innej partii nadal przechodzi', () => {
    expect(parseInBatchOne(`${VIDEO_EDIT_SUMMARY_OPENING} Keep the face of <Subject 1>.`).success).toBe(true)
  })

  it('identyfikator spoza CAŁEGO projektu nadal przechodzi schemat — odsiewa go translateAllToPatch', () => {
    const result = translateAllTaskFor(batchOne, allFields).schema.safeParse({
      fields: [{ id: 'nie-ma-takiego-pola', english: 'anything at all' }],
    })
    expect(result.success).toBe(true)
  })
})

describe('translateAllSchemaFor — zdanie otwierające i identyfikator mówcy (recenzja końcowa, runda 2)', () => {
  /**
   * Blok wyżej („pięć odpowiedzi psujących pola REF") dowodzi, że te
   * odpowiedzi FAKTYCZNIE zapalają błędy blokujące eksport. Ten blok jest ich
   * drugą połową: że schemat odrzuca je ZANIM staną się operacją do przyjęcia.
   * Bez niego jedyną strażą byłby prompt, a prompt jest prośbą — cały ten plan
   * stoi na założeniu, że model potrafi odpowiedzieć pewnie i błędnie.
   */
  const summarySource = `${VIDEO_EDIT_SUMMARY_OPENING} Zachowaj ten sam strój i twarz <Subject 1> we wszystkich ujęciach.`
  const noteSource = 'twarz i płaszcz kobiety mają pozostać identyczne'
  const sources = new Map([
    ['retention:summary', summarySource],
    ['retention:entry:ret1', noteSource],
  ])
  const parse = (id: string, english: string) =>
    translateAllSchemaFor(sources).safeParse({ fields: [{ id, english }] })

  it('przepisane zdanie otwierające jest odrzucone', () => {
    const result = parse(
      'retention:summary',
      'The final video is an edit of <Video 1>. Keep the face of <Subject 1> unchanged.',
    )
    if (result.success) throw new Error('oczekiwano odrzucenia')
    expect(result.error.issues[0]?.path).toEqual(['fields', 0, 'english'])
  })

  it('zdanie otwierające przeniesione co do znaku jest przyjęte', () => {
    expect(parse('retention:summary', GOOD_SUMMARY_ENGLISH).success).toBe(true)
  })

  it('pole, którego źródło NIE zaczyna się od narzuconego zdania, nie jest nim ograniczone', () => {
    const plain = new Map([['style', 'Realistyczne ujęcia.']])
    const result = translateAllSchemaFor(plain).safeParse({
      fields: [{ id: 'style', english: 'Realistic footage.' }],
    })
    expect(result.success).toBe(true)
  })

  it('notatka retencji, do której model dopisał (S1), jest odrzucona', () => {
    const result = parse('retention:entry:ret1', 'the face and coat of the woman (S1) must remain identical')
    if (result.success) throw new Error('oczekiwano odrzucenia')
    expect(result.error.issues[0]?.path).toEqual(['fields', 0, 'english'])
  })

  it('notatka bez dopisanego identyfikatora jest przyjęta', () => {
    expect(parse('retention:entry:ret1', "the woman's face and coat must remain identical").success).toBe(true)
  })

  // Gdyby identyfikator STAŁ już w źródle, to nie model go dopisał — reguła
  // walidatora i tak go zgłosi, ale odrzucanie tłumaczenia za wierność wobec
  // wejścia zapętliłoby naprawę na czymś, czego model nie może naprawić.
  it('identyfikator obecny już w źródle nie jest powodem odrzucenia', () => {
    const withId = new Map([['retention:entry:ret1', 'twarz kobiety (S1) ma pozostać identyczna']])
    const result = translateAllSchemaFor(withId).safeParse({
      fields: [{ id: 'retention:entry:ret1', english: "the woman's (S1) face must remain identical" }],
    })
    expect(result.success).toBe(true)
  })
})

describe('translateAllSchemaFor — tokeny etykiet przenoszone dosłownie (recenzja końcowa, punkt 2)', () => {
  const sources = new Map([[
    'retention:summary',
    `${VIDEO_EDIT_SUMMARY_OPENING} Zachowaj ten sam strój i twarz <Subject 1> we wszystkich ujęciach.`,
  ]])
  const parse = (english: string) =>
    translateAllSchemaFor(sources).safeParse({ fields: [{ id: 'retention:summary', english }] })

  it('odpowiedź przenosząca oba tokeny co do znaku jest przyjęta', () => {
    expect(parse(GOOD_SUMMARY_ENGLISH).success).toBe(true)
  })

  it('odpowiedź gubiąca <Subject 1> jest odrzucona', () => {
    expect(parse(`${VIDEO_EDIT_SUMMARY_OPENING} Keep the same outfit and face in every shot.`).success).toBe(false)
  })

  it('odpowiedź tłumacząca token na <Podmiot 1> jest odrzucona', () => {
    expect(parse(`${VIDEO_EDIT_SUMMARY_OPENING} Keep the face of <Podmiot 1> unchanged.`).success).toBe(false)
  })

  // Straż schematu jest tu OSTRZEJSZA od walidatora — i słusznie: `<Subject 2>`
  // jest etykietą zdefiniowaną w projekcie (więc `REF_NO_NEW_LABELS_IN_SUMMARY`
  // by go przepuściło), ale nie było go w treści źródłowej TEGO pola, więc
  // model go dopisał, a nie przetłumaczył.
  it('odpowiedź zmyślająca <Subject 2> jest odrzucona, mimo że oryginalny token zostaje', () => {
    const result = parse(`${VIDEO_EDIT_SUMMARY_OPENING} Keep <Subject 1> and <Subject 2> unchanged.`)
    if (result.success) throw new Error('oczekiwano odrzucenia')
    expect(result.error.issues[0]?.path).toEqual(['fields', 0, 'english'])
  })

  it('pole spoza źródeł partii (model zgadł identyfikator) przechodzi tę straż — odsiewa je translateAllToPatch', () => {
    const result = translateAllSchemaFor(sources).safeParse({
      fields: [{ id: 'nie-ma-takiego-pola', english: 'anything at all' }],
    })
    expect(result.success).toBe(true)
  })

  it('pole bez ani jednego tokenu w źródle nie jest niczym ograniczone', () => {
    const plain = new Map([['style', 'Realistyczne ujęcia, naturalne światło.']])
    const result = translateAllSchemaFor(plain).safeParse({
      fields: [{ id: 'style', english: 'Realistic footage, natural light.' }],
    })
    expect(result.success).toBe(true)
  })

  it('straż jest zbudowana ze ŹRÓDEŁ PARTII — to samo zadanie dla innej partii nie wymaga cudzych tokenów', () => {
    // Dowód, że schemat NIE jest stały: ta sama odpowiedź, która przechodzi
    // dla partii bez `retention:summary`, odpada dla partii, która to pole
    // niesie. Gdyby schemat wrócił do postaci stałej, oba wywołania
    // zwróciłyby to samo.
    const answer = { fields: [{ id: 'retention:summary', english: 'Keep everything the same.' }] }
    expect(translateAllTaskFor([]).schema.safeParse(answer).success).toBe(true)
    const batch: TranslatableField[] = [{
      id: 'retention:summary',
      target: { kind: 'retention', scope: { kind: 'summary' } },
      text: sources.get('retention:summary') ?? '',
    }]
    expect(translateAllTaskFor(batch).schema.safeParse(answer).success).toBe(false)
  })
})

describe('runTranslateAll — orkiestracja partii', () => {
  const notUsed: Provider['stream'] = () => {
    throw new Error('runTranslateAll/runTask nie powinien wołać stream() bezpośrednio')
  }

  it('projekt bez żadnego pola do przetłumaczenia nigdy nie woła modelu', async () => {
    const complete = vi.fn()
    const provider: Provider = { listModels: async () => [], complete, stream: notUsed }
    const result = await runTranslateAll(provider, emptyProject(), new AbortController().signal, () => {})
    expect(complete).not.toHaveBeenCalled()
    expect(result).toEqual({ patch: { ops: [] }, promptTokens: 0, completionTokens: 0, repaired: false })
  })

  it('projekt z wieloma polami, przy małym budżecie partii, woła model więcej niż raz i skleja wynik w jedną łatkę', async () => {
    const project = cleanProject()
    let call = 0
    // Jedna partia = jedno pole (budżet 1 znak, zob. niżej), a
    // `collectTranslatableFields` zwraca pola w STAŁEJ kolejności (style,
    // potem oba segmenty tekstowe, potem audio, potem mówcy) — odpowiedzi
    // poniżej są WPROST przypisane do tej kolejności wywołań, po jednej na
    // partię, żeby żadna z nich nie powtórzyła się przypadkiem dla kilku
    // partii naraz (co dawałoby zduplikowane operacje dla tego samego pola).
    const responses = [
      JSON.stringify({ fields: [{ id: 'style', english: 'Realistic footage, natural light.' }] }),
      JSON.stringify({ fields: [{ id: 'shotText:s1:0', english: 'A woman stands alone at the edge of the platform.' }] }),
      '{"fields":[]}',
      '{"fields":[]}',
      '{"fields":[]}',
      '{"fields":[]}',
      '{"fields":[]}',
      '{"fields":[]}',
      '{"fields":[]}',
    ]
    const complete: Provider['complete'] = vi.fn(async () => {
      const text = responses[call] ?? '{"fields":[]}'
      call += 1
      return { text, promptTokens: 10, completionTokens: 20 }
    })
    const provider: Provider = { listModels: async () => [], complete, stream: notUsed }

    // Budżet mikroskopijny (1 znak) wymusza jedną partię na pole — projekt ma
    // dziewięć pól przetłumaczalnych, więc oczekujemy dziewięciu wywołań.
    const result = await runTranslateAll(provider, project, new AbortController().signal, () => {}, 1)

    expect(complete).toHaveBeenCalledTimes(9)
    expect(result.promptTokens).toBe(90)
    expect(result.completionTokens).toBe(180)
    expect(result.repaired).toBe(false)
    // Tylko dwie z dziewięciu partii dały rozpoznane pole w odpowiedzi
    // (reszta odpowiedzi zaślepki to `{"fields":[]}`) — łatka niesie
    // dokładnie te dwie operacje, sklejone z RÓŻNYCH wywołań modelu.
    expect(result.patch.ops).toHaveLength(2)
    expect(result.patch.ops.map(op => op.kind).sort()).toEqual(['setShotText', 'setStyle'])
  })

  it('naprawa w KTÓREJKOLWIEK partii ustawia repaired: true dla całego wyniku', async () => {
    const project = cleanProject()
    let call = 0
    const complete: Provider['complete'] = vi.fn(async () => {
      call += 1
      // Pierwsze wywołanie (pierwsza partia, pierwsza próba) zwraca coś, co
      // nie przechodzi schematu — `runTask` samo spróbuje naprawić.
      const text = call === 1 ? 'nie jest to JSON' : '{"fields":[]}'
      return { text, promptTokens: 1, completionTokens: 1 }
    })
    const provider: Provider = { listModels: async () => [], complete, stream: notUsed }

    const result = await runTranslateAll(provider, project, new AbortController().signal, () => {}, 1)
    expect(result.repaired).toBe(true)
  })

  it('sygnał przerwania trafia do dostawcy', async () => {
    const controller = new AbortController()
    const complete: Provider['complete'] = vi.fn(async () => ({ text: '{"fields":[]}', promptTokens: 1, completionTokens: 1 }))
    const provider: Provider = { listModels: async () => [], complete, stream: notUsed }
    await runTranslateAll(provider, cleanProject(), controller.signal, () => {}, 1)
    expect(vi.mocked(complete).mock.calls[0]?.[0]?.signal).toBe(controller.signal)
  })
})

/**
 * Fix round 2/5, zadanie 11, punkt 2: `translateAllToPatch` woła
 * `redactToPatch` dla pól `audio` dokładnie tak samo jak zadanie 7 —
 * identyczna luka (siedem zdań w `overallSoundscape` zapala
 * `SOUNDSCAPE_SENTENCES` na projekcie, który tej diagnostyki nie miał), tylko
 * dostępna przez trzecie drzwi (tłumaczenie całego projektu, nie pojedyncze
 * pole). Rozpoznanie, które elementy tablicy `fields` celują w pole audio,
 * idzie WYŁĄCZNIE po formacie `id` (`audio:${field}`) — ten sam identyfikator
 * budowany przez `collectTranslatableFields` niżej w tym pliku.
 */
describe('translateAllSchemaFor — straż pól audio po id (fix round 2/5, punkt 2)', () => {
  const sentences = (count: number, prefix: string): string =>
    Array.from({ length: count }, (_, i) => `${prefix} ${i + 1} is happening now`).join('. ') + '.'

  it('id "audio:overallSoundscape" z siedmioma zdaniami (poza 1–4) odrzucone', () => {
    const result = translateAllSchemaFor(new Map()).safeParse({
      fields: [{ id: 'audio:overallSoundscape', english: sentences(7, 'Wind') }],
    })
    expect(result.success).toBe(false)
  })

  it('id "audio:nonDiegeticMusic" z pięcioma zdaniami (poza 1–3) odrzucone', () => {
    const result = translateAllSchemaFor(new Map()).safeParse({
      fields: [{ id: 'audio:nonDiegeticMusic', english: sentences(5, 'A drum') }],
    })
    expect(result.success).toBe(false)
  })

  it('id "audio:overallSoundscape" w granicach 1–4 zdań przyjęte', () => {
    const result = translateAllSchemaFor(new Map()).safeParse({
      fields: [{ id: 'audio:overallSoundscape', english: sentences(3, 'Wind') }],
    })
    expect(result.success).toBe(true)
  })

  it('pole NIE-audio (np. "style") przyjmuje siedem zdań bez ograniczeń — reguła dotyczy tylko pól audio', () => {
    const result = translateAllSchemaFor(new Map()).safeParse({
      fields: [{ id: 'style', english: sentences(7, 'A wide shot') }],
    })
    expect(result.success).toBe(true)
  })

  it('partia mieszająca poprawne i złe pole odrzuca CAŁĄ partię ze wskazaniem właściwej ścieżki błędu', () => {
    const result = translateAllSchemaFor(new Map()).safeParse({
      fields: [
        { id: 'style', english: sentences(7, 'A wide shot') },
        { id: 'audio:overallSoundscape', english: sentences(7, 'Wind') },
      ],
    })
    if (result.success) throw new Error('oczekiwano odrzucenia')
    const issue = result.error.issues[0]
    expect(issue?.path).toEqual(['fields', 1, 'english'])
  })

  // Recenzja końcowa gałęzi, punkt 3: TRZECIE drzwi do tych samych dwóch pól.
  // `SOUNDSCAPE_NO_DIALOGUE` (BŁĄD) nie było pilnowane w żadnych z trzech,
  // mimo że `audioFieldText.ts` deklarował w swoim opisie, że JEST regułą dla
  // tekstu przeznaczonego na pola audio.
  it('blok <d> w polu audio jest odrzucony, choć liczba zdań się zgadza', () => {
    const result = translateAllSchemaFor(new Map()).safeParse({
      fields: [{ id: 'audio:overallSoundscape', english: 'Rain falls and someone says <d>Wait for me</d>.' }],
    })
    expect(result.success).toBe(false)
  })

  it('ten sam blok <d> w polu NIE-audio przechodzi — reguła należy do pól audio, nie do całego zadania', () => {
    const result = translateAllSchemaFor(new Map()).safeParse({
      fields: [{ id: 'style', english: 'Neo-noir with <d> in the text for some reason.' }],
    })
    expect(result.success).toBe(true)
  })
})
