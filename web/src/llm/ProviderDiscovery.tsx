import { useState } from 'react'
import { useT } from '../i18n/useT.js'
import { ActionButton } from './ActionButton.js'
import { settingsApi, type FoundProvider } from './settingsApi.js'

/**
 * Skan lokalnych serwerów modeli. Jeśli użytkownik ma już Ollamę albo LM
 * Studio, nie ma powodu, żeby cokolwiek pobierał ani wpisywał adres z
 * pamięci — wystarczy jedno kliknięcie.
 */
export function ProviderDiscovery({ onPick }: { onPick: (baseUrl: string) => void }) {
  const t = useT()
  const [state, setState] = useState<'idle' | 'scanning' | 'done'>('idle')
  const [found, setFound] = useState<FoundProvider[]>([])

  const scan = (): void => {
    setState('scanning')
    void settingsApi.discover()
      .then(res => { setFound(res.found); setState('done') })
      // Nieudany skan kończy się pustą listą, nie komunikatem błędu: „nic nie
      // znalazłem" i „nie udało mi się poszukać" prowadzą użytkownika do tego
      // samego następnego kroku — skonfigurować dostawcę samemu.
      .catch(() => { setFound([]); setState('done') })
  }

  return (
    <div className="mb-2 flex flex-col gap-1">
      <ActionButton
        label={state === 'scanning' ? t('llm.discoverScanning') : t('llm.discoverScan')}
        onClick={scan}
        disabled={state === 'scanning'}
      />
      {state === 'done' && found.length === 0 && (
        <span className="text-[11px] text-neutral-500">{t('llm.discoverNone')}</span>
      )}
      {found.map(provider => (
        <div key={provider.baseUrl} className="flex items-center justify-between gap-2 text-[11px]">
          <span className="truncate">{provider.kind} · {provider.baseUrl}</span>
          <span className="shrink-0 text-neutral-500">
            {t('llm.discoverModels', { count: provider.models.length })}
          </span>
          <ActionButton label={t('llm.discoverUse')} onClick={() => onPick(provider.baseUrl)} />
        </div>
      ))}
    </div>
  )
}
