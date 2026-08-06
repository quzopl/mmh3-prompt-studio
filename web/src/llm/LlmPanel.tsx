import { useEffect, useState, type ReactNode } from 'react'
import { useProject } from '../store/projectStore.js'
import { useCritic } from '../store/criticStore.js'
import { useLang, useT, type Translate } from '../i18n/useT.js'
import {
  settingsApi, type LlmMode, type LlmSettings, type ManagedState, type UnloadCapability,
} from './settingsApi.js'
import { useLlmRun, type LlmRunRequest } from './useLlmRun.js'
import { PatchReview } from './PatchReview.js'
import { FieldChat } from './FieldChat.js'
import { ActionButton, LabelledField as Field, inputClass } from './ActionButton.js'

const MODES: LlmMode[] = ['off', 'endpoint', 'managed']

const MODE_LABEL: Record<LlmMode, (t: Translate) => string> = {
  off: t => t('llm.modeOff'),
  endpoint: t => t('llm.modeEndpoint'),
  managed: t => t('llm.modeManaged'),
}

const MANAGED_STATE_LABEL: Record<ManagedState['status'], (t: Translate) => string> = {
  stopped: t => t('llm.managedStateStopped'),
  starting: t => t('llm.managedStateStarting'),
  ready: t => t('llm.managedStateReady'),
  failed: t => t('llm.managedStateFailed'),
}

/** Podpowiedź przy przycisku „Zwolnij pamięć karty" mówi konkretnie, co się
 * stanie u WYKRYTEGO dostawcy — żaden sposób nie jest uniwersalny (brief
 * zadania 14), więc jedno ogólne zdanie dla wszystkich by kłamało. `null`
 * (możliwość jeszcze nie wykryta) dzieli tekst z `'none'`, bo w obu
 * przypadkach przycisk jest i tak nieaktywny. */
const UNLOAD_HINT: Record<UnloadCapability, (t: Translate) => string> = {
  managed: t => t('llm.unloadManaged'),
  ollama: t => t('llm.unloadOllama'),
  lmstudio: t => t('llm.unloadLmStudio'),
  none: t => t('llm.unloadUnsupported'),
}

/** Cel redakcji — podzbiór `RedactTarget` z `server/src/llm/tasks/redact.ts`.
 * Wariant `shotText` (redakcja pojedynczego segmentu ujęcia) celowo zostaje
 * poza tym panelem: wymaga wyboru konkretnego ujęcia i indeksu segmentu, co
 * należy do inspektora ujęcia (poza plikami tego zadania), nie do panelu
 * dostawcy. Pozostałe trzy warianty nie potrzebują żadnego innego kontekstu
 * niż projekt już wczytany w `useProject`. Zapisane jako dług — punkt 20,
 * `docs/superpowers/specs/2026-08-04-uwagi-do-planu-2.md`. */
type RedactTarget =
  | { kind: 'style' }
  | { kind: 'audio'; field: 'overallSoundscape' | 'nonDiegeticMusic' }
  | { kind: 'speaker'; speakerId: string; field: 'fullDescriptor' | 'shortDescriptor' }

interface RedactOption {
  value: string
  label: string
  target: RedactTarget
}

function redactOptions(t: Translate, speakers: { id: string; code: string }[]): RedactOption[] {
  const options: RedactOption[] = [
    { value: 'style', label: t('llm.redactStyle'), target: { kind: 'style' } },
    {
      value: 'audio:overallSoundscape',
      label: t('llm.redactSoundscape'),
      target: { kind: 'audio', field: 'overallSoundscape' },
    },
    {
      value: 'audio:nonDiegeticMusic',
      label: t('llm.redactMusic'),
      target: { kind: 'audio', field: 'nonDiegeticMusic' },
    },
  ]
  for (const speaker of speakers) {
    options.push({
      value: `speaker:${speaker.id}:fullDescriptor`,
      label: t('llm.redactSpeakerFull', { code: speaker.code }),
      target: { kind: 'speaker', speakerId: speaker.id, field: 'fullDescriptor' },
    })
    options.push({
      value: `speaker:${speaker.id}:shortDescriptor`,
      label: t('llm.redactSpeakerShort', { code: speaker.code }),
      target: { kind: 'speaker', speakerId: speaker.id, field: 'shortDescriptor' },
    })
  }
  return options
}


const toInt = (raw: string, previous: number): number => {
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : previous
}

/** Draft formularza ustawień — pola tekstowe/numeryczne jako `string`, żeby
 * pole liczbowe dało się chwilowo wyczyścić w trakcie pisania, tak jak
 * `CutTimeField` w `Inspector.tsx`. Klucz API NIE jest tu inicjalizowany z
 * odpowiedzi serwera pod żadnym warunkiem — `GET` redaguje go do pustego
 * ciągu, a nawet gdyby kiedyś tego nie zrobił, panel i tak nie ma wiązać pola
 * z niczym, co przyszło z sieci: puste pole zawsze znaczy „bez zmian". */
interface Draft {
  mode: LlmMode
  baseUrl: string
  apiKey: string
  model: string
  serverBinary: string
  modelPath: string
  gpuLayers: string
  contextSize: string
}

const draftFrom = (settings: LlmSettings): Draft => ({
  mode: settings.mode,
  baseUrl: settings.endpoint.baseUrl,
  apiKey: '',
  model: settings.endpoint.model,
  serverBinary: settings.managed.serverBinary,
  modelPath: settings.managed.modelPath,
  gpuLayers: String(settings.managed.gpuLayers),
  contextSize: String(settings.managed.contextSize),
})

const EMPTY_DRAFT: Draft = {
  mode: 'off', baseUrl: '', apiKey: '', model: '',
  serverBinary: '', modelPath: '', gpuLayers: '0', contextSize: '8192',
}

export function LlmPanel() {
  const t = useT()
  const slug = useProject(state => state.slug)
  // Uwagi krytyka czyta wyłącznie człowiek — mają być w języku interfejsu.
  const lang = useLang(state => state.lang)
  const project = useProject(state => state.project)
  const run = useLlmRun()

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  // Ustawienia ZAPISANE na serwerze — osobno od brudnopisu formularza
  // (`draft`), bo tylko one mówią, czym serwer naprawdę dysponuje. Recenzja
  // końcowa gałęzi, punkt 4: `configured` liczyło gałąź endpointu z
  // NIEZAPISANEGO brudnopisu, a gałąź trybu zarządzanego ze stanu z serwera —
  // jeden znak wpisany w adres odblokowywał pięć przycisków zadań i chował
  // ostrzeżenie „Model nie jest skonfigurowany", choć serwer nie miał żadnych
  // ustawień. Kliknięcie kończyło się wtedy odpowiedzią 409, więc nic się nie
  // psuło — ale interfejs twierdził nieprawdę.
  const [saved, setSaved] = useState<LlmSettings | null>(null)
  const [managed, setManaged] = useState<ManagedState | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Stan zarządzanego serwera jest osobnym zapytaniem od ustawień — jego
  // porażka (serwer padł, sieć odcięta) dostaje WŁASNY komunikat w miejscu,
  // gdzie stan by się pokazał, zamiast po cichu zostawiać kreskę bez
  // wyjaśnienia. Fix round 1/5: cisza w tym miejscu wyglądała tak samo jak
  // „serwer zatrzymany", więc użytkownik nie miał jak odróżnić dwóch
  // zupełnie różnych sytuacji.
  const [managedStateError, setManagedStateError] = useState<string | null>(null)
  const [managedError, setManagedError] = useState<string | null>(null)
  const [managedBusy, setManagedBusy] = useState(false)
  // `null` = jeszcze nie wykryto (albo wykrywanie zawiodło) — przycisk
  // zostaje nieaktywny tak samo jak przy `'none'`, ale bez udawania, że to
  // już rozstrzygnięty brak możliwości.
  const [unloadCapability, setUnloadCapability] = useState<UnloadCapability | null>(null)
  const [unloadBusy, setUnloadBusy] = useState(false)
  const [unloadMessage, setUnloadMessage] = useState<string | null>(null)
  const [unloadError, setUnloadError] = useState<string | null>(null)
  // Potwierdzenie po kliknięciu „Wyczyść klucz" — bez niego użytkownik nie ma
  // jak się upewnić, że coś się w ogóle stało: pole było puste PRZED
  // wyczyszczeniem tak samo, jak jest puste po nim (fix round 1/5, punkt 1).
  const [keyCleared, setKeyCleared] = useState(false)

  const [ideaA, setIdeaA] = useState('')
  const [ideaB, setIdeaB] = useState('')
  const speakers = project?.speakers ?? []
  const redactChoices = redactOptions(t, speakers)
  const [redactValue, setRedactValue] = useState(redactChoices[0]?.value ?? 'style')
  const [chatTarget, setChatTarget] = useState<RedactTarget | null>(null)

  useEffect(() => {
    let cancelled = false
    // Odczyt przy montowaniu NIE MOŻE zostawić nieobsłużonego odrzucenia
    // obietnicy — sieć bywa niedostępna (serwer padł, offline), a aplikacja
    // ma działać w pełni bez skonfigurowanego modelu. Panel po prostu
    // zostaje przy trybie wyłączonym i pokazuje komunikat, zamiast wywracać
    // resztę aplikacji efektem ubocznym nieudanego zapytania.
    settingsApi.getSettings()
      .then(settings => {
        if (cancelled) return
        setDraft(draftFrom(settings))
        setSaved(settings)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(error instanceof Error ? error.message : String(error))
      })
    settingsApi.getManagedState()
      .then(state => { if (!cancelled) setManaged(state) })
      .catch((error: unknown) => {
        if (cancelled) return
        setManagedStateError(error instanceof Error ? error.message : String(error))
      })
    // Wykrywanie możliwości zwolnienia pamięci to operacja pomocnicza — sieć
    // niedostępna zostawia przycisk po prostu nieaktywnym (`null`), bez
    // osobnego komunikatu błędu; nikt nie traci przez to reszty panelu.
    settingsApi.getUnloadCapability()
      .then(res => { if (!cancelled) setUnloadCapability(res.capability) })
      .catch(() => { if (!cancelled) setUnloadCapability(null) })
    return () => { cancelled = true }
  }, [])

  /**
   * Uwagi krytyka (zadanie 12) trafiają do `useCritic` stąd, jedynego miejsca,
   * które woła zadanie „critic" i widzi jego wynik. Zależność WYŁĄCZNIE od
   * `run.notes` — NIE od `project` — jest rozmyślna: `run.notes` zmienia
   * referencję tylko wtedy, gdy zadanie faktycznie się zakończy nowym
   * wynikiem (`setNotes` w `useLlmRun`), a projekt czytamy w tej chwili przez
   * `getState()`, nie jako reaktywną zależność. Gdyby `project` był w
   * tablicy zależności, KAŻDA późniejsza edycja projektu odpaliłaby ten efekt
   * ponownie i podmieniła `capturedProject` w `useCritic` na świeżą
   * referencję — te same (już nieaktualne) uwagi wyglądałyby znów jak
   * aktualne, co dokładnie niweczy oznaczanie nieaktualności w panelu
   * walidacji.
   */
  useEffect(() => {
    if (run.notes === null) return
    const currentProject = useProject.getState().project
    if (currentProject === null) return
    useCritic.getState().setNotes(run.notes, currentProject)
  }, [run.notes])

  const busy = run.status === 'running'

  // Obie połowy tego wyrażenia czytają JEDNO źródło prawdy — ustawienia
  // zapisane na serwerze (`saved`), nie brudnopis formularza. Póki `saved`
  // jest `null` (odczyt trwa albo padł), dostawca jest nieskonfigurowany:
  // serwer i tak odmówiłby uruchomienia zadania.
  const configured = saved === null
    ? false
    : saved.mode === 'endpoint'
      ? saved.endpoint.baseUrl.trim() !== ''
      : saved.mode === 'managed'
        ? managed?.status === 'ready'
        : false

  const tasksEnabled = configured && slug !== null && !busy

  // Wyładowanie modelu w połowie generowania to gwarantowany błąd — przycisk
  // ma być nieaktywny, dopóki jakiekolwiek zadanie biegnie, tak samo jak
  // reszta formularza ustawień. `null`/`'none'` znaczą „nie ma czego zawołać".
  const unloadDisabled = busy || unloadBusy || unloadCapability === null || unloadCapability === 'none'

  const saveSettings = async (): Promise<void> => {
    setSaveError(null)
    setKeyCleared(false)
    try {
      const next = await settingsApi.putSettings({
        mode: draft.mode,
        endpoint: { baseUrl: draft.baseUrl, apiKey: draft.apiKey, model: draft.model },
        managed: {
          serverBinary: draft.serverBinary,
          modelPath: draft.modelPath,
          gpuLayers: toInt(draft.gpuLayers, 0),
          contextSize: toInt(draft.contextSize, 8192),
        },
      })
      setDraft(draftFrom(next))
      setSaved(next)
      // Zapisany dostawca mógł się zmienić (tryb, adres) — możliwość
      // zwolnienia pamięci zależy od NIEGO, więc odświeżamy ją razem z
      // ustawieniami, inaczej podpowiedź przy przycisku kłamałaby o
      // poprzednim dostawcy.
      settingsApi.getUnloadCapability()
        .then(res => setUnloadCapability(res.capability))
        .catch(() => setUnloadCapability(null))
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }

  const startManagedServer = async (): Promise<void> => {
    setManagedError(null)
    setManagedBusy(true)
    try {
      setManaged(await settingsApi.startManaged())
      // Świeży stan właśnie przyszedł — jeśli poprzedni odczyt przy
      // montowaniu padł, ten udany zastępuje go, więc stary komunikat błędu
      // nie ma już czego opisywać.
      setManagedStateError(null)
    } catch (error) {
      setManagedError(error instanceof Error ? error.message : String(error))
    } finally {
      setManagedBusy(false)
    }
  }

  const stopManagedServer = async (): Promise<void> => {
    setManagedError(null)
    setManagedBusy(true)
    try {
      setManaged(await settingsApi.stopManaged())
      setManagedStateError(null)
    } catch (error) {
      setManagedError(error instanceof Error ? error.message : String(error))
    } finally {
      setManagedBusy(false)
    }
  }

  /**
   * Zwolnienie pamięci karty (zadanie 14) — operacja pomocnicza, więc jej
   * niepowodzenie NIGDY nie rzuca (`unloadModel` po stronie serwera tego
   * pilnuje), a tu dodatkowo `try/catch` łapie jeszcze sam błąd sieci
   * (serwer padł, zanim żądanie dotarło). W trybie zarządzanym udane
   * zwolnienie oznacza zatrzymany proces — stan lokalny wraca do `stopped`
   * od razu, bez osobnego odpytania `GET /managed/state`, bo to właśnie
   * gwarantuje `unloadModel` po stronie serwera dla tej gałęzi.
   *
   * `unloadCapability` idzie do żądania wprost — panel go już zna (właśnie
   * go pokazuje przy przycisku), więc nie ma po co każe kliknięcie miałoby
   * kazać serwerowi sondować dostawcę od nowa (do dwóch sekund) tuż przed
   * samym zwolnieniem. Przycisk jest zresztą nieaktywny, dopóki
   * `unloadCapability` jest `null`, więc tu zawsze jest to już rozstrzygnięta
   * wartość.
   */
  const runUnload = async (): Promise<void> => {
    setUnloadError(null)
    setUnloadMessage(null)
    setUnloadBusy(true)
    try {
      const result = await settingsApi.unload(unloadCapability ?? undefined)
      if (result.freed) {
        setUnloadMessage(t('llm.unloadDone'))
        if (result.how === 'managed') {
          setManaged(current => (current ? { ...current, status: 'stopped' } : current))
        }
      } else {
        setUnloadError(t('llm.unloadFailed', { reason: result.reason ?? t('llm.unknownError') }))
      }
    } catch (error) {
      setUnloadError(t('llm.unloadFailed', {
        reason: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      setUnloadBusy(false)
    }
  }

  /**
   * Wyczyszczenie klucza z jedynego miejsca, które do tego prowadzi (zadanie
   * 1 przewidziało `null` w `PUT` dokładnie po to, żeby dało się cofnąć klucz
   * wklejony wcześniej na tę maszynę) — puste pole samo w sobie ZAWSZE znaczy
   * „zostaw bez zmian" (`draft.apiKey` w zwykłym zapisie), więc wyczyszczenie
   * to osobna, jawna akcja z osobnym żądaniem, a nie efekt uboczny pustego
   * pola. Fix round 1/5, punkt 1.
   */
  const clearApiKey = async (): Promise<void> => {
    setSaveError(null)
    setKeyCleared(false)
    try {
      const next = await settingsApi.putSettings({
        mode: draft.mode,
        endpoint: { baseUrl: draft.baseUrl, apiKey: null, model: draft.model },
        managed: {
          serverBinary: draft.serverBinary,
          modelPath: draft.modelPath,
          gpuLayers: toInt(draft.gpuLayers, 0),
          contextSize: toInt(draft.contextSize, 8192),
        },
      })
      setDraft(draftFrom(next))
      setSaved(next)
      setKeyCleared(true)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }

  const startRun = (request: LlmRunRequest): void => {
    if (slug === null) return
    run.run(request)
  }

  const runStructure = (): void => startRun({ task: 'structure', projectSlug: slug ?? '', ideaA, ideaB })

  /**
   * Rozmowa zastępuje jednostrzałową redakcję. Do pola prowadzą teraz jedne
   * drzwi, a nie dwoje: w tym projekcie trzykrotnie wracała ta sama klasa
   * usterki — strażnik postawiony w jednych drzwiach, gdy drzwi jest kilka
   * (stąd `audioFieldText.ts`, gdy trzy zadania pisały do pól audio trzema
   * drogami). Pierwsza tura rozmowy robi to, co robiła redakcja.
   *
   * Samo zadanie `redact` po stronie serwera ZOSTAJE: korzysta z niego
   * tłumaczenie całego projektu (`translateAll.ts`), więc usunięcie go zabrałoby
   * funkcję, której ta zmiana nie dotyczy.
   */
  const openChat = (): void => {
    const choice = redactChoices.find(option => option.value === redactValue) ?? redactChoices[0]
    if (!choice) return
    setChatTarget(choice.target)
  }

  const runAudio = (): void => startRun({ task: 'audio', projectSlug: slug ?? '' })
  const runCritic = (): void =>
    startRun({ task: 'critic', projectSlug: slug ?? '', replyLanguage: lang })
  const runTranslateAll = (): void => startRun({ task: 'translateAll', projectSlug: slug ?? '' })

  const canRunStructure = tasksEnabled && ideaA.trim() !== '' && ideaB.trim() !== ''

  const statusLabel = (() => {
    if (run.status === 'running' && run.retrying) return t('llm.retrying')
    switch (run.status) {
      case 'idle': return t('llm.statusIdle')
      case 'running': return t('llm.statusRunning')
      case 'done': return run.patch ? t('llm.opsReady', { count: run.patch.ops.length }) : t('llm.statusDone')
      case 'error': return t('llm.statusError')
      case 'cancelled': return t('llm.statusCancelled')
    }
  })()

  return (
    <section aria-label={t('llm.title')} className="flex h-full flex-col gap-4 overflow-auto p-3 text-sm">
      <div>
        <span className="mb-2 block text-xs uppercase tracking-wide text-neutral-500">
          {t('llm.settingsTitle')}
        </span>
        <div role="group" aria-label={t('llm.settingsTitle')} className="mb-2 flex gap-1">
          {MODES.map(mode => (
            <ActionButton
              key={mode}
              label={MODE_LABEL[mode](t)}
              pressed={draft.mode === mode}
              disabled={busy}
              onClick={() => setDraft(current => ({ ...current, mode }))}
            />
          ))}
        </div>

        {/*
          Przycisk siedzi obok wyboru dostawcy, nie przy czterech zadaniach —
          to operacja NA dostawcy (zwalnia VRAM, który zaraz potrzebuje
          ComfyUI), nie na projekcie. Podpowiedź bierze się z wykrytej
          możliwości (`UNLOAD_HINT`), więc mówi konkretnie, co się stanie u
          TEGO dostawcy — zamiast jednego ogólnego zdania dla wszystkich.
        */}
        <div className="mb-2 flex items-center gap-2">
          <ActionButton
            label={t('llm.unload')}
            disabled={unloadDisabled}
            onClick={() => void runUnload()}
          />
          <span className="text-xs text-neutral-400">
            {UNLOAD_HINT[unloadCapability ?? 'none'](t)}
          </span>
        </div>
        {unloadMessage && <p className="mb-2 text-xs text-emerald-400">{unloadMessage}</p>}
        {unloadError && <p className="mb-2 text-xs text-red-400">{unloadError}</p>}

        {draft.mode === 'endpoint' && (
          <div className="flex flex-col gap-2">
            <Field label={t('llm.endpointBaseUrl')}>
              <input
                className={inputClass}
                value={draft.baseUrl}
                disabled={busy}
                onChange={event => setDraft(current => ({ ...current, baseUrl: event.target.value }))}
              />
            </Field>
            {/*
              Przycisk „Wyczyść klucz" MUSI zostać poza `<label>` — element
              wewnątrz etykiety dokłada swój własny tekst do nazwy dostępnej
              tej etykiety (przeglądarka i `getByLabelText` liczą CAŁY tekst
              potomków, nie tylko `<span>`), więc „Klucz API" zmieniłoby się w
              „Klucz APIWyczyść klucz" i przestało dawać się znaleźć po
              nazwie pola. Złapane przez własne testy tego zadania (fix round
              1/5, punkt 1) — dwa istniejące testy poczerwieniały, zanim ten
              układ powstał.
            */}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field label={t('llm.endpointApiKey')}>
                  <input
                    type="password"
                    className={inputClass}
                    value={draft.apiKey}
                    placeholder={t('llm.endpointApiKeyHint')}
                    disabled={busy}
                    onChange={event => {
                      setKeyCleared(false)
                      setDraft(current => ({ ...current, apiKey: event.target.value }))
                    }}
                  />
                </Field>
              </div>
              <ActionButton
                label={t('llm.clearKey')}
                disabled={busy}
                onClick={() => void clearApiKey()}
              />
            </div>
            {keyCleared && <p className="text-xs text-emerald-400">{t('llm.keyCleared')}</p>}
            <Field label={t('llm.endpointModel')}>
              <input
                className={inputClass}
                value={draft.model}
                disabled={busy}
                onChange={event => setDraft(current => ({ ...current, model: event.target.value }))}
              />
            </Field>
          </div>
        )}

        {draft.mode === 'managed' && (
          <div className="flex flex-col gap-2">
            <Field label={t('llm.managedBinary')}>
              <input
                className={inputClass}
                value={draft.serverBinary}
                disabled={busy}
                onChange={event => setDraft(current => ({ ...current, serverBinary: event.target.value }))}
              />
            </Field>
            <Field label={t('llm.managedModelPath')}>
              <input
                className={inputClass}
                value={draft.modelPath}
                disabled={busy}
                onChange={event => setDraft(current => ({ ...current, modelPath: event.target.value }))}
              />
            </Field>
            <Field label={t('llm.managedGpuLayers')}>
              <input
                type="number"
                className={inputClass}
                value={draft.gpuLayers}
                disabled={busy}
                onChange={event => setDraft(current => ({ ...current, gpuLayers: event.target.value }))}
              />
            </Field>
            <Field label={t('llm.managedContextSize')}>
              <input
                type="number"
                className={inputClass}
                value={draft.contextSize}
                disabled={busy}
                onChange={event => setDraft(current => ({ ...current, contextSize: event.target.value }))}
              />
            </Field>
            <div className="flex items-center gap-2">
              <ActionButton
                label={t('llm.managedStart')}
                disabled={busy || managedBusy}
                onClick={() => void startManagedServer()}
              />
              <ActionButton
                label={t('llm.managedStop')}
                disabled={busy || managedBusy}
                onClick={() => void stopManagedServer()}
              />
              <span className="text-xs text-neutral-400">
                {t('llm.managedStatus')}: {
                  managedStateError
                    ? <span className="text-red-400">{t('llm.managedStateError', { message: managedStateError })}</span>
                    : managed ? MANAGED_STATE_LABEL[managed.status](t) : '—'
                }
              </span>
            </div>
            {managedError && <p className="text-xs text-red-400">{managedError}</p>}
          </div>
        )}

        <div className="mt-2">
          <ActionButton label={t('llm.saveSettings')} disabled={busy} onClick={() => void saveSettings()} />
        </div>
        {saveError && <p className="mt-1 text-xs text-red-400">{t('llm.saveError', { message: saveError })}</p>}
        {loadError && <p className="mt-1 text-xs text-red-400">{t('llm.loadError', { message: loadError })}</p>}
      </div>

      {!configured && (
        <div>
          <p className="text-xs text-amber-400">{t('llm.notConfigured')}</p>
          <p className="text-xs text-neutral-500">{t('llm.notConfiguredHint')}</p>
        </div>
      )}

      {slug === null && <p className="text-xs text-neutral-500">{t('llm.noProject')}</p>}

      <div className="flex flex-col gap-3">
        <span className="text-xs uppercase tracking-wide text-neutral-500">{t('llm.tasksTitle')}</span>

        <div className="flex flex-col gap-1">
          <Field label={t('llm.ideaA')}>
            <textarea
              className={inputClass}
              rows={2}
              value={ideaA}
              disabled={busy}
              onChange={event => setIdeaA(event.target.value)}
            />
          </Field>
          <Field label={t('llm.ideaB')}>
            <textarea
              className={inputClass}
              rows={2}
              value={ideaB}
              disabled={busy}
              onChange={event => setIdeaB(event.target.value)}
            />
          </Field>
          <ActionButton label={t('llm.taskStructure')} disabled={!canRunStructure} onClick={runStructure} />
          {/*
            Przygaszony przycisk bez powodu wygląda jak zepsuty. Ten warunek
            (oba zdania pomysłu niepuste) jest jedynym DODATKOWYM warunkiem
            ponad konfigurację dostawcy, więc tylko on wymaga wyjaśnienia.
          */}
          {tasksEnabled && !canRunStructure && (
            <span className="text-[11px] text-neutral-500">{t('llm.structureNeedsIdea')}</span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Field label={t('llm.redactTarget')}>
            {/*
              Zadanie 13, znalezisko w prawdziwej przeglądarce: bez własnego
              `aria-label` nazwa dostępna TEGO elementu liczy się z treści
              całego `<label>`, w którym stoi — a że to jedyny `<select>` w tym
              panelu, doliczają się do niej teksty WSZYSTKICH `<option>`, nie
              tylko wybranej (measured: „Cel redakcjiStyl wizualnyTło…").
              Efekt uboczny w produkcji żaden (są to te same napisy, które i
              tak widać w rozwijanej liście), ale nazwa „Styl wizualny" z opcji
              zaczynała kolidować z polem tekstowym `Styl wizualny` gdzie
              indziej na tej samej stronie — `getByLabel(/styl wizualny/i)` w
              `happyPath.spec.ts` trafiał w DWA elementy i test padał w trybie
              strict, mimo że jsdom (testy jednostkowe tego panelu) tego nie
              widzi, bo nie liczy dostępnych nazw tak jak prawdziwa
              przeglądarka. Jawny `aria-label` (ten sam tekst, co etykieta
              pola) wygrywa z liczeniem nazwy z treści i usuwa kolizję u
              źródła, nie tylko w tym jednym teście.
            */}
            <select
              className={inputClass}
              aria-label={t('llm.redactTarget')}
              value={redactValue}
              disabled={busy}
              onChange={event => setRedactValue(event.target.value)}
            >
              {redactChoices.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </Field>
          <ActionButton label={t('llm.chatOpen')} disabled={!tasksEnabled} onClick={openChat} />
        </div>

        <ActionButton label={t('llm.taskAudio')} disabled={!tasksEnabled} onClick={runAudio} />
        <ActionButton label={t('llm.taskCritic')} disabled={!tasksEnabled} onClick={runCritic} />
        <ActionButton label={t('llm.taskTranslateAll')} disabled={!tasksEnabled} onClick={runTranslateAll} />
      </div>

      {run.status !== 'idle' && (
        <div className="flex flex-col gap-1 border-t border-neutral-800 pt-2">
          <div className="flex items-center gap-2">
            <span>{t('llm.status')}: {statusLabel}</span>
            {busy && <ActionButton label={t('common.cancel')} onClick={run.cancel} />}
          </div>
          <span className="text-xs text-neutral-400">
            {t('llm.tokens')}: {run.promptTokens ?? '—'} / {run.completionTokens ?? '—'}
          </span>
          <span className="text-xs text-neutral-400">
            {t('llm.time')}: {(run.elapsedMs / 1000).toFixed(1)} s
          </span>
          {run.status === 'running' && (
            <pre
              aria-label={t('llm.streamPreview')}
              className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded border border-neutral-800 bg-neutral-950 p-2 font-mono text-[10px]"
            >
              {run.text}
            </pre>
          )}
          {run.status === 'error' && run.error && <p className="text-xs text-red-400">{run.error}</p>}
        </div>
      )}

      {/*
        Zadanie 11: przegląd łatki z wybiórczym przyjmowaniem operacji. Nic z
        wyniku modelu nie stosuje się samo — panel tylko trzyma `run.patch` i
        pokazuje jego liczbę operacji tekstem (`statusLabel` wyżej);
        zastosowanie wymaga jawnego zaznaczenia w `PatchReview` i osobnego
        kliknięcia „Zatwierdź". Renderuje się tylko dla zadań, które NIOSĄ
        łatkę (nie „Krytyk" — tam `run.patch` zostaje `null`, patrz `useLlmRun.ts`).
      */}
      {run.status === 'done' && run.patch && <PatchReview patch={run.patch} />}

      {chatTarget !== null && slug !== null && (
        <FieldChat slug={slug} target={chatTarget} onClose={() => setChatTarget(null)} />
      )}
    </section>
  )
}
