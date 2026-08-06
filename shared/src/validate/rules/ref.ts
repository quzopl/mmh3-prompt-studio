import type { Project } from '../../model/types.js'
import {
  AUDIO_MARKERS, labelTokensIn, REF_TASK_TYPES, VIDEO_EDIT_SUMMARY_OPENING, VISUAL_MARKERS,
} from '../../vocab/refVocab.js'
import { renderDetailedDescription, renderSummary } from '../../compile/emitRef.js'
import { labelText } from '../../compile/renderLabel.js'
import { defineRule, makeDiagnostic, type Diagnostic, type Rule } from '../types.js'

const MIN_WORDS = 350
const MAX_WORDS = 500

const isRef = (project: Project): boolean => project.mode === 'REF'

const definedLabelTexts = (project: Project): Set<string> =>
  new Set(project.labels.map(l => labelText(l, true)))

const refLabelDefined = defineRule({
  id: 'REF_LABEL_DEFINED',
  severity: 'error',
  guideRef: 'guide_ref §2',
  run: ({ project }) => {
    if (!isRef(project)) return []
    const out: Diagnostic[] = []
    for (const shot of project.shots) {
      for (const seg of shot.body) {
        if (seg.kind !== 'label') continue
        if (project.labels.some(l => l.id === seg.labelId)) continue
        out.push(makeDiagnostic(
          refLabelDefined,
          { kind: 'shot', id: shot.id },
          `Ujęcie ${shot.index + 1} używa etykiety bez definicji: ${seg.labelId}.`,
          `Shot ${shot.index + 1} uses an undefined label: ${seg.labelId}.`,
        ))
      }
    }
    return out
  },
})

const refLabelUsed = defineRule({
  id: 'REF_LABEL_USED',
  severity: 'warning',
  guideRef: 'guide_ref §2',
  run: ({ project }) => {
    if (!isRef(project)) return []
    const haystack = `${renderSummary(project)}\n${renderDetailedDescription(project)}`
    return project.labels
      .filter(l => l.standalone && !haystack.includes(labelText(l, true)))
      .map(l => makeDiagnostic(
        refLabelUsed,
        { kind: 'label', id: l.id },
        `Etykieta ${labelText(l, true)} jest zdefiniowana, ale nie występuje w summary ani w opisie.`,
        `Label ${labelText(l, true)} is defined but appears in neither the summary nor the description.`,
      ))
  },
})

const refRetentionComplete = defineRule({
  id: 'REF_RETENTION_COMPLETE',
  severity: 'error',
  guideRef: 'guide_ref §4',
  run: ({ project }) => {
    if (!isRef(project)) return []
    const covered = new Set(project.ref.retention.map(r => r.labelId))
    return project.labels
      .filter(l => l.standalone && !covered.has(l.id))
      .map(l => makeDiagnostic(
        refRetentionComplete,
        { kind: 'label', id: l.id },
        `Brak wpisu w retention_analysis dla ${labelText(l, true)}.`,
        `Missing retention_analysis entry for ${labelText(l, true)}.`,
      ))
  },
})

const refMarkerVocab = defineRule({
  id: 'REF_MARKER_VOCAB',
  severity: 'error',
  guideRef: 'guide_ref §4.1, §4.2',
  run: ({ project }) => {
    if (!isRef(project)) return []
    return project.ref.retention.flatMap(entry => {
      const label = project.labels.find(l => l.id === entry.labelId)
      if (!label) return []
      const allowed: readonly string[] = label.kind === 'audio' ? AUDIO_MARKERS : VISUAL_MARKERS
      if (allowed.includes(entry.marker)) return []
      return [makeDiagnostic(
        refMarkerVocab,
        { kind: 'retention', id: entry.id },
        `Marker "${entry.marker}" nie jest dozwolony dla etykiety ${labelText(label, true)}.`,
        `Marker "${entry.marker}" is not allowed for label ${labelText(label, true)}.`,
      )]
    })
  },
})

/**
 * Czy tekst niesie identyfikator mówcy w postaci `(S1)` albo `(S1,S2)`.
 *
 * Podniesione z ciała reguły `REF_NO_SPEAKER_IN_RETENTION` tym samym ruchem,
 * co `containsDialogueMarkup` przy regule `DIALOGUE_D_TAG_PURE`: pyta nim
 * także schemat odpowiedzi modelu w zadaniu tłumaczącym cały projekt, bo
 * `retention.note` idzie tam do przekładu, a model potrafi dopisać `(S1)`
 * z sąsiedniego zdania. Reguła ma severity `error`, a błąd blokuje eksport —
 * więc odpowiedź, która go zapala, musi zostać odrzucona ZANIM stanie się
 * operacją do przyjęcia. Dwie kopie tego wyrażenia rozjechałyby się tak samo,
 * jak ostrzegają komentarze przy pozostałych podniesionych predykatach.
 */
export function containsSpeakerId(text: string): boolean {
  return /\(S\d+(,S\d+)*\)/.test(text)
}

const refNoSpeakerInRetention = defineRule({
  id: 'REF_NO_SPEAKER_IN_RETENTION',
  severity: 'error',
  guideRef: 'guide_ref §5.4',
  run: ({ project }) => {
    if (!isRef(project)) return []
    return project.ref.retention
      .filter(entry => containsSpeakerId(`${entry.scope} ${entry.note}`))
      .map(entry => makeDiagnostic(
        refNoSpeakerInRetention,
        { kind: 'retention', id: entry.id },
        'Identyfikatory mówców nie mogą występować w retention_analysis.',
        'Speaker IDs must not appear in retention_analysis.',
      ))
  },
})

const refTaskTypes = defineRule({
  id: 'REF_TASK_TYPES',
  severity: 'error',
  guideRef: 'guide_ref §3',
  run: ({ project }) => {
    if (!isRef(project)) return []
    const types = project.ref.taskTypes
    const out: Diagnostic[] = []
    if (types.length === 0) {
      out.push(makeDiagnostic(
        refTaskTypes, { kind: 'project', id: project.id },
        'summary musi zaczynać się od co najmniej jednego typu zadania.',
        'The summary must begin with at least one task type.',
      ))
    }
    if (new Set(types).size !== types.length) {
      out.push(makeDiagnostic(
        refTaskTypes, { kind: 'project', id: project.id },
        'Typy zadania nie mogą się powtarzać.',
        'Task types must not repeat.',
      ))
    }
    for (const type of types) {
      if (!REF_TASK_TYPES.includes(type)) {
        out.push(makeDiagnostic(
          refTaskTypes, { kind: 'project', id: project.id },
          `Nieznany typ zadania: ${type}.`,
          `Unknown task type: ${type}.`,
        ))
      }
    }
    return out
  },
})

const refVideoEditOpening = defineRule({
  id: 'REF_VIDEO_EDIT_OPENING',
  severity: 'error',
  guideRef: 'guide_ref §3',
  run: ({ project }) => {
    if (!isRef(project)) return []
    if (!project.ref.taskTypes.includes('video editing')) return []
    if (project.ref.summaryText.trimStart().startsWith(VIDEO_EDIT_SUMMARY_OPENING)) return []
    return [makeDiagnostic(
      refVideoEditOpening,
      { kind: 'project', id: project.id },
      `Summary zadania montażowego musi zaczynać się od: "${VIDEO_EDIT_SUMMARY_OPENING}".`,
      `A video-editing summary must begin with: "${VIDEO_EDIT_SUMMARY_OPENING}".`,
    )]
  },
})

const refAssetLimits = defineRule({
  id: 'REF_ASSET_LIMITS',
  severity: 'error',
  guideRef: 'karta modelu — Ref2VA: 9 obrazów, 3 wideo, 3 audio',
  run: ({ project }) => {
    if (!isRef(project)) return []
    const limits: Array<[Project['assets'][number]['kind'], number]> =
      [['image', 9], ['video', 3], ['audio', 3]]
    return limits.flatMap(([kind, max]) => {
      const count = project.assets.filter(a => a.kind === kind).length
      if (count <= max) return []
      return [makeDiagnostic(
        refAssetLimits, { kind: 'project', id: project.id },
        `Tryb Ref2VA dopuszcza najwyżej ${max} assetów typu ${kind}, a jest ich ${count}.`,
        `Ref2VA allows at most ${max} ${kind} assets, but there are ${count}.`,
      )]
    })
  },
})

const refWordCount = defineRule({
  id: 'REF_WORD_COUNT',
  severity: 'hint',
  guideRef: 'guide_ref §5.2',
  run: ({ project }) => {
    if (!isRef(project)) return []
    const words = renderDetailedDescription(project).trim().split(/\s+/).filter(Boolean).length
    if (words >= MIN_WORDS && words <= MAX_WORDS) return []
    return [makeDiagnostic(
      refWordCount, { kind: 'project', id: project.id },
      `detailed_description ma ${words} słów — zalecany zakres to ${MIN_WORDS}–${MAX_WORDS}.`,
      `detailed_description has ${words} words — the recommended range is ${MIN_WORDS}–${MAX_WORDS}.`,
    )]
  },
})

const styleRequired = defineRule({
  id: 'STYLE_REQUIRED',
  severity: 'error',
  guideRef: 'guide_base §4.1, guide_ref §5.2',
  run: ({ project }) => {
    if (project.style.trim()) return []
    return [makeDiagnostic(
      styleRequired,
      { kind: 'project', id: project.id },
      'Każdy tryb wymaga podania stylu wizualnego — w trybach bazowych otwiera pierwsze ujęcie, w REF stoi w osobnej linii przed [Shot 1].',
      'Every mode requires a visual style — in base modes it opens the first shot, in REF it stands on its own line before [Shot 1].',
    )]
  },
})

const refNoNewLabelsInSummary = defineRule({
  id: 'REF_NO_NEW_LABELS_IN_SUMMARY',
  severity: 'error',
  guideRef: 'guide_ref §3',
  run: ({ project }) => {
    if (!isRef(project)) return []
    const defined = definedLabelTexts(project)
    const found = labelTokensIn(project.ref.summaryText)
    return [...new Set(found)]
      .filter(token => !defined.has(token))
      .map(token => makeDiagnostic(
        refNoNewLabelsInSummary, { kind: 'project', id: project.id },
        `summary wprowadza etykietę spoza subject_definitions: ${token}.`,
        `The summary introduces a label absent from subject_definitions: ${token}.`,
      ))
  },
})

export const refRules: Rule[] = [
  refLabelDefined, refLabelUsed, refRetentionComplete, refMarkerVocab,
  refNoSpeakerInRetention, refTaskTypes, refVideoEditOpening, refAssetLimits,
  refWordCount, styleRequired, refNoNewLabelsInSummary,
]
