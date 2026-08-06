import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PatchOp, Project } from '@mmh3/shared'
import { audioFieldTextSchema, MUSIC_TEXT_RULE, SOUNDSCAPE_TEXT_RULE } from './audioFieldText.js'

/**
 * Cztery rodzaje celu redakcji — po jednym na operację, którą `redactToPatch`
 * umie wyprodukować. Zamknięta unia wyprowadzona z Zoda: `routes/llm.ts`
 * waliduje nią ciało żądania, a `redactToPatch` dostaje już zawężony,
 * bezpieczny typ. Brak piątego wariantu dla dialogu jest tu strukturalny, nie
 * umowny — patrz komentarz nad `RedactSchema`.
 */
export const RedactTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('style') }),
  z.object({
    kind: z.literal('shotText'),
    shotId: z.string().min(1),
    segmentIndex: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal('audio'),
    field: z.enum(['overallSoundscape', 'nonDiegeticMusic']),
  }),
  z.object({
    kind: z.literal('speaker'),
    speakerId: z.string().min(1),
    field: z.enum(['fullDescriptor', 'shortDescriptor']),
  }),
])

export type RedactTarget = z.infer<typeof RedactTargetSchema>

/**
 * Bieżąca treść pola, na które wskazuje `target` — albo `undefined`, gdy cel
 * nie istnieje w ogóle (brak ujęcia/mówcy o tym id) LUB, dla `shotText`,
 * istnieje pod tym indeksem, ale nie jest segmentem tekstowym. Zwykłe
 * indeksowanie `shot.body[index]` już samo odrzuca indeksy ujemne i ułamkowe
 * (nie są prawidłowymi kluczami tablicy w JS) — nie potrzeba tu osobnej
 * straży, jaką ma `segmentAt` w `shared/src/patch/segment.ts` (moduł
 * wewnętrzny pakietu, nieeksportowany z `@mmh3/shared`).
 *
 * Eksportowana: `routes/llm.ts` używa jej wprost, żeby zbudować `RedactInput`
 * z AKTUALNEGO stanu projektu na dysku — ten sam odczyt, którego
 * `redactToPatch` użyje do porównania „czy wynik faktycznie coś zmienia",
 * więc obie strony patrzą na dokładnie tę samą wartość.
 */
export function redactSourceText(project: Project, target: RedactTarget): string | undefined {
  switch (target.kind) {
    case 'style':
      return project.style
    case 'audio':
      return project.audio[target.field]
    case 'speaker': {
      const speaker = project.speakers.find(s => s.id === target.speakerId)
      return speaker?.[target.field]
    }
    case 'shotText': {
      const shot = project.shots.find(s => s.id === target.shotId)
      if (shot === undefined) return undefined
      const segment = shot.body[target.segmentIndex]
      return segment?.kind === 'text' ? segment.text : undefined
    }
  }
}

/**
 * Reguła „co wolno treści przeznaczonej na TO pole" — jedna definicja, którą
 * importuje KAŻDE zadanie zdolne zapisać pole projektu. Wcześniej mieszkała
 * wewnątrz `redactSchemaFor` w `redact.ts`, więc kolejne zadanie piszące do
 * tych samych pól (czat) musiałoby ją powtórzyć — dokładnie ta sytuacja, z
 * której powstał `audioFieldText.ts` (trzy zadania, to samo pole, trzy drogi).
 *
 * Zwraca schemat SAMEGO TEKSTU, nie obiektu odpowiedzi: każde zadanie
 * opakowuje go we własny kształt (`{ english }` w redakcji,
 * `{ reply, english? }` w czacie), a wspólna zostaje reguła treści.
 */
export function fieldTextSchema(target: RedactTarget): z.ZodType<string> {
  if (target.kind !== 'audio') return z.string()
  return audioFieldTextSchema(
    target.field === 'overallSoundscape' ? SOUNDSCAPE_TEXT_RULE : MUSIC_TEXT_RULE,
  )
}

/**
 * Operacja zapisująca `text` do pola wskazanego przez `target`. Etykieta jest
 * PARAMETREM, nie stałą: redakcja opisuje siebie jako tłumaczenie PL→EN, a
 * rozmowa jako zmianę z rozmowy — ta sama operacja, dwa różne uzasadnienia na
 * ekranie przeglądu.
 */
export function fieldOp(target: RedactTarget, text: string, label: string): PatchOp {
  const id = `op-${randomUUID()}`
  switch (target.kind) {
    case 'style':
      return { kind: 'setStyle', id, label, text }
    case 'audio':
      return { kind: 'setAudio', id, label, field: target.field, text }
    case 'speaker':
      return {
        kind: 'setSpeakerDescriptor', id, label,
        speakerId: target.speakerId, field: target.field, text,
      }
    case 'shotText':
      return {
        kind: 'setShotText', id, label,
        shotId: target.shotId, segmentIndex: target.segmentIndex, text,
      }
  }
}
