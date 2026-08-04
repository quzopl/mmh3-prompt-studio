import type { Mode } from '@mmh3/shared'
import type { Lang } from './dict.js'

export interface ModeInfo {
  title: string
  give: string
  anchor: string
  when: string
  note: string
}

export const MODE_ORDER: Mode[] = ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REF']

export const MODE_INFO: Record<Mode, Record<Lang, ModeInfo>> = {
  T2VA: {
    pl: {
      title: 'Tekst → wideo',
      give: 'Sam tekst. Żadnych plików referencyjnych.',
      anchor: 'Brak kotwicy — cała oś czasu powstaje z opisu.',
      when: 'Masz pełną swobodę i budujesz ujęcia od zera.',
      note: 'Jedyny tryb bez linii alignmentu na początku promptu.',
    },
    en: {
      title: 'Text → video',
      give: 'Text alone. No reference files.',
      anchor: 'No anchor — the whole timeline is built from the description.',
      when: 'You have a free hand and are building the shots from scratch.',
      note: 'The only mode without an alignment line at the top of the prompt.',
    },
  },
  I2VA: {
    pl: {
      title: 'Pierwsza klatka → wideo',
      give: 'Jeden obraz, który staje się kadrem otwarcia.',
      anchor: '<Picture 1> to dokładnie klatka 0.00 sekundy w pierwszym ujęciu.',
      when: 'Masz gotowy kadr otwarcia i chcesz rozwinąć go do przodu.',
      note: 'Tożsamość postaci, ubiór, kolory i relacje przestrzenne muszą zostać zachowane.',
    },
    en: {
      title: 'First frame → video',
      give: 'One image that becomes the opening frame.',
      anchor: '<Picture 1> is exactly the 0.00-second frame of the first shot.',
      when: 'You have an opening frame and want to develop it forward.',
      note: 'Character identity, clothing, colours and spatial relationships must be preserved.',
    },
  },
  FL2VA: {
    pl: {
      title: 'Pierwsza i ostatnia klatka → wideo',
      give: 'Dwa obrazy: początek i koniec.',
      anchor: 'Picture 1 na 0.00 sekundy, Picture 2 na końcu wideo.',
      when: 'Znasz oba końce i chodzi o drogę między nimi.',
      note: 'Guide preferuje tutaj pojedyncze ujęcie, żeby model mógł interpolować płynnie.',
    },
    en: {
      title: 'First and last frame → video',
      give: 'Two images: the start and the end.',
      anchor: 'Picture 1 at 0.00 seconds, Picture 2 at the end of the video.',
      when: 'You know both ends and the point is the path between them.',
      note: 'The guide prefers a single shot here so the model can interpolate smoothly.',
    },
  },
  L2VA: {
    pl: {
      title: 'Ostatnia klatka → wideo',
      give: 'Jeden obraz, który staje się kadrem końcowym.',
      anchor: '<Picture 1> należy do ostatniego ujęcia, nie do pierwszego.',
      when: 'Znasz pointę i dobudowujesz to, co ją poprzedziło.',
      note: 'Opis musi stopniowo zbiegać się do kadru referencyjnego w ostatnim ujęciu.',
    },
    en: {
      title: 'Last frame → video',
      give: 'One image that becomes the closing frame.',
      anchor: '<Picture 1> belongs to the last shot, not the first.',
      when: 'You know the punchline and are building up to it.',
      note: 'The description must converge on the reference frame in the final shot.',
    },
  },
  REF: {
    pl: {
      title: 'Pełne referencje',
      give: 'Do dziewięciu obrazów, trzech klipów wideo i trzech audio.',
      anchor: 'Etykiety <Subject>, <Picture>, <Video> i <Audio> wiążą materiał z treścią.',
      when: 'Zależy Ci na spójności postaci, montażu, kontynuacji albo barwie głosu.',
      note: 'Sześć sekcji zamiast trzech, a opis szczegółowy liczy 350–500 słów.',
    },
    en: {
      title: 'Full reference',
      give: 'Up to nine images, three video clips and three audio clips.',
      anchor: '<Subject>, <Picture>, <Video> and <Audio> labels bind the material to the content.',
      when: 'You need character consistency, editing, continuation or voice timbre.',
      note: 'Six sections instead of three, and the detailed description runs 350–500 words.',
    },
  },
}
