import { useRef, useState } from 'react'
import { describeSpeaker, type Asset, type Label, type LabelKind, type Speaker } from '@mmh3/shared'
import { useProject } from '../store/projectStore.js'
import { useT } from '../i18n/useT.js'
import { uploadAsset } from '../api/uploadAsset.js'

const LABEL_KIND_BY_ASSET: Record<Asset['kind'], LabelKind> = {
  image: 'picture',
  video: 'video',
  audio: 'audio',
}

const LABEL_NAME: Record<LabelKind, string> = {
  subject: 'Subject', picture: 'Picture', video: 'Video', audio: 'Audio',
}

export function AssetBin({ slug }: { slug: string }) {
  const t = useT()
  const project = useProject(state => state.project)
  const apply = useProject(state => state.apply)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  if (!project) return null

  // Projekt zwrócony przez serwer powstał z odczytu `project.json`, więc nie zna
  // zmian czekających jeszcze w oknie opóźnienia autozapisu. `load` skasowałoby
  // je razem z historią cofania i znacznikiem zmiany — wstawiamy więc sam asset
  // do projektu, który klient już trzyma.
  const pickFile = async (file: File) => {
    setError(null)
    try {
      const { asset } = await uploadAsset(slug, file)
      apply(current => ({ ...current, assets: [...current.assets, asset] }))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const addLabel = (asset: Asset) => apply(current => {
    const kind = LABEL_KIND_BY_ASSET[asset.kind]
    const nextIndex = current.labels.filter(label => label.kind === kind).length + 1
    const label: Label = {
      id: `label-${kind}-${nextIndex}`,
      kind,
      index: nextIndex,
      assetIds: [asset.id],
      definition: '',
      role: '',
      standalone: true,
    }
    return { ...current, labels: [...current.labels, label] }
  })

  const addSpeaker = () => apply(current => {
    const code = `S${current.speakers.length + 1}`
    const speaker: Speaker = {
      id: `speaker-${code}`,
      code,
      characterType: '', age: '', gender: '', pitch: '', timbre: '', rate: '', accent: '',
      onScreen: true, fullDescriptor: '', shortDescriptor: '',
    }
    return { ...current, speakers: [...current.speakers, speaker] }
  })

  const regenerate = (speaker: Speaker) => apply(current => ({
    ...current,
    speakers: current.speakers.map(candidate => {
      if (candidate.id !== speaker.id) return candidate
      const described = describeSpeaker(candidate)
      return { ...candidate, fullDescriptor: described.full, shortDescriptor: described.short }
    }),
  }))

  return (
    <section aria-label={t('editor.assets')} className="flex h-full flex-col gap-4 overflow-auto p-3">
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-neutral-500">{t('editor.assets')}</span>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:border-neutral-500"
          >
            +
          </button>
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0]
              if (file) void pickFile(file)
            }}
          />
        </div>
        <ul className="flex flex-col gap-1">
          {project.assets.map(asset => (
            <li key={asset.id} className="flex items-center gap-2 text-sm">
              <span className="font-mono text-[10px] text-neutral-500">{asset.kind}</span>
              <span className="flex-1 truncate">{asset.fileName}</span>
              <button
                type="button"
                onClick={() => addLabel(asset)}
                aria-label={t('editor.makeLabel')}
                className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] hover:border-neutral-500"
              >
                {'<>'}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <span className="mb-2 block text-xs uppercase tracking-wide text-neutral-500">
          {t('editor.labels')}
        </span>
        <ul className="flex flex-col gap-1 font-mono text-xs">
          {project.labels.map(label => (
            <li key={label.id}>{`<${LABEL_NAME[label.kind]} ${label.index}>`}</li>
          ))}
        </ul>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-neutral-500">{t('editor.speakers')}</span>
          <button
            type="button"
            onClick={addSpeaker}
            className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:border-neutral-500"
          >
            {t('editor.addSpeaker')}
          </button>
        </div>
        <ul className="flex flex-col gap-1 text-sm">
          {project.speakers.map(speaker => (
            <li key={speaker.id} className="flex items-center gap-2">
              <span className="font-mono text-xs">({speaker.code})</span>
              <span className="flex-1 truncate text-neutral-400">
                {speaker.fullDescriptor || '—'}
              </span>
              <button
                type="button"
                onClick={() => regenerate(speaker)}
                className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] hover:border-neutral-500"
              >
                ↻
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
