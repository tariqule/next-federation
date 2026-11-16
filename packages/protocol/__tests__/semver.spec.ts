import { isSemverRange, isSemverVersion, satisfies } from '../src/semver.ts'

describe('isSemverVersion', () => {
  test.each(['1.0.0', '19.3.1', '2.0.0-beta.1', '1.2.3+build.5', '0.0.0'])(
    '%s is a version',
    (v) => expect(isSemverVersion(v)).toBe(true)
  )
  test.each([
    '',
    '1',
    '1.0',
    'v1.0.0',
    '1.0.0.0',
    'latest',
    '01.0.0',
    '^1.0.0',
  ])('%s is not', (v) => expect(isSemverVersion(v)).toBe(false))
})

describe('isSemverRange', () => {
  test.each([
    '^2.0.0',
    '~1.2',
    '>=1.0.0 <3',
    '1.x',
    '*',
    '2',
    '^1.0.0 || ^2.0.0',
    '1.0.0 - 2.0.0',
    '=1.2.3',
  ])('%s is a range', (r) => expect(isSemverRange(r)).toBe(true))
  test.each(['', 'latest', '^', '>=x.y', 'workspace:*', '^1.0.0 ||'])(
    '%s is not',
    (r) => expect(isSemverRange(r)).toBe(false)
  )
})

describe('satisfies', () => {
  const cases: Array<[string, string, boolean]> = [
    ['2.1.0', '^2.0.0', true],
    ['3.0.0', '^2.0.0', false],
    ['1.9.9', '^2.0.0', false],
    ['0.2.5', '^0.2.0', true],
    ['0.3.0', '^0.2.0', false],
    ['0.0.3', '^0.0.3', true],
    ['0.0.4', '^0.0.3', false],
    ['1.2.9', '~1.2.0', true],
    ['1.3.0', '~1.2.0', false],
    ['1.3.0', '~1', true],
    ['2.0.0', '>=1.0.0 <3', true],
    ['3.0.0', '>=1.0.0 <3', false],
    ['1.5.0', '1.x', true],
    ['2.0.0', '1.x', false],
    ['2.4.0', '2', true],
    ['7.0.0', '*', true],
    ['2.0.0', '^1.0.0 || ^2.0.0', true],
    ['3.0.0', '^1.0.0 || ^2.0.0', false],
    ['1.5.0', '1.0.0 - 2.0.0', true],
    ['2.0.1', '1.0.0 - 2.0.0', false],
    ['1.2.3', '=1.2.3', true],
    ['1.2.3', '1.2.3', true],
    ['1.2.4', '1.2.3', false],
    ['1.2.4', '>1.2.3', true],
    ['1.2.3', '<=1.2.3', true],
    // A prerelease satisfies only a range naming a prerelease of its own triple.
    ['2.0.0-beta.1', '^2.0.0', false],
    ['2.0.0-beta.2', '^2.0.0-beta.1', true],
    ['2.0.0', '^2.0.0-beta.1', true],
    ['2.0.0-alpha', '>=2.0.0-beta', false],
    // Build metadata is ignored.
    ['2.0.0+abc', '^2.0.0', true],
  ]
  test.each(cases)('%s in %s: %s', (version, range, expected) =>
    expect(satisfies(version, range)).toBe(expected)
  )

  test('an invalid version or range never satisfies', () => {
    expect(satisfies('nope', '^1.0.0')).toBe(false)
    expect(satisfies('1.0.0', 'latest')).toBe(false)
  })
})
