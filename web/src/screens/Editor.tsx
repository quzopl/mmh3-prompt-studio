import { useEffect, useState } from 'react'
import { api } from '../api/client.js'
import { useProject } from '../store/projectStore.js'
import { usePlayhead } from '../store/playheadStore.js'
import { useCritic } from '../store/criticStore.js'
import { useAutosave } from '../store/useAutosave.js'
import { useT } from '../i18n/useT.js'
import { PromptPanel } from '../panels/PromptPanel.js'
import { ValidationPanel } from '../panels/ValidationPanel.js'
import { ProgramMonitor } from '../panels/ProgramMonitor.js'
import { Inspector } from '../panels/Inspector.js'
import { AssetBin } from '../panels/AssetBin.js'
import { ExportPanel } from '../panels/ExportPanel.js'
import { LlmPanel } from '../llm/LlmPanel.js'
import { Timeline } from '../timeline/Timeline.js'
import { useTimelineShortcuts } from '../timeline/useTimelineShortcuts.js'

interface Props {
  slug: string
  onClose: () => void
}

export function Editor({ slug, onClose }: Props) {
  const t = useT()
  const load = useProject(state => state.load)
  const project = useProject(state => state.project)
  const undo = useProject(state => state.undo)
  const redo = useProject(state => state.redo)
  // Długość historii, nie funkcja `canUndo` ze sklepu: getter ma stałą
  // referencję między wywołaniami `set`, więc subskrypcja na nim nigdy nie
  // wykryłaby zmiany (ten sam antywzorzec, co przy zaznaczeniu w zadaniach
  // 5 i 11). Same akcesory zniknęły — nie miały żadnego konsumenta.
  const canUndo = useProject(state => state.past.length > 0)
  const canRedo = useProject(state => state.future.length > 0)
  const [error, setError] = useState<string | null>(null)
  const { saving, error: saveError } = useAutosave(slug)
  useTimelineShortcuts()

  useEffect(() => {
    // Poprzedni projekt nie może wisieć w sklepie, kiedy montuje się edytor
    // kolejnego: gdyby `getProject` padło, autozapis miałby czym nadpisać
    // cudzy plik.
    useProject.setState({
      slug: null, project: null, prompt: '', tokens: [], diagnostics: [],
      past: [], future: [], dirty: false,
    })
    // Znacznik odtwarzania jest globalny dokładnie tak samo jak sklep projektu,
    // więc bez tego przenosił się między projektami: pozycja z dłuższego
    // materiału wypadała poza krótszym (pasek narzędzi pokazywał czas spoza
    // wideo, a `shotAtMs` oddawał ostatnie ujęcie jako to „pod znacznikiem"),
    // a przeniesione `playing` uruchamiało odtwarzanie, o które nikt nie
    // prosił — i pierwsza klatka pętli dosuwała nowy projekt do jego końca.
    usePlayhead.getState().reset()
    // Uwagi krytyka (zadanie 12) żyją w sklepie równie globalnym jak projekt
    // i znacznik odtwarzania — dokładnie ten sam błąd, co przy playheadzie
    // wyżej, gdyby tego brakło: uwagi wygenerowane dla poprzedniego projektu
    // (inny `id`, inne obiekty pod tymi samymi `ref`) przywitałyby użytkownika
    // w NOWYM projekcie, wskazując na obiekty, których tam nie ma (round 1
    // recenzji zadania 12). `isCriticStale` oznaczyłby je jako nieaktualne
    // dopiero PO wczytaniu nowego projektu (inna referencja), ale do tego
    // momentu — i tak zbyt długo — panel pokazywałby uwagi z cudzego projektu.
    useCritic.getState().clear()
    api.getProject(slug)
      .then(response => load(slug, response.project))
      .catch((err: Error) => setError(err.message))

    // Powrót do listy projektów tak samo nie może zostawić włączonego
    // odtwarzania, czasu spoza materiału ani uwag krytyka na wejście do
    // następnego edytora.
    return () => {
      usePlayhead.getState().reset()
      useCritic.getState().clear()
    }
  }, [slug, load])

  if (error) return <p className="p-6 text-red-400">{error}</p>
  if (!project) return <p className="p-6 text-neutral-400">{t('common.loading')}</p>

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-1 text-sm">
        <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-100">
          ← {t('projects.title')}
        </button>
        <span className="font-medium">{project.name}</span>
        <span className="font-mono text-xs text-neutral-500">{project.mode}</span>
        {saving && <span className="text-xs text-neutral-500">{t('common.loading')}</span>}
        {saveError && <span className="text-xs text-red-400">{saveError}</span>}
        <span className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className="rounded px-2 py-0.5 hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {t('editor.undo')}
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            className="rounded px-2 py-0.5 hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {t('editor.redo')}
          </button>
        </span>
      </div>
      <div className="grid flex-1 grid-cols-[200px_1fr_1fr_280px_320px] overflow-hidden divide-x divide-neutral-800">
        <AssetBin slug={slug} />
        <div className="flex flex-col divide-y divide-neutral-800 overflow-hidden">
          <ProgramMonitor />
          <PromptPanel />
        </div>
        <ValidationPanel />
        <div className="flex flex-col divide-y divide-neutral-800 overflow-auto">
          <Inspector />
          <ExportPanel slug={slug} />
        </div>
        <LlmPanel />
      </div>
      <div className="h-48 border-t border-neutral-800">
        <Timeline />
      </div>
    </div>
  )
}
