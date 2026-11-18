// GitHub Release notes for the publish workflow (scripts/release-notes.mjs):
// one Markdown body from the `## <version>` sections of every package changelog.
import {
  buildReleaseNotes,
  commonVersion,
  parseSection,
} from '../lib/release-notes.mjs'

const changelog = (name: string, body: string) => ({
  name,
  text: `# ${name}\n\n${body}`,
})

const SHARED = `- abc1234: Shared fix.\n  \n  - detail one\n  - detail two`

const next = changelog(
  '@next-federation/next',
  `## 0.2.0

### Minor Changes

- 1111111: New thing.

### Patch Changes

${SHARED}
- Updated dependencies [abc1234]
  - @next-federation/core@0.2.0
  - @next-federation/sdk@0.2.0

## 0.1.0

### Minor Changes

- 9999999: Old thing.
`
)
const core = changelog(
  '@next-federation/core',
  `## 0.2.0

### Patch Changes

${SHARED}
- @next-federation/sdk@0.2.0

## 0.1.0

### Minor Changes

- 9999999: Old thing.
`
)
const sdk = changelog(
  '@next-federation/sdk',
  `## 0.2.0

No changes in this release.

## 0.1.0

### Minor Changes

- 9999999: Old thing.
`
)

describe('parseSection', () => {
  test('returns null when the version has no section', () => {
    expect(parseSection(next.text, '3.0.0')).toBeNull()
  })

  test('reads entries by bump, strips the commit hash, keeps continuation lines', () => {
    const s = parseSection(next.text, '0.2.0')
    expect(s?.Minor).toEqual(['New thing.'])
    expect(s?.Patch).toEqual(['Shared fix.\n\n  - detail one\n  - detail two'])
  })

  test('drops "Updated dependencies" and bare dependency lines', () => {
    expect(JSON.stringify(parseSection(next.text, '0.2.0'))).not.toMatch(
      /Updated dependencies|core@0\.2\.0/
    )
    expect(parseSection(core.text, '0.2.0')).toEqual({
      Patch: ['Shared fix.\n\n  - detail one\n  - detail two'],
    })
  })

  test('a section with no entries is an empty object', () => {
    expect(parseSection(sdk.text, '0.2.0')).toEqual({})
  })

  test('does not match a version that only shares a prefix', () => {
    expect(
      parseSection('## 0.2.10\n\n### Patch Changes\n\n- a: x\n', '0.2.1')
    ).toBeNull()
  })
})

describe('buildReleaseNotes', () => {
  const body = buildReleaseNotes('0.2.0', [next, core, sdk])

  test('dedupes the same entry across packages', () => {
    expect(body.match(/Shared fix\./g)).toHaveLength(1)
  })

  test('groups by bump, Minor before Patch, and never mentions older versions', () => {
    expect(body.indexOf('### Minor changes')).toBeGreaterThan(-1)
    expect(body.indexOf('### Minor changes')).toBeLessThan(
      body.indexOf('### Patch changes')
    )
    expect(body).not.toContain('Old thing')
  })

  test('has no dependency noise', () => {
    expect(body).not.toMatch(/Updated dependencies/)
  })

  test('header lists packages with an install line, footer links npm and docs', () => {
    expect(body).toContain('npm i @next-federation/next@0.2.0')
    for (const n of ['core', 'next', 'sdk']) {
      expect(body).toContain(`@next-federation/${n}`)
    }
    expect(body).toContain('https://www.npmjs.com/org/next-federation')
    expect(body).toContain('https://next-federation-docs.vercel.app')
  })

  test('fails clearly when no package has the version', () => {
    expect(() => buildReleaseNotes('9.9.9', [next, core, sdk])).toThrow(
      /No package changelog has a "## 9\.9\.9" section/
    )
  })

  test('a release that only bumps dependencies says so', () => {
    expect(buildReleaseNotes('0.2.0', [sdk])).toMatch(/No changes/)
  })
})

describe('commonVersion', () => {
  test('returns the one version', () => {
    expect(
      commonVersion([
        { name: 'a', version: '1.2.3' },
        { name: 'b', version: '1.2.3' },
      ])
    ).toBe('1.2.3')
  })

  test('throws naming the packages when versions differ', () => {
    expect(() =>
      commonVersion([
        { name: 'a', version: '1.2.3' },
        { name: 'b', version: '1.2.4' },
      ])
    ).toThrow(/a@1\.2\.3.*b@1\.2\.4/s)
  })

  test('throws when there are no packages', () => {
    expect(() => commonVersion([])).toThrow(/No packages/)
  })
})
