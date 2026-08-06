import type { Project, Speaker } from '@mmh3/shared'
import { newProject } from './newProject.js'

/**
 * Projekt BEZ ŻADNEJ diagnostyki błędu — jedyna baza, na której „nie przybyło
 * nowych diagnostyk" jest niezerowym testem. Na projekcie z już zapaloną regułą
 * taka asercja przechodzi także wtedy, gdy sprawdzana akcja psuje coś, co i tak
 * było zepsute.
 *
 * Mieszka w atrapach, a nie w jednym pliku testowym, bo potrzebuje go każdy
 * test niezmiennika: podpowiedź audio (`audio.test.ts`) i rozmowa o polu
 * (`fieldChatBinding.test.ts`). Dwie kopie tego samego „czystego projektu"
 * rozjeżdżają się przy pierwszej zmianie reguł walidatora — a wtedy jeden z
 * testów po cichu przestaje pilnować czegokolwiek.
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
function buildCleanProject(): Project {
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

export { speaker as cleanSpeaker, buildCleanProject as cleanProject }
