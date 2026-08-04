import type { Mode } from '@mmh3/shared'
import { MODE_INFO, MODE_ORDER } from '../i18n/modes.js'
import { useLang, useT } from '../i18n/useT.js'

interface Props {
  onPick: (mode: Mode) => void
}

export function ModePicker({ onPick }: Props) {
  const t = useT()
  const lang = useLang(state => state.lang)

  return (
    <section className="p-6">
      <h2 className="mb-4 text-lg font-semibold">{t('mode.pick')}</h2>
      <div className="grid gap-3 lg:grid-cols-5">
        {MODE_ORDER.map(mode => {
          const info = MODE_INFO[mode][lang]
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onPick(mode)}
              className="flex flex-col gap-2 rounded border border-neutral-800 bg-neutral-900 p-4 text-left hover:border-neutral-600"
            >
              <span className="font-mono text-xs text-neutral-400">{mode}</span>
              <span className="font-medium">{info.title}</span>
              <Row label={t('mode.whatYouGive')} value={info.give} />
              <Row label={t('mode.anchor')} value={info.anchor} />
              <Row label={t('mode.whenToUse')} value={info.when} />
              <Row label={t('mode.note')} value={info.note} />
            </button>
          )
        })}
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-sm">
      <span className="block text-xs uppercase tracking-wide text-neutral-500">{label}</span>
      <span className="text-neutral-300">{value}</span>
    </span>
  )
}
