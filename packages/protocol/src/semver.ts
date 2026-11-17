// A small semver subset for shared-module negotiation (remote components):
// versions `x.y.z[-pre][+build]`, and npm ranges built from comparators
// (`<`, `<=`, `>`, `>=`, `=`), `^`, `~`, x-ranges (`1.x`, `2`, `*`), hyphen
// ranges (`1.0.0 - 2.0.0`), space (and) and `||` (or). No dependencies.

type Version = { major: number; minor: number; patch: number; pre: string[] }
type Comparator = { op: '<' | '<=' | '>' | '>=' | '='; v: Version }

const NUM = '0|[1-9]\\d*'
const PRE_ID = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)'
const VERSION = new RegExp(
  `^(${NUM})\\.(${NUM})\\.(${NUM})(?:-(${PRE_ID}(?:\\.${PRE_ID})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`
)
// A partial version in a range: `1`, `1.2`, `1.x`, `*`, `1.2.3-beta`.
const XR = '(?:[xX*]|0|[1-9]\\d*)'
const PARTIAL = new RegExp(
  `^v?(${XR})(?:\\.(${XR})(?:\\.(${XR})(?:-(${PRE_ID}(?:\\.${PRE_ID})*))?)?)?(?:\\+[0-9A-Za-z-.]+)?$`
)

function parseVersion(value: string): Version | null {
  const m = VERSION.exec(value)
  if (!m) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? m[4].split('.') : [],
  }
}

/** True for a full semver version (`1.2.3`, `2.0.0-beta.1`). */
export function isSemverVersion(value: string): boolean {
  return parseVersion(value) !== null
}

function comparePre(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return b.length - a.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny) return Number(x) - Number(y)
    if (nx) return -1
    if (ny) return 1
    return x < y ? -1 : 1
  }
  return 0
}

function compare(a: Version, b: Version): number {
  return (
    a.major - b.major ||
    a.minor - b.minor ||
    a.patch - b.patch ||
    comparePre(a.pre, b.pre)
  )
}

const isX = (part: string | undefined) =>
  part === undefined || part === 'x' || part === 'X' || part === '*'

const v = (major: number, minor = 0, patch = 0, pre: string[] = []) => ({
  major,
  minor,
  patch,
  pre,
})

type Partial = {
  major: string
  minor: string | undefined
  patch: string | undefined
  pre: string[]
}

function parsePartial(value: string): Partial | null {
  const m = PARTIAL.exec(value)
  if (!m) return null
  return {
    major: m[1]!,
    minor: m[2],
    patch: m[3],
    pre: m[4] ? m[4].split('.') : [],
  }
}

/** The comparators of one partial version used as a whole range (`1.x`, `1.2`). */
function xRange(p: Partial): Comparator[] {
  if (isX(p.major)) return []
  const major = Number(p.major)
  if (isX(p.minor)) {
    return [
      { op: '>=', v: v(major) },
      { op: '<', v: v(major + 1, 0, 0, ['0']) },
    ]
  }
  const minor = Number(p.minor)
  if (isX(p.patch)) {
    return [
      { op: '>=', v: v(major, minor) },
      { op: '<', v: v(major, minor + 1, 0, ['0']) },
    ]
  }
  return [{ op: '=', v: v(major, minor, Number(p.patch), p.pre) }]
}

function caret(p: Partial): Comparator[] | null {
  if (isX(p.major)) return []
  const major = Number(p.major)
  const minor = isX(p.minor) ? null : Number(p.minor)
  const patch = isX(p.patch) ? null : Number(p.patch)
  const low = v(major, minor ?? 0, patch ?? 0, p.pre)
  let high: Version
  if (major > 0 || minor === null) high = v(major + 1)
  else if (minor > 0 || patch === null) high = v(0, minor + 1)
  else high = v(0, 0, patch + 1)
  return [
    { op: '>=', v: low },
    { op: '<', v: { ...high, pre: ['0'] } },
  ]
}

function tilde(p: Partial): Comparator[] | null {
  if (isX(p.major)) return []
  const major = Number(p.major)
  if (isX(p.minor)) return xRange(p)
  const minor = Number(p.minor)
  const patch = isX(p.patch) ? 0 : Number(p.patch)
  return [
    { op: '>=', v: v(major, minor, patch, p.pre) },
    { op: '<', v: v(major, minor + 1, 0, ['0']) },
  ]
}

/** `>1.2` and friends: a comparator whose version may be partial. */
function primitive(op: string, p: Partial): Comparator[] | null {
  if (isX(p.major)) return op === '<' || op === '>' ? null : []
  const major = Number(p.major)
  const minor = isX(p.minor) ? null : Number(p.minor)
  const patch = isX(p.patch) ? null : Number(p.patch)
  if (minor !== null && patch !== null) {
    return [
      {
        op: (op || '=') as Comparator['op'],
        v: v(major, minor, patch, p.pre),
      },
    ]
  }
  // Partial: `>=1.2` is `>=1.2.0`, `>1.2` is `>=1.3.0-0`, `<=1.2` is `<1.3.0-0`.
  const next =
    minor === null ? v(major + 1, 0, 0, ['0']) : v(major, minor + 1, 0, ['0'])
  const low = v(major, minor ?? 0)
  switch (op) {
    case '>=':
      return [{ op: '>=', v: low }]
    case '>':
      return [{ op: '>=', v: next }]
    case '<':
      return [{ op: '<', v: { ...low, pre: ['0'] } }]
    case '<=':
      return [{ op: '<', v: next }]
    default:
      return xRange(p)
  }
}

const COMPARATOR = /^(\^|~>?|>=|<=|>|<|=)?\s*(.+)$/

/** One `||` alternative: comparators that must all hold; null when invalid. */
function parseSet(set: string): Comparator[] | null {
  const trimmed = set.trim()
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(trimmed)
  if (hyphen) {
    const from = parsePartial(hyphen[1]!)
    const to = parsePartial(hyphen[2]!)
    if (!from || !to) return null
    const low = primitive('>=', from)
    const high = primitive('<=', to)
    return low && high ? [...low, ...high] : null
  }
  // `>= 1.2.3`: join an operator with its version.
  const tokens = trimmed.replace(/(\^|~>?|>=|<=|>|<|=)\s+/g, '$1').split(/\s+/)
  const out: Comparator[] = []
  for (const token of tokens) {
    if (token === '') return null
    const m = COMPARATOR.exec(token)
    if (!m) return null
    const op = m[1] ?? ''
    const p = parsePartial(m[2]!)
    if (!p) return null
    const parsed =
      op === '^'
        ? caret(p)
        : op.startsWith('~')
          ? tilde(p)
          : op === ''
            ? xRange(p)
            : primitive(op, p)
    if (!parsed) return null
    out.push(...parsed)
  }
  return out
}

function parseRange(range: string): Comparator[][] | null {
  if (range.trim() === '') return null
  const sets = range.split('||').map(parseSet)
  return sets.every((s) => s !== null) ? (sets as Comparator[][]) : null
}

/** True for an npm semver range this module understands. */
export function isSemverRange(range: string): boolean {
  return parseRange(range) !== null
}

function test(version: Version, c: Comparator): boolean {
  const r = compare(version, c.v)
  switch (c.op) {
    case '<':
      return r < 0
    case '<=':
      return r <= 0
    case '>':
      return r > 0
    case '>=':
      return r >= 0
    default:
      return r === 0
  }
}

function satisfiesSet(version: Version, set: Comparator[]): boolean {
  if (!set.every((c) => test(version, c))) return false
  if (version.pre.length === 0) return true
  // npm: a prerelease matches only when a comparator of the set names a
  // prerelease of the same major.minor.patch.
  return set.some(
    (c) =>
      c.v.pre.length > 0 &&
      c.v.pre[0] !== '0' &&
      c.v.major === version.major &&
      c.v.minor === version.minor &&
      c.v.patch === version.patch
  )
}

/** True when `version` satisfies the npm range `range` (false if either is invalid). */
export function satisfies(version: string, range: string): boolean {
  const parsed = parseVersion(version)
  const sets = parseRange(range)
  if (!parsed || !sets) return false
  return sets.some((set) => satisfiesSet(parsed, set))
}
