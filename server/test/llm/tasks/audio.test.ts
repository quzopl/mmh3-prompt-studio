import { describe, expect, it } from 'vitest'
import {
  applyOps,
  buildPrompt,
  parseProject,
  type Diagnostic,
  type Project,
  type Speaker,
} from '@mmh3/shared'
import { AudioSchema, audioInputFromProject, audioToPatch, type AudioResult } from '../../../src/llm/tasks/audio.js'
import { newProject } from '../../fixtures/newProject.js'

/**
 * Testujemy `audioToPatch`, nie rozmowę z modelem — rozmowa (budowa
 * wiadomości, wymuszenie schematu, naprawa) jest wspólna dla wszystkich
 * czterech zadań i pokryta przez `run.test.ts` (zadanie 5). Ten sam podział
 * co `redact.test.ts`/`structure.test.ts` (zadania 6–7).
 */

const speaker: Speaker = {
  id: 'sp1', code: 'S1', characterType: 'kobieta', age: '30s', gender: 'female',
  pitch: 'mid', timbre: 'warm', rate: 'even', accent: 'neutral', onScreen: true,
  fullDescriptor: 'a woman in a blue coat', shortDescriptor: 'the woman',
}

/**
 * Projekt bez błędów walidatora, z mówcą i kwestią dialogową — potrzebne, żeby
 * `hasSound` (`SOUNDSCAPE_NA_ONLY_IF_SILENT`) było prawdziwe w scenariuszu
 * „N/A → treść" niżej, i żeby `SOUNDSCAPE_NO_DIALOGUE` miało czego pilnować.
 * Obie ścieżki dźwiękowe już wypełnione, poprawną liczbą zdań i bez słów
 * o nastroju — punkt odniesienia „czysty projekt" dla testów niezmienników.
 */
function cleanProject(): Project {
  const project = newProject()
  const shot = project.shots[0]
  if (shot === undefined) throw new Error('fixture bez ujęcia')
  return {
    ...project,
    speakers: [speaker],
    shots: [{
      ...shot,
      composition: 'a wide shot of an empty platform at dawn',
      dialogue: [{
        id: 'line-1',
        speakerIds: ['sp1'],
        verb: 'says',
        punctuation: ':',
        language: 'English',
        text: 'I still have time to change my mind.',
        voiceover: false,
        sceneTransBefore: false,
        sceneTransAfter: false,
        cutoff: false,
        startMs: 0,
        endMs: 2000,
      }],
      body: [
        { kind: 'text', text: 'A woman stands alone at the edge of the platform.' },
        { kind: 'speaker', speakerIds: ['sp1'], form: 'full' },
        { kind: 'dialogue', eventId: 'line-1' },
      ],
    }],
    audio: {
      overallSoundscape: 'Distant traffic hums beyond the platform. A train brakes with a long metallic screech.',
      nonDiegeticMusic: 'A slow piano melody plays over sparse strings.',
    },
  }
}

// Przyjęte wyjątki od reguły „żadna nowa diagnostyka" — ustalone w poprzednich
// planach, wspólne dla wszystkich czterech zadań językowych (patrz brief).
const ACCEPTED_NEW_DIAGNOSTICS = new Set([
  'SPEECH_FITS', 'SOUNDSCAPE_NA_ONLY_IF_SILENT', 'SPEAKER_SILENT_NO_ID', 'FL2VA_PREFER_SINGLE_SHOT',
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
