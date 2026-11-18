// The publish workflow's handling of npm "staged" publishing
// (scripts/publish-wait.mjs, .github/workflows/publish.yml): npm holds a newly
// accepted version as staged for a few minutes, and publishing it again then
// fails with E409 "Cannot publish over previously staged version".
import {
  isVisible,
  publishWithStagedWait,
  stagedConflicts,
  waitUntilVisible,
} from '../lib/publish-wait.mjs'

const ESC = '\u001b'
const red = (s: string) => `${ESC}[31m${s}${ESC}[39m`
const blue = (s: string) => `${ESC}[94m${s}${ESC}[39m`

/** The tail of `changeset publish` output (clack's log.error, colours on). */
function failedBlock(
  entries: { name: string; version: string; error: string }[]
): string {
  const lines = entries.flatMap(({ name, version, error }) => [
    `${blue(name)}@${red(version)}`,
    `${ESC}[2m└${ESC}[22m ${error}`,
  ])
  const [first, ...rest] = ['Some packages failed to publish:', ...lines]
  return [
    '│',
    `${red('■')}  ${first}`,
    ...rest.map((l) => `│  ${l}`),
    '◇  Creating git tags...',
    '',
  ].join('\n')
}

const STAGED = (version: string) =>
  `E409: 409 Conflict - PUT https://registry.npmjs.org/@next-federation%2fsdk - Cannot publish over previously staged version ${version}`

describe('stagedConflicts', () => {
  test('lists the versions that failed only because npm holds them as staged', () => {
    const output = `Building...\n${failedBlock([
      {
        name: '@next-federation/sdk',
        version: '0.1.1',
        error: STAGED('0.1.1'),
      },
      {
        name: '@next-federation/protocol',
        version: '0.1.1',
        error: STAGED('0.1.1'),
      },
    ])}`
    expect(stagedConflicts(output)).toEqual([
      { name: '@next-federation/sdk', version: '0.1.1' },
      { name: '@next-federation/protocol', version: '0.1.1' },
    ])
  })

  test('null when any other package failed for another reason', () => {
    const output = failedBlock([
      {
        name: '@next-federation/sdk',
        version: '0.1.1',
        error: STAGED('0.1.1'),
      },
      {
        name: '@next-federation/core',
        version: '0.1.1',
        error: 'E403: You do not have permission to publish "core".',
      },
    ])
    expect(stagedConflicts(output)).toBeNull()
  })

  test('null without the failure list (a build failure, a crash)', () => {
    expect(stagedConflicts('error TS2322: Type ...\n')).toBeNull()
    expect(stagedConflicts('')).toBeNull()
  })

  test('null when an error message spans several lines and is not a staged conflict', () => {
    const output = failedBlock([
      {
        name: '@next-federation/sdk',
        version: '0.1.1',
        error: 'E500: Internal Server Error\n│  try again later',
      },
    ])
    expect(stagedConflicts(output)).toBeNull()
  })

  test('reads the ASCII fallback symbols too', () => {
    const output = [
      'x  Some packages failed to publish:',
      '|  @next-federation/sdk@0.1.1-next.0',
      `|  └ ${STAGED('0.1.1-next.0')}`,
    ].join('\n')
    expect(stagedConflicts(output)).toEqual([
      { name: '@next-federation/sdk', version: '0.1.1-next.0' },
    ])
  })
})

describe('isVisible', () => {
  test('only the exact version counts; npm prints nothing for a version it does not show', () => {
    expect(isVisible({ code: 0, stdout: '"0.1.1"\n' }, '0.1.1')).toBe(true)
    expect(isVisible({ code: 0, stdout: '' }, '0.1.1')).toBe(false)
    expect(isVisible({ code: 0, stdout: '"0.0.0-stage"' }, '0.1.1')).toBe(false)
    expect(
      isVisible({ code: 1, stdout: '{"error":{"code":"E404"}}' }, '0.1.1')
    ).toBe(false)
    expect(isVisible({ code: 0, stdout: '["0.1.1"]' }, '0.1.1')).toBe(true)
  })
})

/** A fake clock: `sleep` advances it. */
function clock() {
  let t = 0
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms
    },
  }
}

describe('waitUntilVisible', () => {
  test('polls each version until npm shows it, and returns none missing', async () => {
    const c = clock()
    const views: string[] = []
    const shownAt: Record<string, number> = {
      '@next-federation/sdk@0.1.1': 40_000,
      '@next-federation/protocol@0.1.1': 0,
    }
    const missing = await waitUntilVisible(
      [
        { name: '@next-federation/sdk', version: '0.1.1' },
        { name: '@next-federation/protocol', version: '0.1.1' },
      ],
      {
        view: async (spec: string) => {
          views.push(spec)
          return c.now() >= shownAt[spec]!
            ? { code: 0, stdout: '"0.1.1"' }
            : { code: 0, stdout: '' }
        },
        now: c.now,
        sleep: c.sleep,
        deadline: 15 * 60_000,
        intervalMs: 20_000,
      }
    )
    expect(missing).toEqual([])
    // protocol is visible at once and not asked again.
    expect(views.filter((v) => v.includes('protocol'))).toHaveLength(1)
    expect(views.filter((v) => v.includes('sdk'))).toHaveLength(3)
  })

  test('returns what is still not visible at the deadline', async () => {
    const c = clock()
    const missing = await waitUntilVisible(
      [{ name: '@next-federation/sdk', version: '0.1.1' }],
      {
        view: async () => ({ code: 0, stdout: '' }),
        now: c.now,
        sleep: c.sleep,
        deadline: 60_000,
        intervalMs: 20_000,
      }
    )
    expect(missing).toEqual([
      { name: '@next-federation/sdk', version: '0.1.1' },
    ])
    expect(c.now()).toBeLessThanOrEqual(60_000)
  })
})

describe('publishWithStagedWait', () => {
  const staged = failedBlock([
    { name: '@next-federation/sdk', version: '0.1.1', error: STAGED('0.1.1') },
  ])

  function harness(
    results: { code: number; output: string }[],
    visibleAfter = 0
  ) {
    const c = clock()
    const runs: string[][] = []
    const logs: string[] = []
    const options = {
      run: async (command: string[]) => {
        runs.push(command)
        return results.shift() ?? { code: 0, output: '' }
      },
      view: async () =>
        c.now() >= visibleAfter
          ? { code: 0, stdout: '"0.1.1"' }
          : { code: 0, stdout: '' },
      now: c.now,
      sleep: c.sleep,
      log: (line: string) => logs.push(line),
      timeoutMs: 15 * 60_000,
      intervalMs: 20_000,
    }
    return { options, runs, logs, c }
  }

  test('a clean release succeeds without waiting', async () => {
    const h = harness([{ code: 0, output: 'Successfully published' }])
    expect(await publishWithStagedWait(h.options)).toBe(0)
    expect(h.runs).toEqual([['pnpm', 'release']])
  })

  test('only staged conflicts: waits until visible, then publishes the rest (and tags) again', async () => {
    const h = harness(
      [
        { code: 1, output: staged },
        { code: 0, output: 'Successfully published' },
      ],
      60_000
    )
    expect(await publishWithStagedWait(h.options)).toBe(0)
    // changeset publish stops after a failed chunk: the later packages and the
    // git tags come from a second run, which skips what npm already shows.
    expect(h.runs).toEqual([
      ['pnpm', 'release'],
      ['pnpm', 'exec', 'changeset', 'publish'],
    ])
    expect(h.logs.join('\n')).toContain('@next-federation/sdk@0.1.1')
  })

  test('any other failure fails at once, without waiting', async () => {
    const h = harness([
      {
        code: 1,
        output: failedBlock([
          {
            name: '@next-federation/sdk',
            version: '0.1.1',
            error: 'E403: forbidden',
          },
        ]),
      },
    ])
    expect(await publishWithStagedWait(h.options)).toBe(1)
    expect(h.runs).toHaveLength(1)
    expect(h.c.now()).toBe(0)
  })

  test('still not visible at the time limit: fails, saying how to approve it', async () => {
    const h = harness([{ code: 1, output: staged }], Infinity)
    expect(await publishWithStagedWait(h.options)).toBe(1)
    const text = h.logs.join('\n')
    expect(text).toContain('@next-federation/sdk@0.1.1')
    expect(text).toContain('Staged Packages')
    expect(text).toContain('npm stage approve')
    expect(h.runs).toHaveLength(1)
    expect(h.c.now()).toBeLessThanOrEqual(15 * 60_000)
  })

  test('a failing second run is judged the same way', async () => {
    const h = harness([
      { code: 1, output: staged },
      { code: 1, output: 'ERR_PNPM_SOMETHING' },
    ])
    expect(await publishWithStagedWait(h.options)).toBe(1)
    expect(h.runs).toHaveLength(2)
  })
})
