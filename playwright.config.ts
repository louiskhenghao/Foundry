import { defineConfig } from '@playwright/test';

const port = process.env.PORT ?? '4311';
const apiPort = process.env.API_PORT ?? '4312';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'bun e2e/fixtures/new-goal-workflow.ts',
    url: `http://127.0.0.1:${port}/api/__fixture`,
    env: { PORT: port, API_PORT: apiPort },
    // This server owns disposable data and native homes; never attach to a running instance.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
