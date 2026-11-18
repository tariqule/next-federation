// GHSA-xqc2-xf4c-x3h3: unauthenticated remote code execution in React Server
// Components (`react-server-dom-webpack`, `-parcel`, `-turbopack`). Shared by
// the Vite plugin (build-time check) and nf-serve (recorded build versions).

export const RSC_ADVISORY: { readonly id: string; readonly url: string } = {
  id: 'GHSA-xqc2-xf4c-x3h3',
  url: 'https://github.com/advisories/GHSA-xqc2-xf4c-x3h3',
}

// The first patched release of each affected React 19 minor line.
const PATCHED: Readonly<Record<string, number>> = {
  '19.0': 9,
  '19.1': 10,
  '19.2': 9,
  '19.3': 1,
}

export type FlightClientCheck =
  /** Not affected. */
  | { status: 'patched' }
  /** Affected; `patched` is the first patched release of its minor line. */
  | { status: 'affected'; patched: string }
  /** An experimental build (`0.0.0-*`) or no version at all: cannot be checked. */
  | { status: 'unverifiable' }

const VERSION = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * Checks a `react-server-dom-webpack` version against GHSA-xqc2-xf4c-x3h3.
 * A prerelease of an affected minor line below its patched release counts as
 * affected: React names every canary after 19.3.0 `19.3.0-canary-*`, so those
 * fail closed. Experimental builds (`0.0.0-*`, from React's main branch) and
 * anything that is not a version are unverifiable.
 */
export function checkFlightClientVersion(version: string): FlightClientCheck {
  const m = VERSION.exec(version)
  if (!m || (m[1] === '0' && m[2] === '0' && m[3] === '0')) {
    return { status: 'unverifiable' }
  }
  const line = `${m[1]}.${m[2]}`
  const fixed = PATCHED[line]
  if (fixed === undefined) return { status: 'patched' }
  const patch = Number(m[3])
  const affected = patch < fixed || (patch === fixed && m[4] !== undefined)
  return affected
    ? { status: 'affected', patched: `${line}.${fixed}` }
    : { status: 'patched' }
}

/**
 * Why `version` must not run, for an NF-041 message, or null when it may.
 * Names the advisory and what to install instead; `where` (a folder, a build)
 * follows the version in parentheses.
 */
export function flightClientAdvisoryDetail(
  version: string,
  where?: string
): string | null {
  const check = checkFlightClientVersion(version)
  const name = `react-server-dom-webpack ${version}${where ? ` (${where})` : ''}`
  const advisory = `${RSC_ADVISORY.id}, unauthenticated remote code execution in React Server Components (${RSC_ADVISORY.url})`
  if (check.status === 'affected') {
    const p = check.patched
    return `${name} is affected by ${advisory}. Install ${p} or later, with react and react-dom at the same exact version: npm install --save-exact react@${p} react-dom@${p} react-server-dom-webpack@${p}.`
  }
  if (check.status === 'unverifiable') {
    return `${name} cannot be checked against ${advisory}: it is an experimental build (0.0.0-*) or not a release version, and experimental builds cannot be checked against the advisory. Use a patched stable release (19.0.9, 19.1.10, 19.2.9, 19.3.1 or a later patch of the same minor), with react and react-dom at the same exact version.`
  }
  return null
}
