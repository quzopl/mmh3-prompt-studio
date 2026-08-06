import type { DialogueEvent, Project, Shot } from '../../model/types.js'
import { CONTINUITY_PHRASES } from '../../vocab/continuity.js'
import { defineRule, makeDiagnostic, type Diagnostic, type Rule } from '../types.js'

/** Domyślne tempo mowy używane do szacowania długości kwestii. */
export const WORDS_PER_SECOND = 2.7

/**
 * Tolerancja: kwestia może przekroczyć swoje okno o połowę, zanim zgłosimy
 * problem. Eksportowana (nie lokalna `const`) z tego samego powodu co
 * `WORDS_PER_SECOND` niżej — oś czasu (`web/src/timeline/speech.ts`,
 * `fitsClip`) pokazuje własną plakietkę „nie mieści się" na podstawie tego
 * samego pytania, więc musi stosować tę samą tolerancję, inaczej plakietka
 * zapalałaby się przy zerowym zapasie, a walidator dopiero po przekroczeniu
 * okna o połowę.
 */
export const FIT_TOLERANCE = 1.5

const SPEECH_VERBS = ['says', 'said', 'replies', 'exclaims', 'shouts', 'whispers', 'asks', 'answers']

/**
 * Znaczniki, których treść kwestii nie ma prawa nieść, bo dokłada je sam
 * kompilator: blok `<d>`/`</d>` i wiodący tag języka (`[English]`). To jedyna
 * definicja tego pytania — reguła `DIALOGUE_D_TAG_PURE` (niżej) pyta nią, i
 * pyta nią też zadanie językowe, które JAKO JEDYNE tworzy kwestie dialogowe
 * (`server/src/llm/tasks/dialogueText.ts`, zadanie „struktura ujęć"): schemat
 * odpowiedzi modelu odrzuca taki tekst, ZANIM trafi do projektu i zapali
 * błąd, którego projekt wcześniej nie miał. Dwie kopie tego wzorca rozjechałyby
 * się tak samo, jak ostrzega komentarz przy `WORDS_PER_SECOND`.
 */
export function containsDialogueMarkup(text: string): boolean {
  return /<\/?d>|^\s*\[[A-Za-z]+\]/.test(text)
}

export function estimateSpeechMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  if (words === 0) return 0
  return Math.round((words / WORDS_PER_SECOND) * 1000)
}

const eachDialogue = (
  project: Project,
  fn: (event: DialogueEvent, shot: Shot) => Diagnostic[],
): Diagnostic[] =>
  project.shots.flatMap(shot => shot.dialogue.flatMap(event => fn(event, shot)))

const speakerIdStable = defineRule({
  id: 'SPEAKER_ID_STABLE',
  severity: 'error',
  guideRef: 'guide_base §4.4',
  run: ({ project }) => {
    const seen = new Map<string, string>()
    const out: Diagnostic[] = []
    for (const speaker of project.speakers) {
      const owner = seen.get(speaker.code)
      if (owner) {
        out.push(makeDiagnostic(
          speakerIdStable,
          { kind: 'speaker', id: speaker.id },
          `Identyfikator ${speaker.code} jest przypisany do więcej niż jednego mówcy.`,
          `Speaker ID ${speaker.code} is assigned to more than one speaker.`,
        ))
      } else {
        seen.set(speaker.code, speaker.id)
      }
    }
    return out
  },
})

const speakerSilentNoId = defineRule({
  id: 'SPEAKER_SILENT_NO_ID',
  severity: 'warning',
  guideRef: 'guide_base §4.4',
  run: ({ project }) => {
    const vocal = new Set(
      project.shots.flatMap(shot => shot.dialogue.flatMap(d => d.speakerIds)),
    )
    return project.speakers
      .filter(speaker => !vocal.has(speaker.id))
      .map(speaker => makeDiagnostic(
        speakerSilentNoId,
        { kind: 'speaker', id: speaker.id },
        `Mówca ${speaker.code} nie wypowiada żadnej kwestii — postacie niemówiące nie dostają ID.`,
        `Speaker ${speaker.code} has no utterance — non-vocalizing characters receive no ID.`,
      ))
  },
})

const speakerFirstIntro = defineRule({
  id: 'SPEAKER_FIRST_INTRO',
  severity: 'warning',
  guideRef: 'guide_base §4.4',
  run: ({ project }) => {
    const introduced = new Set<string>()
    const out: Diagnostic[] = []
    for (const shot of [...project.shots].sort((a, b) => a.index - b.index)) {
      for (const seg of shot.body) {
        if (seg.kind === 'speaker') {
          const fresh = seg.speakerIds.filter(id => !introduced.has(id))
          if (fresh.length === 0) continue
          for (const id of fresh) introduced.add(id)
          if (seg.form === 'full' || seg.descriptor) continue
          out.push(makeDiagnostic(
            speakerFirstIntro,
            { kind: 'speaker', id: fresh[0]! },
            'Pierwsze wystąpienie mówcy musi zawierać opis tożsamości głosu.',
            'A speaker\'s first appearance must establish a stable voice identity.',
          ))
          continue
        }
        if (seg.kind === 'label' && seg.speakerId) {
          if (introduced.has(seg.speakerId)) continue
          introduced.add(seg.speakerId)
          // Segment etykiety renderuje samo "<Subject N> (Sx)" i nie niesie opisu,
          // więc tożsamość głosu musi być zapisana w rekordzie mówcy.
          const speaker = project.speakers.find(s => s.id === seg.speakerId)
          if (speaker?.fullDescriptor.trim()) continue
          out.push(makeDiagnostic(
            speakerFirstIntro,
            { kind: 'speaker', id: seg.speakerId },
            'Pierwsze wystąpienie mówcy musi zawierać opis tożsamości głosu.',
            'A speaker\'s first appearance must establish a stable voice identity.',
          ))
        }
      }
    }
    return out
  },
})

const dialogueDTagPure = defineRule({
  id: 'DIALOGUE_D_TAG_PURE',
  severity: 'error',
  guideRef: 'guide_base §4.4',
  run: ({ project }) => eachDialogue(project, event =>
    containsDialogueMarkup(event.text)
      ? [makeDiagnostic(
          dialogueDTagPure,
          { kind: 'dialogue', id: event.id },
          'Treść kwestii nie może zawierać znacznika <d> ani tagu języka — kompilator dodaje je sam.',
          'Dialogue text must not contain the <d> tag or a language tag — the compiler adds them.',
        )]
      : [],
  ),
})

const dialogueVerbatim = defineRule({
  id: 'DIALOGUE_VERBATIM',
  severity: 'hint',
  guideRef: 'guide_base §4.4',
  run: ({ project }) => eachDialogue(project, event => {
    const firstWord = event.text.trim().split(/\s|[:,]/)[0]?.toLowerCase() ?? ''
    if (!SPEECH_VERBS.includes(firstWord)) return []
    return [makeDiagnostic(
      dialogueVerbatim,
      { kind: 'dialogue', id: event.id },
      'Treść kwestii zaczyna się od czasownika mówienia — sprawdź, czy sposób podania nie trafił przypadkiem do środka <d>.',
      'The dialogue text starts with a speech verb — check that delivery has not slipped inside the <d> tag.',
    )]
  }),
})

const voExactPhrase = defineRule({
  id: 'VO_EXACT_PHRASE',
  severity: 'warning',
  guideRef: 'guide_base §4.4',
  run: ({ project }) => eachDialogue(project, event =>
    event.voiceover && event.verb !== 'says'
      ? [makeDiagnostic(
          voExactPhrase,
          { kind: 'dialogue', id: event.id },
          `Voiceover używa stałej frazy "says in an off-screen voiceover" — czasownik "${event.verb}" zostanie zignorowany.`,
          `Voiceover uses the fixed phrase "says in an off-screen voiceover" — the verb "${event.verb}" will be ignored.`,
        )]
      : [],
  ),
})

const voLipsClause = defineRule({
  id: 'VO_LIPS_CLAUSE',
  severity: 'error',
  guideRef: 'guide_base §4.4',
  run: ({ project }) => eachDialogue(project, event =>
    event.voiceover && !event.lipsClause?.trim()
      ? [makeDiagnostic(
          voLipsClause,
          { kind: 'dialogue', id: event.id },
          'Po bloku <d> voiceoveru musi wystąpić zdanie o całkowicie zamkniętych ustach postaci.',
          'A voiceover <d> block must be followed by a statement that the lips remain completely closed.',
        )]
      : [],
  ),
})

const sceneTransBothSides = defineRule({
  id: 'SCENETRANS_BOTH_SIDES',
  severity: 'error',
  guideRef: 'guide_base §4.4',
  run: ({ project }) => {
    const shots = [...project.shots].sort((a, b) => a.index - b.index)
    const out: Diagnostic[] = []
    shots.forEach((shot, i) => {
      for (const event of shot.dialogue) {
        if (!event.sceneTransAfter) continue
        const next = shots[i + 1]
        const continued = next?.dialogue.some(d => d.sceneTransBefore) ?? false
        if (!continued) {
          out.push(makeDiagnostic(
            sceneTransBothSides,
            { kind: 'dialogue', id: event.id },
            'Kwestia przecinająca cięcie wymaga znacznika <scenetrans> również po drugiej stronie.',
            'Dialogue crossing a cut requires a <scenetrans> marker on the other side as well.',
          ))
        }
        const phrase = event.continuityPhrase ?? ''
        if (!CONTINUITY_PHRASES.includes(phrase as (typeof CONTINUITY_PHRASES)[number])) {
          out.push(makeDiagnostic(
            sceneTransBothSides,
            { kind: 'dialogue', id: event.id },
            'Zdanie o ciągłości musi pochodzić z listy dozwolonej przez guide.',
            'The continuity statement must come from the list allowed by the guide.',
          ))
        }
      }
    })
    return out
  },
})

const cutoffAtEnd = defineRule({
  id: 'CUTOFF_AT_END',
  severity: 'error',
  guideRef: 'guide_base §4.4',
  run: ({ project }) => eachDialogue(project, event => {
    const overruns = event.endMs > project.video.durationMs
    if (overruns && !event.cutoff) {
      return [makeDiagnostic(
        cutoffAtEnd,
        { kind: 'dialogue', id: event.id },
        'Mowa ucięta końcem wideo wymaga znacznika <cutoff>.',
        'Speech truncated by the end of the video requires a <cutoff> marker.',
      )]
    }
    if (!overruns && event.cutoff) {
      return [makeDiagnostic(
        cutoffAtEnd,
        { kind: 'dialogue', id: event.id },
        'Znacznik <cutoff> ustawiony, choć kwestia kończy się przed końcem wideo.',
        'The <cutoff> marker is set although the line ends before the video does.',
      )]
    }
    return []
  }),
})

const speechFits = defineRule({
  id: 'SPEECH_FITS',
  severity: 'warning',
  guideRef: 'guide_ref §5.2 — dopasowanie ścieżki mówionej',
  run: ({ project }) => eachDialogue(project, event => {
    const slot = event.endMs - event.startMs
    if (slot <= 0) return []
    const estimate = estimateSpeechMs(event.text)
    if (estimate <= slot * FIT_TOLERANCE) return []
    return [makeDiagnostic(
      speechFits,
      { kind: 'dialogue', id: event.id },
      `Szacowana długość kwestii to ${estimate} ms przy oknie ${slot} ms — skróć tekst lub wydłuż okno.`,
      `Estimated line length is ${estimate} ms against a ${slot} ms window — shorten the text or widen the window.`,
    )]
  }),
})

export const speechRules: Rule[] = [
  speakerIdStable, speakerSilentNoId, speakerFirstIntro,
  dialogueDTagPure, dialogueVerbatim,
  voExactPhrase, voLipsClause,
  sceneTransBothSides, cutoffAtEnd, speechFits,
]
