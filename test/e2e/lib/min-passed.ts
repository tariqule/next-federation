/** The part of Playwright's JSON report this guard reads. */
type JsonReport = {
  stats?: { expected?: unknown; flaky?: unknown; skipped?: unknown }
}

/**
 * Why a run that should have passed at least `min` tests did not, from its
 * Playwright JSON report (`stats.expected` passed, `stats.flaky` passed on a
 * retry), or null when it did. A run whose every test skipped (a missing
 * suite env, a filter that matched only skipped tests) exits 0 in
 * Playwright: this turns it into a failure.
 */
export function minPassedFailure(report: unknown, min: number): string | null {
  if (min <= 0) return null
  const stats = (report as JsonReport | undefined)?.stats
  if (typeof stats?.expected !== 'number') {
    return `NF_MIN_PASSED is ${min}, but there is no Playwright JSON report to count passed tests in.`
  }
  const flaky = typeof stats.flaky === 'number' ? stats.flaky : 0
  const skipped = typeof stats.skipped === 'number' ? stats.skipped : 0
  const passed = stats.expected + flaky
  if (passed >= min) return null
  return `${passed} ${passed === 1 ? 'test' : 'tests'} passed (${skipped} skipped); NF_MIN_PASSED is ${min}.`
}
