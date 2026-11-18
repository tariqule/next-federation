// The publish workflow's handling of npm "staged" publishing
// (scripts/publish-wait.mjs, .github/workflows/publish.yml): npm holds a newly
// accepted version as staged for a few minutes, and publishing it again then
// fails with E409 "Cannot publish over previously staged version".
import {
  attestationsUrl,
  isVisible,
  publishWithStagedWait,
  readGitHead,
  readProvenance,
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

const HEAD = 'f422ec9d1c2b3a4f5e6d7c8b9a0f1e2d3c4b5a69'
const OTHER = '8c93baf0123456789abcdef0123456789abcdef0'
const REPO = 'https://github.com/tariqule/next-federation'
const SLSA = 'https://slsa.dev/provenance/v1'

/**
 * npm's attestations response for a version published with provenance from
 * GitHub Actions (the shape of the registry's real responses: a publish
 * attestation and a SLSA v1 provenance, each a DSSE envelope).
 */
function attestations(commit: string, repository = REPO) {
  const envelope = (statement: unknown) => ({
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    verificationMaterial: {},
    dsseEnvelope: {
      payloadType: 'application/vnd.in-toto+json',
      payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
      signatures: [],
    },
  })
  const subject = [
    { name: 'pkg:npm/%40next-federation/sdk@0.1.1', digest: { sha512: 'ab' } },
  ]
  const publish =
    'https://github.com/npm/attestation/tree/main/specs/publish/v0.1'
  return {
    attestations: [
      {
        predicateType: publish,
        bundle: envelope({
          _type: 'https://in-toto.io/Statement/v0.1',
          subject,
          predicateType: publish,
          predicate: { name: '@next-federation/sdk', version: '0.1.1' },
        }),
      },
      {
        predicateType: SLSA,
        bundle: envelope({
          _type: 'https://in-toto.io/Statement/v1',
          subject,
          predicateType: SLSA,
          predicate: {
            buildDefinition: {
              buildType:
                'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
              externalParameters: {
                workflow: {
                  ref: 'refs/heads/main',
                  repository,
                  path: '.github/workflows/publish.yml',
                },
              },
              resolvedDependencies: [
                {
                  uri: `git+${repository}@refs/heads/main`,
                  digest: { gitCommit: commit },
                },
              ],
            },
          },
        }),
      },
    ],
  }
}

describe('readGitHead', () => {
  test('the commit npm records, none when npm prints nothing, else unreadable', () => {
    expect(readGitHead({ code: 0, stdout: `"${HEAD}"\n` })).toEqual({
      kind: 'commit',
      commit: HEAD,
    })
    // pnpm publishes a packed tarball, so npm records no gitHead.
    expect(readGitHead({ code: 0, stdout: '' })).toEqual({ kind: 'none' })
    expect(readGitHead({ code: 0, stdout: '"main"' })).toEqual({
      kind: 'unreadable',
    })
    expect(readGitHead({ code: 1, stdout: '{"error":{}}' })).toEqual({
      kind: 'unreadable',
    })
  })
})

describe('readProvenance', () => {
  test('the repository and commit of a SLSA provenance', () => {
    expect(readProvenance({ status: 200, json: attestations(HEAD) })).toEqual({
      kind: 'build',
      commit: HEAD,
      repository: REPO,
    })
  })

  test('none when npm has no attestations for the version', () => {
    expect(readProvenance({ status: 404, json: { error: 'x' } })).toEqual({
      kind: 'none',
    })
    const publishOnly = attestations(HEAD)
    publishOnly.attestations.pop()
    expect(readProvenance({ status: 200, json: publishOnly })).toEqual({
      kind: 'none',
    })
  })

  test('unreadable for anything else', () => {
    expect(readProvenance({ status: 500, json: undefined })).toEqual({
      kind: 'unreadable',
    })
    expect(readProvenance({ status: 200, json: 'nope' })).toEqual({
      kind: 'unreadable',
    })
    expect(readProvenance({ status: 200, json: attestations('main') })).toEqual(
      { kind: 'unreadable' }
    )
    const garbled = attestations(HEAD)
    garbled.attestations[1]!.bundle.dsseEnvelope.payload = 'not json'
    expect(readProvenance({ status: 200, json: garbled })).toEqual({
      kind: 'unreadable',
    })
  })

  test('the attestations URL of a version', () => {
    expect(attestationsUrl('@next-federation/sdk', '0.1.1')).toBe(
      'https://registry.npmjs.org/-/npm/v1/attestations/@next-federation%2fsdk@0.1.1'
    )
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
    visibleAfter = 0,
    origin: {
      gitHead?: string
      attestations?: { status: number; json: unknown }
      head?: string | null
    } = {}
  ) {
    const c = clock()
    const runs: string[][] = []
    const logs: string[] = []
    const fetched: string[] = []
    const options = {
      run: async (command: string[]) => {
        runs.push(command)
        return results.shift() ?? { code: 0, output: '' }
      },
      view: async (_spec: string, field: string) => {
        if (field === 'gitHead')
          return { code: 0, stdout: origin.gitHead ?? '' }
        return c.now() >= visibleAfter
          ? { code: 0, stdout: '"0.1.1"' }
          : { code: 0, stdout: '' }
      },
      fetchJson: async (url: string) => {
        fetched.push(url)
        return origin.attestations ?? { status: 200, json: attestations(HEAD) }
      },
      head: async () => (origin.head === undefined ? HEAD : origin.head),
      repository: REPO,
      now: c.now,
      sleep: c.sleep,
      log: (line: string) => logs.push(line),
      timeoutMs: 15 * 60_000,
      intervalMs: 20_000,
    }
    return { options, runs, logs, c, fetched }
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

  test('a staged version built from this commit (provenance names HEAD): publishes the rest', async () => {
    const h = harness([
      { code: 1, output: staged },
      { code: 0, output: 'Successfully published' },
    ])
    expect(await publishWithStagedWait(h.options)).toBe(0)
    expect(h.runs).toHaveLength(2)
    expect(h.fetched).toEqual([
      'https://registry.npmjs.org/-/npm/v1/attestations/@next-federation%2fsdk@0.1.1',
    ])
    expect(h.logs.join('\n')).toContain(
      `tag @next-federation/sdk@0.1.1 at ${HEAD} by hand`
    )
  })

  test('a matching gitHead as well as provenance: publishes the rest', async () => {
    const h = harness(
      [
        { code: 1, output: staged },
        { code: 0, output: 'Successfully published' },
      ],
      0,
      { gitHead: `"${HEAD}"` }
    )
    expect(await publishWithStagedWait(h.options)).toBe(0)
    expect(h.runs).toHaveLength(2)
  })

  test('a staged version whose provenance names another commit: fails without tagging HEAD', async () => {
    const h = harness([{ code: 1, output: staged }], 0, {
      attestations: { status: 200, json: attestations(OTHER) },
    })
    expect(await publishWithStagedWait(h.options)).toBe(1)
    expect(h.runs).toEqual([['pnpm', 'release']])
    const text = h.logs.join('\n')
    expect(text).toMatch(/::error::.*@next-federation\/sdk@0\.1\.1/)
    expect(text).toContain(OTHER)
    expect(text).toContain(HEAD)
    expect(text).toContain('npm deprecate')
  })

  test('a staged version whose gitHead names another commit: fails', async () => {
    const h = harness([{ code: 1, output: staged }], 0, {
      gitHead: `"${OTHER}"`,
    })
    expect(await publishWithStagedWait(h.options)).toBe(1)
    expect(h.runs).toHaveLength(1)
    const text = h.logs.join('\n')
    expect(text).toContain('gitHead')
    expect(text).toContain(OTHER)
    expect(text).toContain(HEAD)
  })

  test('a staged version from another repository: fails', async () => {
    const h = harness([{ code: 1, output: staged }], 0, {
      attestations: {
        status: 200,
        json: attestations(HEAD, 'https://github.com/someone/fork'),
      },
    })
    expect(await publishWithStagedWait(h.options)).toBe(1)
    expect(h.runs).toHaveLength(1)
    const text = h.logs.join('\n')
    expect(text).toContain(REPO)
    // npm's text is never echoed.
    expect(text).not.toContain('someone/fork')
  })

  test('no provenance, even with a matching gitHead: fails closed, saying how to check it by hand', async () => {
    // gitHead is whatever the publisher's package.json says; pnpm does not
    // even record it. This workflow always publishes with provenance.
    const h = harness([{ code: 1, output: staged }], 0, {
      gitHead: `"${HEAD}"`,
      attestations: { status: 404, json: undefined },
    })
    expect(await publishWithStagedWait(h.options)).toBe(1)
    expect(h.runs).toHaveLength(1)
    const text = h.logs.join('\n')
    expect(text).toMatch(/::error::.*@next-federation\/sdk@0\.1\.1.*provenance/)
    expect(text).toContain(HEAD)
    expect(text).toContain('npm pack @next-federation/sdk@0.1.1')
  })

  test('provenance npm cannot serve, or no HEAD commit: fails closed', async () => {
    const h = harness([{ code: 1, output: staged }], 0, {
      attestations: { status: 500, json: undefined },
    })
    expect(await publishWithStagedWait(h.options)).toBe(1)
    expect(h.runs).toHaveLength(1)
    const g = harness([{ code: 1, output: staged }], 0, { head: null })
    expect(await publishWithStagedWait(g.options)).toBe(1)
    expect(g.runs).toHaveLength(1)
    expect(g.logs.join('\n')).toContain('git rev-parse HEAD')
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
