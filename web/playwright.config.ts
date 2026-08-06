import { defineConfig } from '@playwright/test'

export default defineConfig({
  /*
    JEDEN worker, świadomie. Ustawienia dostawcy modelu (`llm-settings.json`)
    są plikiem NA MASZYNĘ, nie na projekt — leżą poza katalogami projektów
    właśnie po to, żeby klucz API nie wędrował z projektem wysłanym komuś
    innemu. Skutek uboczny: dwa testy pracujące równolegle na tym samym
    serwerze walczą o ten sam plik i wywracają się nawzajem. Zmierzone wprost:
    `discovery.spec.ts` (który wymaga stanu „dostawca nieskonfigurowany") i
    `llm.spec.ts` (który konfiguruje dostawcę) padały razem, a każdy z osobna
    przechodził.
  */
  workers: 1,
  testDir: './e2e',
  // Generator zrzutów do README nie jest testem — zapisuje pliki i wymaga
  // ręcznego uruchomienia (Error: http://127.0.0.1:8899/api/health is already used, make sure that nothing is running on the port/url or set reuseExistingServer:true in config.webServer.).
  testIgnore: process.env.MMH3_SHOTS === '1' ? [] : ['**/screenshots.spec.ts'],
  globalSetup: './e2e/globalSetup.ts',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5173', headless: true },
  webServer: [
    {
      command: 'npm run start --workspace @mmh3/server',
      url: 'http://127.0.0.1:8899/api/health',
      // Świadomie NIE wolno tu ponownie użyć działającego serwera. Zmienna
      // MMH3_DATA_ROOT dotyczy wyłącznie procesu, który Playwright sam startuje,
      // więc podłączenie się pod uruchomione `npm run dev:api` oznaczałoby
      // tworzenie projektów testowych w prawdziwym katalogu danych.
      reuseExistingServer: false,
      env: { MMH3_DATA_ROOT: '/tmp/mmh3-e2e' },
      cwd: '..',
    },
    {
      command: 'npm run dev --workspace @mmh3/web',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
      cwd: '..',
    },
  ],
})
