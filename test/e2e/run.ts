// `pnpm e2e:dev -- <filter>` reaches this script as `-- <filter>`, and
// Playwright ignores filters after `--`; so drop it and run Playwright.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2).filter((arg) => arg !== '--')
const bin = join(here, 'node_modules', '.bin', 'playwright')
const result = spawnSync(bin, ['test', ...args], {
  cwd: here,
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
