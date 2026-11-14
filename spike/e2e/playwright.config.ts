import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const spike = join(here, '..');
const webpack = process.env.NF_BUNDLER === 'webpack';
const nextFlag = webpack ? '--webpack' : '';

type App = {
  dir: string;
  url: string;
  command: string;
  env?: Record<string, string>;
};

// One entry per app in the plan's origin table. Apps that don't exist yet are skipped,
// so earlier tasks can run before later apps are created.
const apps: App[] = [
  {
    dir: 'e2e',
    url: 'http://localhost:3999/api/nf/jwks',
    command: 'node fixtures/jwks-server.ts',
  },
  {
    dir: 'island-remote',
    url: 'http://127.0.0.1:4100/_nf/health',
    command: 'pnpm dev',
    env: { NF_REMOTE: 'a', PORT: '4100' },
  },
  {
    dir: 'island-remote',
    url: 'http://127.0.0.1:4101/_nf/health',
    command: 'pnpm dev',
    env: { NF_REMOTE: 'b', PORT: '4101' },
  },
  {
    dir: 'host-app',
    url: 'http://localhost:3100',
    command: `pnpm exec next dev -p 3100 ${nextFlag}`,
    env: { NF_PORT: '3100' },
  },
  {
    dir: 'host-app',
    url: 'http://localhost:3102',
    command: `pnpm exec next dev -p 3102 ${nextFlag}`,
    env: { NF_CC: '1', NF_PORT: '3102' },
  },
  {
    dir: 'host-pages',
    url: 'http://localhost:3101',
    command: `pnpm exec next dev -p 3101 ${nextFlag}`,
    env: { NF_PORT: '3101' },
  },
  { dir: 'spa', url: 'http://localhost:4200', command: 'pnpm dev' },
];

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: { browserName: 'chromium' },
  webServer: apps
    .filter((a) => existsSync(join(spike, a.dir, 'package.json')))
    .map((a) => ({
      command: a.command,
      cwd: join(spike, a.dir),
      url: a.url,
      env: { ...process.env, ...a.env } as Record<string, string>,
      reuseExistingServer: false, // never silently test someone else's server on a busy port
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    })),
});
