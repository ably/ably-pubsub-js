import { defineConfig } from '@playwright/test';

/**
 * Playwright config for running ably-js lib NPM package tests.
 *
 * See config options: https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './test/lib',
  webServer: {
    command: 'npm run test-support:server',
    url: 'http://localhost:4567',
  },
  use: {
    baseURL: 'http://localhost:4567',
  },
});
