/**
 * npm "staged" publishing, for the publish workflow (scripts/publish-wait.mjs).
 * npm holds a newly accepted version as staged for a few minutes; publishing
 * it again meanwhile fails with E409 "Cannot publish over previously staged
 * version", and `npm view` does not show it yet. Dependency-free and
 * injectable, so unit tests drive it without npm.
 */

/** @typedef {{ name: string, version: string }} PackageVersion */
/** @typedef {{ code: number, stdout: string }} ViewResult */
/** @typedef {{ status: number, json: unknown }} FetchResult */

const MARKER = 'Some packages failed to publish:'
const STAGED = /previously staged version/i
// clack's gutter and symbols (Unicode, or the ASCII fallback), before the text.
const GUTTER = /^\s*(?:(?:[│┃|■▲◆◇●○◒◐◓◑]|x(?=\s{2}))\s*)*/
// A clack symbol that starts a new message (not the bar continuing one).
const NEW_MESSAGE = /^\s*(?:[■▲◆◇●○◒◐◓◑]|x(?=\s{2}))/
const PACKAGE_LINE =
  /^(@[a-z0-9][\w.-]*\/[\w.-]+|[a-z0-9][\w.-]*)@(\d+\.\d+\.\d+(?:[-+][\w.+-]*)?)$/i

/** @param {string} text */
function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}

/**
 * The packages `changeset publish` lists as failed, each with its error
 * text, from the "Some packages failed to publish:" block; null when the
 * output has no such block.
 * @param {string} output
 * @returns {{ name: string, version: string, error: string }[] | null}
 */
export function failedPublishes(output) {
  const lines = stripAnsi(output).split(/\r?\n/)
  const start = lines.findIndex((line) => line.includes(MARKER))
  if (start === -1) return null
  /** @type {{ name: string, version: string, error: string }[]} */
  const failed = []
  for (const raw of lines.slice(start + 1)) {
    if (NEW_MESSAGE.test(raw)) break
    const line = raw.replace(GUTTER, '').trim()
    if (line === '') continue
    const pkg = PACKAGE_LINE.exec(line)
    if (pkg) {
      failed.push({ name: pkg[1], version: pkg[2], error: '' })
      continue
    }
    const current = failed.at(-1)
    if (!current) break
    current.error += `${line.replace(/^└\s*/, '')}\n`
  }
  return failed
}

/**
 * The versions that failed only because npm already holds them as staged,
 * or null when anything else failed (or the output lists no failures).
 * @param {string} output combined output of `pnpm release`
 * @returns {PackageVersion[] | null}
 */
export function stagedConflicts(output) {
  const failed = failedPublishes(output)
  if (!failed || failed.length === 0) return null
  if (!failed.every((f) => STAGED.test(f.error))) return null
  return failed.map(({ name, version }) => ({ name, version }))
}

/**
 * Whether `npm view <name>@<version> version --json` shows that version.
 * npm prints nothing (exit 0) for a version it does not show, such as a
 * staged one; a new package may show only a `0.0.0-stage` placeholder.
 * @param {ViewResult} result
 * @param {string} version
 */
export function isVisible(result, version) {
  if (result.code !== 0) return false
  const text = result.stdout.trim()
  if (text === '') return false
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.includes(version) : parsed === version
  } catch {
    return text === version
  }
}

/**
 * Polls npm until each version is visible or `deadline` passes.
 * @param {PackageVersion[]} versions
 * @param {{
 *   view: (spec: string, field: string) => Promise<ViewResult>,
 *   now: () => number,
 *   sleep: (ms: number) => Promise<void>,
 *   deadline: number,
 *   intervalMs: number,
 * }} io
 * @returns {Promise<PackageVersion[]>} the versions still not visible
 */
export async function waitUntilVisible(versions, io) {
  let pending = [...versions]
  for (;;) {
    const still = []
    for (const v of pending) {
      const result = await io.view(`${v.name}@${v.version}`, 'version')
      if (!isVisible(result, v.version)) still.push(v)
    }
    pending = still
    if (pending.length === 0) return []
    const left = io.deadline - io.now()
    if (left <= 0) return pending
    await io.sleep(Math.min(io.intervalMs, left))
  }
}

const COMMIT = /^[0-9a-f]{40}$/
const SLSA_PROVENANCE = 'https://slsa.dev/provenance/v1'
// The workflow that publishes (.github/workflows/publish.yml).
const WORKFLOW = '.github/workflows/publish.yml'

/**
 * The commit `npm view <spec> gitHead --json` names. npm records it only when
 * it publishes a git checkout's folder: pnpm (and so `changeset publish`)
 * publishes a packed tarball, which records none. It is whatever the
 * publisher's package.json says, so it can show that a version came from
 * another commit, never prove that it came from this one.
 * @param {ViewResult} result
 * @returns {{ kind: 'commit', commit: string } | { kind: 'none' } | { kind: 'unreadable' }}
 */
export function readGitHead(result) {
  if (result.code !== 0) return { kind: 'unreadable' }
  const text = result.stdout.trim()
  if (text === '') return { kind: 'none' }
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed === 'string' && COMMIT.test(parsed))
      return { kind: 'commit', commit: parsed }
  } catch {
    // not JSON
  }
  return { kind: 'unreadable' }
}

/**
 * npm's attestations for a version (the registry checked them when it
 * accepted the version).
 * @param {string} name
 * @param {string} version
 */
export function attestationsUrl(name, version) {
  return `https://registry.npmjs.org/-/npm/v1/attestations/${name.replaceAll('/', '%2f')}@${encodeURIComponent(version)}`
}

/**
 * The package URL npm attests a version as (npm-package-arg's `toPurl`: the
 * scope's `@` encoded, the version as published).
 * @param {string} name
 * @param {string} version
 */
export function purl(name, version) {
  return `pkg:npm/${name.replace(/^@/, '%40')}@${version}`
}

/** @param {unknown} value */
const isRecord = (value) => typeof value === 'object' && value !== null

/**
 * What a version's SLSA provenance names, from npm's attestations response:
 * the package it describes (`subject`, a package URL), and for GitHub
 * Actions the workflow's repository and file (`path`), the source it checked
 * out (`uri`, `git+<repository>@<ref>`) and that source's commit. The
 * values are npm's, unvalidated: compare them, never log them.
 * @param {FetchResult} response
 * @returns {{ kind: 'build', subject: string, repository: string, path: string, uri: string, commit: string } | { kind: 'none' } | { kind: 'unreadable' }}
 */
export function readProvenance(response) {
  if (response.status === 404) return { kind: 'none' }
  const { json } = response
  if (response.status !== 200 || !isRecord(json)) return { kind: 'unreadable' }
  if (!Array.isArray(json.attestations)) return { kind: 'unreadable' }
  const slsa = json.attestations.find(
    (a) => isRecord(a) && a.predicateType === SLSA_PROVENANCE
  )
  if (!slsa) return { kind: 'none' }
  try {
    const payload = slsa.bundle.dsseEnvelope.payload
    if (typeof payload !== 'string') return { kind: 'unreadable' }
    const statement = JSON.parse(Buffer.from(payload, 'base64').toString())
    if (statement.predicateType !== SLSA_PROVENANCE)
      return { kind: 'unreadable' }
    const subject = statement.subject[0].name
    const build = statement.predicate.buildDefinition
    const { repository, path } = build.externalParameters.workflow
    const source = build.resolvedDependencies[0]
    const uri = source.uri
    const commit = source.digest.gitCommit
    const fields = [subject, repository, path, uri, commit]
    if (!fields.every((field) => typeof field === 'string'))
      return { kind: 'unreadable' }
    if (!COMMIT.test(commit)) return { kind: 'unreadable' }
    return { kind: 'build', subject, repository, path, uri, commit }
  } catch {
    return { kind: 'unreadable' }
  }
}

/**
 * Whether npm's `name@version` was built from `head` of `repository` by the
 * publish workflow: its provenance must describe `name@version` and name
 * `repository`, the workflow file, a source in `repository` and `head` (this
 * workflow always publishes with provenance), and a gitHead, if npm has one,
 * must name `head` too. Returns
 * the error to log, or null. Only validated values appear in it: the name
 * and version (PACKAGE_LINE), commit SHAs and our own repository URL.
 * @param {PackageVersion} v
 * @param {string} head
 * @param {{
 *   view: (spec: string, field: string) => Promise<ViewResult>,
 *   fetchJson: (url: string) => Promise<FetchResult>,
 *   repository: string,
 * }} io
 * @returns {Promise<string | null>}
 */
async function checkOrigin(v, head, io) {
  const spec = `${v.name}@${v.version}`
  const other = (/** @type {string} */ what) =>
    `::error::npm shows ${spec}, but ${what}, and this run is at ${head}: the version npm approved is not shown to be this run's code, so this run publishes and tags nothing more. Inspect it (\`npm pack ${spec}\`). If it is not what you meant to release, deprecate it (\`npm deprecate ${spec} "<reason>"\`) and release a new version: npm never allows publishing a version again.`
  const gitHead = readGitHead(await io.view(spec, 'gitHead'))
  if (gitHead.kind === 'commit' && gitHead.commit !== head)
    return other(`its gitHead is ${gitHead.commit}`)
  const provenance = readProvenance(
    await io.fetchJson(attestationsUrl(v.name, v.version))
  )
  if (provenance.kind === 'build') {
    if (provenance.subject !== purl(v.name, v.version))
      return other(
        `its provenance describes a package other than ${purl(v.name, v.version)}`
      )
    if (provenance.repository !== io.repository)
      return other(
        `its provenance names a repository other than ${io.repository}`
      )
    if (!provenance.uri.startsWith(`git+${io.repository}@`))
      return other(`its provenance names a source outside ${io.repository}`)
    if (provenance.path !== WORKFLOW)
      return other(`its provenance names a workflow other than ${WORKFLOW}`)
    if (provenance.commit !== head)
      return other(`its provenance names commit ${provenance.commit}`)
    return null
  }
  const why =
    provenance.kind === 'none'
      ? 'it has no provenance (this workflow always publishes with provenance, so it was staged some other way)'
      : 'npm did not return a readable provenance for it'
  return `::error::npm shows ${spec}, but ${why}, so this run cannot tell which commit it was built from and publishes and tags nothing more. Check it by hand: compare \`npm pack ${spec}\` with a build of ${head}. If they match, tag it (\`git tag ${spec} ${head}\`, then \`git push origin ${spec}\`) and run this workflow again: it skips the versions npm shows and publishes the rest. If not, deprecate it (\`npm deprecate ${spec} "<reason>"\`) and release a new version.`
}

/** @param {PackageVersion[]} versions */
const list = (versions) =>
  versions.map((v) => `${v.name}@${v.version}`).join(', ')

const MAX_RUNS = 10

/**
 * `pnpm release`, tolerating npm's staged publishing: when the only failures
 * are E409 "previously staged version", waits (up to `timeoutMs` in all)
 * until npm shows those versions, checks that npm's provenance for each
 * names this repository and `head` (see checkOrigin), then runs `changeset
 * publish` again, which skips what npm shows and publishes what the failed
 * run never reached (it stops after a failed chunk), tagging what it
 * publishes at HEAD (never the staged versions: it tags only what it
 * publishes itself). Any other failure, or a staged version this run cannot
 * show was built from HEAD, fails at once.
 * @param {{
 *   run: (command: string[]) => Promise<{ code: number, output: string }>,
 *   view: (spec: string, field: string) => Promise<ViewResult>,
 *   fetchJson: (url: string) => Promise<FetchResult>,
 *   head: () => Promise<string | null>,
 *   repository: string,
 *   now: () => number,
 *   sleep: (ms: number) => Promise<void>,
 *   log: (line: string) => void,
 *   timeoutMs: number,
 *   intervalMs: number,
 * }} io
 * @returns {Promise<number>} the exit code
 */
export async function publishWithStagedWait(io) {
  const deadline = io.now() + io.timeoutMs
  let result = await io.run(['pnpm', 'release'])
  for (let runs = 1; ; runs++) {
    if (result.code === 0) return 0
    const staged = stagedConflicts(result.output)
    if (!staged) {
      io.log('::error::The release failed (see the output above).')
      return 1
    }
    io.log(
      `npm holds ${list(staged)} as staged (E409 "Cannot publish over previously staged version"): waiting until npm shows ${staged.length === 1 ? 'it' : 'them'}.`
    )
    const missing = await waitUntilVisible(staged, { ...io, deadline })
    if (missing.length > 0) {
      io.log(
        `::error::npm still does not show ${list(missing)} after ${Math.round(io.timeoutMs / 60_000)} min. Approve ${missing.length === 1 ? 'it' : 'them'} on npmjs.com (the package's Staged Packages), or with \`npm stage list <name>\` and \`npm stage approve <stage-id>\` (2FA), then run this workflow again: it skips versions npm already shows.`
      )
      return 1
    }
    const head = await io.head()
    if (head === null || !COMMIT.test(head)) {
      io.log(
        '::error::`git rev-parse HEAD` gave no commit, so this run cannot check which commit npm built the staged versions from.'
      )
      return 1
    }
    const errors = []
    for (const v of staged) {
      const error = await checkOrigin(v, head, io)
      if (error) errors.push(error)
    }
    if (errors.length > 0) {
      for (const error of errors) io.log(error)
      return 1
    }
    if (runs >= MAX_RUNS) {
      io.log(`::error::Still failing after ${runs} publish runs.`)
      return 1
    }
    io.log(
      `npm shows ${list(staged)}, built from ${head}: publishing the rest.`
    )
    io.log(
      `::warning::changeset publish tags only what it publishes: tag ${list(staged)} at ${head} by hand (docs/releasing.md).`
    )
    result = await io.run(['pnpm', 'exec', 'changeset', 'publish'])
  }
}
