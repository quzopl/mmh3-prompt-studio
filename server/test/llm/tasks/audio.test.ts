import { describe, expect, it } from 'vitest'
import {
  applyOps,
  buildPrompt,
  parseProject,
  type Diagnostic,
  type Project,
  type Speaker,
} from '@mmh3/shared'
import { AudioSchema, audioInputFromProject, audioTask, audioToPatch, type AudioResult } from '../../../src/llm/tasks/audio.js'
import { cleanProject, cleanSpeaker as speaker } from '../../fixtures/cleanProject.js'

/**
 * Testujemy `audioToPatch`, nie rozmowę z modelem — rozmowa (budowa
 * wiadomości, wymuszenie schematu, naprawa) jest wspólna dla wszystkich
 * czterech zadań i pokryta przez `run.test.ts` (zadanie 5). Ten sam podział
 * co `redact.test.ts`/`structure.test.ts` (zadania 6–7).
 */

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

/**
 * `buildPrompt` — NIE gołe `validate(project, compile(project))` — bo to
 * `buildPrompt` rejestruje wszystkie reguły przez efekt uboczny
 * (`registerAllRules`, `shared/src/validate/rules/index.ts`). Bez tego
 * `allRules()` zwraca pustą listę i test „żadna nowa diagnostyka" przechodzi
 * niezależnie od tego, co robi kod (runda 1 recenzji zadania 6).
 */
function diagnosticsOf(project: Project): Diagnostic[] {
  return buildPrompt(project).diagnostics
}

/** Zbiór różnicowy: diagnostyki obecne PO, których nie było PRZED. */
function newDiagnostics(before: Diagnostic[], after: Diagnostic[]): Diagnostic[] {
  const beforeKeys = new Set(before.map(d => JSON.stringify(d)))
  return after.filter(d => !beforeKeys.has(JSON.stringify(d)))
}

function assertNoUnexpectedDiagnostics(before: Project, after: Project): void {
  const added = newDiagnostics(diagnosticsOf(before), diagnosticsOf(after))
  const unexpected = added.filter(d => !ACCEPTED_NEW_DIAGNOSTICS.has(d.ruleId))
  expect(unexpected).toEqual([])
}

/** Zakaz, który to zadanie niosło od początku — asercja dopisana w recenzji
 * końcowej gałęzi (punkt 3) razem z tymi samymi zdaniami w promptach redakcji
 * pojedynczego pola i tłumaczenia całego projektu, żeby wszystkie trzy drzwi
 * do tych samych dwóch pól mówiły modelowi to samo i żeby każde z tych zdań
 * miało swojego strażnika. */
describe('audioTask — prompt systemowy zabrania powtarzania kwestii dialogowej', () => {
  it('mówi wprost, że pejzaż nie powtarza ani nie parafrazuje dialogu', () => {
    const messages = audioTask.buildMessages({ shots: [{ content: 'kobieta stoi na peronie' }] })
    const system = messages.find(m => m.role === 'system')?.content ?? ''
    expect(system).toMatch(/never repeat or paraphrase spoken dialogue/i)
  })
})

describe('audioToPatch — dwie operacje, jedna na pejzaż, jedna na muzykę', () => {
  it('wynik z obu pól tworzy dwie operacje setAudio, każdą z własnym identyfikatorem', () => {
    const before = cleanProject()
    const result: AudioResult = {
      soundscape: 'Wind rattles a loose sign somewhere above the platform. A distant announcement echoes, too faint to make out.',
      music: 'A solo cello plays a slow, descending line under a single sustained synth pad.',
    }
    const patch = audioToPatch(result, before)

    expect(patch.ops).toHaveLength(2)
    const soundscapeOp = patch.ops.find(op => op.kind === 'setAudio' && op.field === 'overallSoundscape')
    const musicOp = patch.ops.find(op => op.kind === 'setAudio' && op.field === 'nonDiegeticMusic')
    if (soundscapeOp === undefined || soundscapeOp.kind !== 'setAudio') throw new Error('oczekiwano setAudio dla overallSoundscape')
    if (musicOp === undefined || musicOp.kind !== 'setAudio') throw new Error('oczekiwano setAudio dla nonDiegeticMusic')

    expect(soundscapeOp.text).toBe(result.soundscape)
    expect(musicOp.text).toBe(result.music)
    expect(soundscapeOp.id).not.toBe(musicOp.id)
  })

  it('operacje są przyjmowalne osobno — każda ma swój kind, pole i identyfikator, żadna nie zależy od drugiej', () => {
    const before = cleanProject()
    const result: AudioResult = {
      soundscape: 'Wind rattles a loose sign somewhere above the platform.',
      music: 'A solo cello plays a slow, descending line.',
    }
    const patch = audioToPatch(result, before)
    expect(patch.ops.every(op => op.kind === 'setAudio')).toBe(true)
    // Przyjęcie jednej operacji bez drugiej to zwykłe `applyOps` z tablicą
    // jednoelementową — właśnie to ma umożliwiać rozdzielenie na dwie operacje.
    const soundscapeOnly = patch.ops.filter(op => op.kind === 'setAudio' && op.field === 'overallSoundscape')
    const after = applyOps(before, soundscapeOnly)
    expect(after.audio.overallSoundscape).toBe(result.soundscape)
    expect(after.audio.nonDiegeticMusic).toBe(before.audio.nonDiegeticMusic)
  })
})

describe('audioToPatch — puste pole nie nadpisuje istniejącej treści', () => {
  it('pusty pejzaż w wyniku nie tworzy operacji dla overallSoundscape, ale muzyka nadal tworzy swoją', () => {
    const before = cleanProject()
    const result: AudioResult = { soundscape: '', music: 'A solo cello plays a slow, descending line.' }
    const patch = audioToPatch(result, before)

    expect(patch.ops).toHaveLength(1)
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'setAudio') throw new Error('oczekiwano setAudio')
    expect(op.field).toBe('nonDiegeticMusic')
  })

  it('pusta muzyka w wyniku nie tworzy operacji dla nonDiegeticMusic, ale pejzaż nadal tworzy swoją', () => {
    const before = cleanProject()
    const result: AudioResult = { soundscape: 'Wind rattles a loose sign somewhere above the platform.', music: '' }
    const patch = audioToPatch(result, before)

    expect(patch.ops).toHaveLength(1)
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'setAudio') throw new Error('oczekiwano setAudio')
    expect(op.field).toBe('overallSoundscape')
  })

  it('wynik złożony z samych białych znaków też liczy się jako pusty, dla obu pól naraz', () => {
    const before = cleanProject()
    const result: AudioResult = { soundscape: '   \n  ', music: '\t' }
    const patch = audioToPatch(result, before)
    expect(patch.ops).toEqual([])
  })

  it('pole identyczne z bieżącą treścią (po przycięciu białych znaków) nie tworzy operacji — nie ma czego przyjmować', () => {
    const before = cleanProject()
    const result: AudioResult = {
      soundscape: `  ${before.audio.overallSoundscape}  `,
      music: before.audio.nonDiegeticMusic,
    }
    const patch = audioToPatch(result, before)
    expect(patch.ops).toEqual([])
  })
})

describe('audioToPatch — niezmienniki projektu', () => {
  it('łatka bez słów o nastroju, zastosowana do czystego projektu, nie wprowadza diagnostyki poza przyjętymi wyjątkami', () => {
    const before = cleanProject()
    const result: AudioResult = {
      soundscape: 'Wind rattles a loose sign somewhere above the platform. A distant announcement echoes, too faint to make out.',
      music: 'A solo cello plays a slow, descending line under a single sustained synth pad.',
    }
    const patch = audioToPatch(result, before)
    expect(patch.ops).toHaveLength(2)

    const after = applyOps(before, patch.ops)
    assertNoUnexpectedDiagnostics(before, after)
  })

  it('wynik zastosowania łatki przechodzi parseProject', () => {
    const before = cleanProject()
    const result: AudioResult = {
      soundscape: 'Wind rattles a loose sign somewhere above the platform. A distant announcement echoes, too faint to make out.',
      music: 'A solo cello plays a slow, descending line under a single sustained synth pad.',
    }
    const patch = audioToPatch(result, before)
    const after = applyOps(before, patch.ops)
    expect(() => parseProject(after)).not.toThrow()
  })

  it('podpowiedź ze słowem o nastroju w muzyce odpala MUSIC_NO_MOOD_WORDS — to uczciwy sygnał reguły, nie błąd kodu', () => {
    // Brief: „jeśli model zwróci zdanie o nastroju, reguła to zgłosi — i tak
    // ma być". `MUSIC_NO_MOOD_WORDS` nie jest w przyjętych wyjątkach — ten
    // test dowodzi, że kiedy się pojawia, to dlatego, że TREŚĆ modelu złamała
    // regułę, nie dlatego, że `audioToPatch` cokolwiek do niej dopisał.
    const before = cleanProject()
    const result: AudioResult = {
      soundscape: '',
      music: 'A tense string ostinato drives beneath a single sustained cello note.',
    }
    const patch = audioToPatch(result, before)
    const after = applyOps(before, patch.ops)

    const added = newDiagnostics(diagnosticsOf(before), diagnosticsOf(after))
    expect(added.some(d => d.ruleId === 'MUSIC_NO_MOOD_WORDS')).toBe(true)
  })
})

describe('audioToPatch — pejzaż N/A zamieniony na treść', () => {
  it('projekt z pejzażem N/A i podpowiedzią niepustą: SOUNDSCAPE_NA_ONLY_IF_SILENT może zniknąć — diagnostyk nie przybywa, ubycie jest w porządku', () => {
    const base = cleanProject()
    const before: Project = { ...base, audio: { ...base.audio, overallSoundscape: 'N/A' } }

    // Projekt ma dialog (`hasSound`), więc N/A w pejzażu jest tu ostrzeżeniem
    // reguły, nie ciszą żądaną świadomie — sanity-check, że scenariusz w ogóle
    // odtwarza to, co ma testować.
    expect(diagnosticsOf(before).some(d => d.ruleId === 'SOUNDSCAPE_NA_ONLY_IF_SILENT')).toBe(true)

    const result: AudioResult = {
      soundscape: 'Wind rattles a loose sign somewhere above the platform. A distant announcement echoes, too faint to make out.',
      music: '',
    }
    const patch = audioToPatch(result, before)
    expect(patch.ops).toHaveLength(1)
    const op = patch.ops[0]
    if (op === undefined || op.kind !== 'setAudio') throw new Error('oczekiwano setAudio')
    expect(op.field).toBe('overallSoundscape')

    const after = applyOps(before, patch.ops)
    expect(after.audio.overallSoundscape).toBe(result.soundscape)

    // Reguła, która była przed łatką, znika po niej — to jest oczekiwane
    // ubycie, nie przybycie, więc `assertNoUnexpectedDiagnostics` (patrząca
    // tylko na to, co PRZYBYŁO) i tak przechodzi, ale sprawdzamy wprost, że
    // rzeczywiście zniknęła, zamiast polegać na tym przypadkiem.
    expect(diagnosticsOf(after).some(d => d.ruleId === 'SOUNDSCAPE_NA_ONLY_IF_SILENT')).toBe(false)
    assertNoUnexpectedDiagnostics(before, after)
  })
})

describe('audioInputFromProject — treść dla modelu pomija dialog i frazę ruchu kamery', () => {
  /**
   * Runda 1 fixów recenzji zadania 8: decyzja projektowa stała dotąd tylko w
   * komentarzu przy `shotContent` (`llm/tasks/audio.ts`) — ten test nazywa ją
   * wprost i dowodzi jej w runtime. Segmenty `camera` i `dialogue` w `body`
   * niosą wyłącznie identyfikator (`moveId`/`eventId`), nigdy renderowaną
   * treść, więc `shotContent` (filtrujący `kind === 'text'`) wyklucza je z
   * definicji — model nie widzi ani frazy ruchu kamery („The camera pushes
   * in"), ani kwestii dialogowej. Bez tego podpowiedź `soundscape` mogłaby po
   * prostu odbić kwestię z powrotem, co łamie `SOUNDSCAPE_NO_DIALOGUE`
   * (`shared/src/validate/rules/audio.ts`).
   */
  it('kwestia dialogowa i renderowana fraza ruchu kamery nie trafiają do treści ujęcia', () => {
    const before = cleanProject()
    const shot = before.shots[0]
    if (shot === undefined) throw new Error('fixture bez ujęcia')
    const line = shot.dialogue[0]
    if (line === undefined) throw new Error('fixture bez kwestii')

    const withCamera: Project = {
      ...before,
      shots: [{
        ...shot,
        cameraMoves: [{ id: 'move-1', type: 'push-in', startMs: 0, endMs: before.video.durationMs }],
        // Ruch kamery dopisany jako DODATKOWY segment — obok tekstu i kwestii,
        // które fixture już ma — żeby test dowodził pominięcia, nie tylko
        // braku obecności z braku okazji.
        body: [...shot.body, { kind: 'camera', moveId: 'move-1' }],
      }],
    }

    const input = audioInputFromProject(withCamera)
    const content = input.shots[0]?.content
    // Równość, nie samo „nie zawiera" — dowodzi, że treść to DOKŁADNIE
    // kompozycja plus tekstowy segment `body`, nic ponadto (ani frazy kamery,
    // ani kwestii), a nie że akurat żadne z nich nie zawiera pasującego słowa.
    expect(content).toBe(`${shot.composition} A woman stands alone at the edge of the platform.`)
    expect(content).not.toContain(line.text)
    expect(content).not.toContain('camera')
  })
})

/**
 * Fix round 1/5, zadanie 11, punkt 1 (krytyczny): przed tą poprawką
 * `AudioSchema` przyjmowało dowolny ciąg znaków, więc realistyczna odpowiedź
 * modelu spoza zakresu 1–4/1–3 zdań (guide §4.6/§4.7,
 * `shared/src/validate/rules/audio.ts` — `SOUNDSCAPE_SENTENCES`/
 * `MUSIC_SENTENCES`) przechodziła przez cały łańcuch (`audioToPatch` →
 * `applyOps` → ekran przeglądu) i zapalała regułę na projekcie, który jej
 * wcześniej nie miał. Testy niżej pilnują SCHEMATU wprost — to jedyne
 * miejsce w tym łańcuchu, które ma prawo odrzucić złą odpowiedź i dać
 * modelowi drugą próbę (`runTask`), zamiast po cichu przepuszczać ją dalej.
 */
describe('AudioSchema — liczba zdań pilnowana w schemacie, nie dopiero przez walidator', () => {
  const sentences = (count: number, prefix: string): string =>
    Array.from({ length: count }, (_, i) => `${prefix} ${i + 1} is happening now`).join('. ') + '.'

  it('pejzaż siedmiu zdań (poza zakresem 1–4) jest odrzucany przez schemat', () => {
    const result = AudioSchema.safeParse({ soundscape: sentences(7, 'Wind'), music: '' })
    expect(result.success).toBe(false)
  })

  it('muzyka pięciu zdań (poza zakresem 1–3) jest odrzucana przez schemat', () => {
    const result = AudioSchema.safeParse({ soundscape: '', music: sentences(5, 'A drum') })
    expect(result.success).toBe(false)
  })

  it('pejzaż w granicach 1–4 zdań jest przyjmowany', () => {
    const result = AudioSchema.safeParse({ soundscape: sentences(4, 'Wind'), music: '' })
    expect(result.success).toBe(true)
  })

  it('muzyka w granicach 1–3 zdań jest przyjmowana', () => {
    const result = AudioSchema.safeParse({ soundscape: '', music: sentences(3, 'A drum') })
    expect(result.success).toBe(true)
  })

  it('puste pole przechodzi zawsze — to legalne „brak propozycji", nie treść do policzenia', () => {
    const result = AudioSchema.safeParse({ soundscape: '', music: '' })
    expect(result.success).toBe(true)
  })

  it('"N/A" przechodzi zawsze, tak jak dopuszcza reguła walidatora', () => {
    const result = AudioSchema.safeParse({ soundscape: 'N/A', music: 'N/A' })
    expect(result.success).toBe(true)
  })

  it('komunikat błędu jest po angielsku i nazywa pole — to audytorium modelu w rundzie naprawczej, nie użytkownika', () => {
    const result = AudioSchema.safeParse({ soundscape: sentences(7, 'Wind'), music: '' })
    if (result.success) throw new Error('oczekiwano odrzucenia')
    const message = result.error.issues[0]?.message ?? ''
    // Fix round 2/5: nazwa pola w komunikacie to `overallSoundscape` (nazwa
    // pola PROJEKTU z `AudioFieldTextRule`, wspólna dla trzech zadań, które
    // mogą pisać do tego pola), nie skrócone `soundscape` z kluczy JSON tej
    // jednej rozmowy — patrz `audioFieldText.ts`.
    expect(message).toContain('overallSoundscape')
    expect(message).toContain('1 to 4 sentences')
  })
})

/**
 * Recenzja końcowa gałęzi, punkt 3: `audioFieldText.ts` deklarował w swoim
 * opisie, że JEST regułą dla tekstu przeznaczonego na pola audio, a sprawdzał
 * wyłącznie liczbę zdań. `SOUNDSCAPE_NO_DIALOGUE` (BŁĄD, pierwsza połowa to
 * zwykłe `includes('<d>')`) jest kontrolą DOKŁADNIE tego samego rodzaju i
 * dotąd nie stała nigdzie — a odpowiedź modelu cytująca kwestię w bloku `<d>`
 * jest w tym zadaniu wprost przewidziana promptem („Never repeat or paraphrase
 * spoken dialogue"), więc realna. To pierwsze z trojga drzwi; drugie i trzecie
 * mają swoje testy w `redact.test.ts` i `translateAll.test.ts`.
 */
describe('AudioSchema — blok <d> odrzucany w schemacie, nie dopiero przez walidator (recenzja końcowa, punkt 3)', () => {
  it('pejzaż z blokiem <d> jest odrzucany, choć liczba zdań się zgadza', () => {
    const result = AudioSchema.safeParse({
      soundscape: 'Rain falls on the platform and a woman says <d>Wait for me</d>.',
      music: '',
    })
    expect(result.success).toBe(false)
  })

  it('muzyka z blokiem <d> jest odrzucana tak samo', () => {
    const result = AudioSchema.safeParse({ soundscape: '', music: 'A piano plays under <d>Wait for me</d>.' })
    expect(result.success).toBe(false)
  })

  it('komunikat błędu mówi modelowi, czego nie wolno, po angielsku i z nazwą pola', () => {
    const result = AudioSchema.safeParse({ soundscape: 'Someone says <d>Wait</d>.', music: '' })
    if (result.success) throw new Error('oczekiwano odrzucenia')
    const message = result.error.issues[0]?.message ?? ''
    expect(message).toContain('overallSoundscape')
    expect(message).toContain('<d>')
    // Komunikat o liczbie zdań byłby tu mylący — tekst ma jedno zdanie i to
    // nie liczba zdań jest problemem.
    expect(message).not.toContain('sentences')
  })

  it('opis dźwięku BEZ bloku <d>, nawet mówiący o mówieniu, przechodzi — pilnowany jest znacznik, nie temat', () => {
    const result = AudioSchema.safeParse({
      soundscape: 'Muffled conversation carries from the far end of the platform.',
      music: '',
    })
    expect(result.success).toBe(true)
  })
})
