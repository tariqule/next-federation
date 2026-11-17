import { defineConfig, devices } from '@playwright/test'

// Standalone browser gates: each spec serves its own plain HTML on an ephemeral port,
// so no host or remote app is started. Run: playwright test -c gates/playwright.config.ts
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.gate\.ts/,
  outputDir: '/tmp/nf-gates-output',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [['list']],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
