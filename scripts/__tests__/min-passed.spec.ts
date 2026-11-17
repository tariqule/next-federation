// The e2e runner's guard (test/e2e/run.ts, NF_MIN_PASSED): a cell whose
// tests all skipped must fail. Its unit test runs here because Playwright
// would pick up any *.spec.ts under test/e2e.
import { minPassedFailure } from '../../test/e2e/lib/min-passed.ts'

const report = (stats: Record<string, number>) => ({
  stats: { startTime: '', duration: 1, ...stats },
})

test('passes when at least the minimum passed (flaky passes count)', () => {
  expect(minPassedFailure(report({ expected: 3, skipped: 2 }), 1)).toBeNull()
  expect(minPassedFailure(report({ expected: 0, flaky: 1 }), 1)).toBeNull()
  expect(minPassedFailure(report({ expected: 2 }), 2)).toBeNull()
})

test('fails when every test skipped, or fewer than the minimum passed', () => {
  expect(minPassedFailure(report({ expected: 0, skipped: 9 }), 1)).toMatch(
    /0 tests passed \(9 skipped\); NF_MIN_PASSED is 1/
  )
  expect(minPassedFailure(report({ expected: 1 }), 2)).toMatch(/1 test passed/)
})

test('an unreadable report fails', () => {
  expect(minPassedFailure(undefined, 1)).toMatch(/no Playwright JSON report/)
  expect(minPassedFailure({ stats: {} }, 1)).toMatch(/no Playwright JSON/)
})

test('a minimum of 0 never fails', () => {
  expect(minPassedFailure(undefined, 0)).toBeNull()
})

test('the installed cells require one passed test per installed host', async () => {
  // installed-dev.spec.ts runs one test per installed host it starts.
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const scripts = (
    JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
  ).scripts
  for (const cell of ['e2e:installed', 'e2e:installed:webpack']) {
    const apps = /NF_APPS=(\S+)/.exec(scripts[cell]!)![1]!.split(',')
    const hosts = apps.filter((app) => app.startsWith('host-installed-'))
    expect(hosts).toHaveLength(4)
    expect(scripts[cell]).toContain(`NF_MIN_PASSED=${hosts.length} `)
  }
})
