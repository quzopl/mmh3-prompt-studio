import { describe, it, expect } from 'vitest'
import { applyOps, buildPrompt } from '@mmh3/shared'
import { cleanProject } from '../../fixtures/cleanProject.js'
import { fieldChatToPatch } from '../../../src/llm/tasks/fieldChat.js'
import type { RedactTarget } from '../../../src/llm/tasks/fieldTarget.js'

/**
 * Reguła wiążąca całego projektu: akcja interfejsu nie może wyprodukować
 * diagnostyki walidatora na projekcie, który jej nie miał. Lista wyjątków
 * pochodzi z `docs/superpowers/specs/2026-08-04-uwagi-do-planu-2.md` — to
 * reguły, których zapalenie jest uczciwą informacją zwrotną, nie usterką.
 *
 * UWAGA na pułapkę, która w tym repo już raz uczyniła taki test bezczynnym
 * (plan 5, zadanie 6): reguły rejestrują się WYŁĄCZNIE jako efekt uboczny
 * `buildPrompt`. Test wołający `validate`/`compile` wprost dostaje dwa puste
 * zbiory i nie potrafi paść — recenzent usunął wtedy cały segment ciała ujęcia
 * i 10 z 10 asercji zostało zielonych.
 */

const ACCEPTED = new Set([
  'SPEECH_FITS',
  'SOUNDSCAPE_NA_ONLY_IF_SILENT',
  'SPEAKER_SILENT_NO_ID',
  'FL2VA_PREFER_SINGLE_SHOT',
  'MUSIC_NO_MOOD_WORDS',
  'SOUNDSCAPE_NO_DIALOGUE',
])

const unexpected = (project: Parameters<typeof buildPrompt>[0]): string[] =>
  buildPrompt(project).diagnostics.map(d => d.ruleId).filter(id => !ACCEPTED.has(id))

const style: RedactTarget = { kind: 'style' }

describe('reguła wiążąca — rozmowa o polu', () => {
  it('operacja z rozmowy nie zapala nowej diagnostyki na projekcie, który jej nie miał', () => {
    const project = { ...cleanProject(), style: 'Live-action, cinematic realism' }
    // Baza musi być czysta, inaczej test nie mierzy niczego: na projekcie z
    // zapaloną regułą „nie przybyło nowych" przechodzi także wtedy, gdy
    // operacja psuje coś, co i tak już było zepsute.
    expect(unexpected(project)).toEqual([])

    const patch = fieldChatToPatch(
      { reply: 'ok', english: 'Live-action, cinematic realism, cold rain-lit streets' },
      style,
      project,
    )
    expect(patch.ops).toHaveLength(1)
    expect(unexpected(applyOps(project, patch.ops))).toEqual([])
  })

  it('kontrola samego testu: zepsute pole NAPRAWDĘ zapala regułę spoza wyjątków', () => {
    // Ta asercja nie sprawdza rozmowy — sprawdza `unexpected`. Gdyby liczyło z
    // pustego zbioru reguł (usterka, która w tym repo naprawdę wystąpiła: reguły
    // rejestrują się wyłącznie jako efekt uboczny `buildPrompt`), poprzedni test
    // przechodziłby zawsze, także dla operacji psującej projekt.
    //
    // Pole audio, nie styl: blok `<d>` jest pilnowany tam, a nie w stylu —
    // pierwsza wersja tej kontroli wstawiała go do stylu i nie zapalała niczego,
    // czyli sama była bezczynna.
    const broken = applyOps(cleanProject(), [{
      kind: 'setAudio', id: 'op-x', label: 'test', field: 'overallSoundscape',
      text: 'One. Two. Three. Four. Five.',
    }])
    expect(unexpected(broken).length).toBeGreaterThan(0)
  })
})
