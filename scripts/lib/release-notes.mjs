/**
 * GitHub Release notes for the publish workflow (scripts/release-notes.mjs).
 * Builds one Markdown body from the `## <version>` sections of the package
 * changelogs. Pure and dependency-free, so unit tests drive it without files.
 */

/** @typedef {{ name: string, text: string }} Changelog */
/** @typedef {{ name: string, version: string }} PackageVersion */
/** @typedef {Record<string, string[]>} Section entries by bump ("Minor", "Patch", ...) */

export const DOCS_URL = 'https://next-federation-docs.vercel.app'
export const NPM_ORG_URL = 'https://www.npmjs.com/org/next-federation'
const INSTALL_PACKAGE = '@next-federation/next'
const BUMP_ORDER = ['Major', 'Minor', 'Patch']

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Dependency bookkeeping that changesets writes into every dependent's changelog. */
function isDependencyNoise(entry) {
  const first = entry.split('\n', 1)[0].trim()
  return (
    /^Updated dependencies\b/i.test(first) ||
    /^@[a-z0-9][\w.-]*\/[\w.-]+@\d+\.\d+\.\d+\S*$/i.test(first)
  )
}

/**
 * The entries of one version's section, by bump, with the commit hash removed
 * and dependency noise dropped; `null` when the changelog has no such section.
 * @param {string} text
 * @param {string} version
 * @returns {Section | null}
 */
export function parseSection(text, version) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) =>
    new RegExp(`^##\\s+${escapeRegExp(version)}\\s*$`).test(l)
  )
  if (start === -1) return null
  /** @type {Section} */
  const out = {}
  let bump = 'Other'
  /** @type {string[] | null} */
  let current = null
  const flush = () => {
    if (!current) return
    while (current.length > 1 && current[current.length - 1].trim() === '') {
      current.pop()
    }
    const entry = current.join('\n')
    if (!isDependencyNoise(entry)) (out[bump] ??= []).push(entry)
    current = null
  }
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line) && !/^###/.test(line)) break
    const heading = /^###\s+(\S+)/.exec(line)
    if (heading) {
      flush()
      bump = heading[1]
    } else if (/^- /.test(line)) {
      flush()
      current = [line.slice(2).replace(/^[0-9a-f]{7,40}: /, '')]
    } else if (current) {
      // A continuation (indented or blank); whitespace-only lines become empty.
      current.push(line.trim() === '' ? '' : line)
    }
  }
  flush()
  return out
}

/**
 * One Markdown release body for `version`.
 * @param {string} version
 * @param {Changelog[]} changelogs
 */
export function buildReleaseNotes(version, changelogs) {
  /** @type {{ name: string, section: Section }[]} */
  const found = []
  for (const { name, text } of changelogs) {
    const section = parseSection(text, version)
    if (section) found.push({ name, section })
  }
  if (found.length === 0) {
    throw new Error(
      `No package changelog has a "## ${version}" section. Merge the Version Packages pull request first.`
    )
  }

  // Merge by bump, dedupe identical entries (keeping the highest bump), in
  // the order they were first read.
  const bumps = [
    ...new Set([
      ...BUMP_ORDER,
      ...found.flatMap((f) => Object.keys(f.section)),
    ]),
  ]
  const seen = new Set()
  /** @type {Map<string, string[]>} */
  const merged = new Map()
  for (const bump of bumps) {
    for (const { section } of found) {
      for (const entry of section[bump] ?? []) {
        const key = entry.replace(/\s+/g, ' ').trim()
        if (seen.has(key)) continue
        seen.add(key)
        if (!merged.has(bump)) merged.set(bump, [])
        merged.get(bump).push(entry)
      }
    }
  }

  const names = found.map((f) => f.name).sort()
  const out = [
    `All \`@next-federation/*\` packages are released together as ${version}:`,
    '',
    ...names.map((n) => `- \`${n}\``),
    '',
    '```sh',
    `npm i ${INSTALL_PACKAGE}@${version}`,
    '```',
    '',
  ]
  if (merged.size === 0) {
    out.push('No changes in this release.', '')
  }
  for (const [bump, entries] of merged) {
    out.push(`### ${bump} changes`, '')
    for (const e of entries) out.push(`- ${e}`)
    out.push('')
  }
  out.push(
    '---',
    '',
    `Packages on [npm](${NPM_ORG_URL}). Documentation: ${DOCS_URL}`,
    ''
  )
  return out.join('\n')
}

/**
 * The version every package shares; throws when they differ.
 * @param {PackageVersion[]} packages
 */
export function commonVersion(packages) {
  if (packages.length === 0) throw new Error('No packages found.')
  const versions = new Set(packages.map((p) => p.version))
  if (versions.size !== 1) {
    throw new Error(
      `Package versions differ: ${packages.map((p) => `${p.name}@${p.version}`).join(', ')}`
    )
  }
  return packages[0].version
}
