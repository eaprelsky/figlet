import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:3402',
    headless: true,
    locale: 'ru-RU',
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'node server/index.mjs',
    url: 'http://127.0.0.1:3402/api/health',
    env: { PORT: '3402' },
    reuseExistingServer: false,
  },
});
