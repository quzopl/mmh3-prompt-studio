/**
 * Lista kuratorowana zamiast pola na URL — wzorzec przeniesiony ze słownika
 * `CAPTIONERS` w `ideogram4-flux2-lora-studio` (`backend/captioner.py`), gdzie
 * użytkownik wybiera opisaną pozycję, a nie wkleja adresu.
 *
 * Rozmiary poniżej są ZMIERZONE nagłówkiem HTTP 2026-08-06, nie przepisane z
 * opisu repozytorium. Liczba w interfejsie ma znaczyć tyle, ile naprawdę
 * zajmie na dysku — użytkownik decyduje na jej podstawie, czy uruchamiać
 * pobieranie kilku gigabajtów.
 */
export interface CatalogModel {
  id: string
  label: string
  fileName: string
  url: string
  bytes: number
  /** Ile pamięci karty potrzeba, żeby model zmieścił się w całości. */
  vramMb: number
}

const hf = (repo: string, file: string): string =>
  `https://huggingface.co/bartowski/${repo}/resolve/main/${file}`

export const MODELS: readonly CatalogModel[] = [
  {
    id: 'qwen2.5-7b-q4km',
    label: 'Qwen2.5 7B Instruct Q4_K_M',
    fileName: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    url: hf('Qwen2.5-7B-Instruct-GGUF', 'Qwen2.5-7B-Instruct-Q4_K_M.gguf'),
    bytes: 4_700_000_000,
    vramMb: 6_144,
  },
  {
    id: 'qwen2.5-14b-q4km',
    label: 'Qwen2.5 14B Instruct Q4_K_M',
    fileName: 'Qwen2.5-14B-Instruct-Q4_K_M.gguf',
    url: hf('Qwen2.5-14B-Instruct-GGUF', 'Qwen2.5-14B-Instruct-Q4_K_M.gguf'),
    bytes: 8_988_110_976,
    vramMb: 11_264,
  },
  {
    id: 'qwen2.5-32b-q4km',
    label: 'Qwen2.5 32B Instruct Q4_K_M',
    fileName: 'Qwen2.5-32B-Instruct-Q4_K_M.gguf',
    url: hf('Qwen2.5-32B-Instruct-GGUF', 'Qwen2.5-32B-Instruct-Q4_K_M.gguf'),
    bytes: 19_900_000_000,
    vramMb: 22_528,
  },
]

/** Ten model przeszedł wszystkie testy prozy na prawdziwym sprzęcie
 *  (2026-08-05 i 2026-08-06), więc to on jest domyślną propozycją. */
export const DEFAULT_MODEL_ID = 'qwen2.5-14b-q4km'

/**
 * Wersja PRZYPIĘTA, nigdy „latest". 2026-08-06 najnowsze wydanie llama.cpp
 * (`b10297`) niosło WYŁĄCZNIE binaria Windows — pobieranie „latest"
 * wywróciłoby się na Linuksie. Podniesienie tej stałej ma być świadomą zmianą
 * w kodzie, nie loterią zależną od dnia, w którym użytkownik kliknie.
 */
export const LLAMA_RELEASE = 'b10295'

export interface EngineAsset {
  name: string
  url: string
  archive: 'tar' | 'zip'
}

const ASSETS: Record<string, string> = {
  'linux:x64': 'ubuntu-vulkan-x64.tar.gz',
  'linux:arm64': 'ubuntu-vulkan-arm64.tar.gz',
  'darwin:arm64': 'macos-arm64.tar.gz',
  'darwin:x64': 'macos-x64.tar.gz',
  'win32:x64': 'win-cpu-x64.zip',
}

/**
 * Linux dostaje wariant VULKAN, nie `ubuntu-x64`: ten drugi jest wyłącznie
 * procesorowy, a Vulkan działa na NVIDII BEZ instalowania toolkitu CUDA —
 * sprawdzone wprost na RTX PRO 6000 Blackwell (`llama-server --list-devices`
 * widzi kartę).
 *
 * Windows dostaje wariant procesorowy świadomie: warianty CUDA wymagają
 * DRUGIEGO pobrania (`cudart-llama-bin-win-cuda-*.zip`), a bez maszyny z
 * Windows nie da się sprawdzić, czy złożenie obu działa. Obiecywanie
 * akceleracji, której nikt nie zweryfikował, byłoby zgadywaniem.
 *
 * Nieobsługiwana kombinacja zwraca `null` — nie pobieramy 200 MB czegoś, co i
 * tak się nie uruchomi.
 */
export function engineAssetFor(platform: string, arch: string): EngineAsset | null {
  const suffix = ASSETS[`${platform}:${arch}`]
  if (suffix === undefined) return null
  const name = `llama-${LLAMA_RELEASE}-bin-${suffix}`
  return {
    name,
    url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_RELEASE}/${name}`,
    archive: suffix.endsWith('.zip') ? 'zip' : 'tar',
  }
}
