import { defineConfig, devices } from '@playwright/test'
import { OUTPUT_DIR, webServers } from './servers.ts'

// NF_BROWSERS=all (root script `e2e:browsers`) adds Firefox and WebKit for
// the host specs; Chromium always runs every spec.
const ALL_BROWSERS = process.env.NF_BROWSERS === 'all'
const CROSS_BROWSER = /(app-router|pages-router|lifecycle)\.spec\.ts/

export default defineConfig({
  testDir: '.',
  outputDir: OUTPUT_DIR,
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(ALL_BROWSERS
      ? [
          {
            name: 'firefox',
            testMatch: CROSS_BROWSER,
            use: { ...devices['Desktop Firefox'] },
          },
          {
            name: 'webkit',
            testMatch: CROSS_BROWSER,
            use: { ...devices['Desktop Safari'] },
          },
        ]
      : []),
  ],
  webServer: webServers(),
})
