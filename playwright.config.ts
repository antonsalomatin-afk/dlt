import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 2,
  use: { baseURL: 'http://127.0.0.1:3000', ...devices['Pixel 7'] },
  webServer: { command: 'pnpm web:start', url: 'http://127.0.0.1:3000', reuseExistingServer: false, timeout: 60000 },
});
