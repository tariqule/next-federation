/**
 * npm "staged" publishing, for the publish workflow (scripts/publish-wait.mjs).
 * npm holds a newly accepted version as staged for a few minutes; publishing
 * it again meanwhile fails with E409 "Cannot publish over previously staged
 * version", and `npm view` does not show it yet. Dependency-free and
 * injectable, so unit tests drive it without npm.
 */

/** @typedef {{ name: string, version: string }} PackageVersion */
/** @typedef {{ code: number, stdout: string }} ViewResult */

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
 *   view: (spec: string) => Promise<ViewResult>,
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
      const result = await io.view(`${v.name}@${v.version}`)
      if (!isVisible(result, v.version)) still.push(v)
    }
    pending = still
    if (pending.length === 0) return []
    const left = io.deadline - io.now()
    if (left <= 0) return pending
    await io.sleep(Math.min(io.intervalMs, left))
  }
}

/** @param {PackageVersion[]} versions */
const list = (versions) =>
  versions.map((v) => `${v.name}@${v.version}`).join(', ')

const MAX_RUNS = 10

/**
 * `pnpm release`, tolerating npm's staged publishing: when the only failures
 * are E409 "previously staged version", waits (up to `timeoutMs` in all)
 * until npm shows those versions, then runs `changeset publish` again, which
 * skips what npm shows and publishes what the failed run never reached (it
 * stops after a failed chunk) and creates the missing git tags. Any other
 * failure fails at once.
 * @param {{
 *   run: (command: string[]) => Promise<{ code: number, output: string }>,
 *   view: (spec: string) => Promise<ViewResult>,
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
    if (runs >= MAX_RUNS) {
      io.log(`::error::Still failing after ${runs} publish runs.`)
      return 1
    }
    io.log(`npm shows ${list(staged)}: publishing the rest.`)
    result = await io.run(['pnpm', 'exec', 'changeset', 'publish'])
  }
}
