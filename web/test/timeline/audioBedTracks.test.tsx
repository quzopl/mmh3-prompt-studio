import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createScale } from '../../src/timeline/scale.js'
import { AudioBedTracks } from '../../src/timeline/AudioBedTracks.js'
import { useProject } from '../../src/store/projectStore.js'
import { useSelection } from '../../src/store/selectionStore.js'
import { baseProject, emptyShot } from './fixtures.js'

const scale = createScale(8000, 800, 1)

beforeEach(() => {
  useSelection.setState({ selected: [] })
  useProject.getState().load('test', {
    ...baseProject([emptyShot('a', 0, 0)]),
    audio: { overallSoundscape: 'deszcz o szyby', nonDiegeticMusic: '' },
  })
})

describe('AudioBedTracks', () => {
  it('rozciąga oba klipy na cały materiał', () => {
    render(<AudioBedTracks scale={scale} />)
    for (const name of [/pejzaż dźwiękowy całego wideo/i, /muzyka całego wideo/i]) {
      const clip = screen.getByRole('button', { name })
      expect(clip.style.left).toBe('0px')
      expect(clip.style.width).toBe('800px')
    }
  })

  it('pokazuje treść opisu na klipie', () => {
    render(<AudioBedTracks scale={scale} />)
    expect(screen.getByText('deszcz o szyby')).toBeTruthy()
  })

  it('pusty opis oznacza jako nieopisany, zamiast zostawiać pusty klip', () => {
    render(<AudioBedTracks scale={scale} />)
    expect(screen.getByText(/nie opisano/i)).toBeTruthy()
  })

  it('pusty opis niesie "nie opisano" także w nazwie dostępnej, nie tylko w treści widocznej', () => {
    // Klip muzyki jest pusty we fikstyrze wyżej — czytnik ekranu ma usłyszeć
    // to samo, co widzi osoba widząca na klipie, a nie stałą etykietę pasa
    // bez żadnej informacji o zawartości.
    render(<AudioBedTracks scale={scale} />)
    expect(screen.getByRole('button', { name: /muzyka całego wideo.*nie opisano/i })).toBeTruthy()
  })

  it('kliknięcie zaznacza pejzaż i muzykę osobno, identyfikatorem pola modelu', async () => {
    // `overallSoundscape`/`nonDiegeticMusic`, nie wymyślonym skrótem — to te
    // same identyfikatory, jakie diagnostyki `SOUNDSCAPE_*`/`MUSIC_*` w
    // `shared/src/validate/rules/audio.ts` już noszą w `{ kind: 'audio', id }`.
    // Wymyślony skrót rozjechałby się z `diagnostic.ref`, przez co klik w
    // diagnostykę w panelu walidacji (`select(diagnostic.ref)`) nigdy nie
    // podświetliłby klipu na tej ścieżce.
    const user = userEvent.setup()
    render(<AudioBedTracks scale={scale} />)
    await user.click(screen.getByRole('button', { name: /pejzaż dźwiękowy całego wideo/i }))
    expect(useSelection.getState().selected).toEqual([{ kind: 'audio', id: 'overallSoundscape' }])
    await user.click(screen.getByRole('button', { name: /muzyka całego wideo/i }))
    expect(useSelection.getState().selected).toEqual([{ kind: 'audio', id: 'nonDiegeticMusic' }])
  })

  it('kliknięcie z Shiftem dokłada do zaznaczenia zamiast je zastępować', async () => {
    // Ta sama konwencja co w `CameraTrack`/`DialogueTracks`/`ScreenTextTrack` —
    // Shift+klik musi działać identycznie na każdej ścieżce klipów, bo
    // późniejsze kasowanie wielu zaznaczonych obiektów naraz zakłada spójne
    // zachowanie wszędzie.
    const user = userEvent.setup()
    render(<AudioBedTracks scale={scale} />)
    await user.click(screen.getByRole('button', { name: /pejzaż dźwiękowy całego wideo/i }))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('button', { name: /muzyka całego wideo/i }))
    await user.keyboard('{/Shift}')
    expect(useSelection.getState().selected).toEqual([
      { kind: 'audio', id: 'overallSoundscape' },
      { kind: 'audio', id: 'nonDiegeticMusic' },
    ])
  })

  it('korzeń każdego pasa niesie `data-track`', () => {
    render(<AudioBedTracks scale={scale} />)
    expect(document.querySelector('[data-track="audio-soundscape"]')).toBeTruthy()
    expect(document.querySelector('[data-track="audio-music"]')).toBeTruthy()
  })
})
