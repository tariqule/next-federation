// `pnpm e2e:dev -- <filter>` reaches this script as `-- <filter>`, and
// Playwright ignores filters after `--`; so drop it and run Playwright.
//
// NF_MIN_PASSED=<n> (the installed cells set 4, one per host): the run also fails when
// fewer than n tests passed, e.g. when every test skipped, which Playwright
// itself reports as a success. Counted from a JSON report written next to
// the list output.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { minPassedFailure } from './lib/min-passed.ts'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2).filter((arg) => arg !== '--')
const bin = join(here, 'node_modules', '.bin', 'playwright')
const minPassed = Number(process.env.NF_MIN_PASSED ?? '0')
if (!Number.isInteger(minPassed) || minPassed < 0) {
  console.error(
    `NF_MIN_PASSED must be an integer >= 0, got ${JSON.stringify(process.env.NF_MIN_PASSED)}.`
  )
  process.exit(1)
}

const reportDir =
  minPassed > 0 ? mkdtempSync(join(tmpdir(), 'nf-e2e-report-')) : null
const reportFile = reportDir === null ? null : join(reportDir, 'report.json')
const result = spawnSync(
  bin,
  ['test', ...(reportFile ? ['--reporter=list,json'] : []), ...args],
  {
    cwd: here,
    stdio: 'inherit',
    env: reportFile
      ? { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile }
      : process.env,
  }
)
let status = result.status ?? 1
if (reportFile && reportDir) {
  let report: unknown
  try {
    report = JSON.parse(readFileSync(reportFile, 'utf8'))
  } catch {
    report = undefined
  }
  rmSync(reportDir, { recursive: true, force: true })
  const failure = minPassedFailure(report, minPassed)
  if (failure) {
    console.error(`e2e: ${failure}`)
    if (status === 0) status = 1
  }
}
process.exit(status)
