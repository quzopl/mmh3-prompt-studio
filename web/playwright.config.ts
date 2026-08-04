import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5173', headless: true },
  webServer: [
    {
      command: 'npm run start --workspace @mmh3/server',
      url: 'http://127.0.0.1:8899/api/health',
      reuseExistingServer: true,
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
