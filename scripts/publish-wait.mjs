// The publish workflow's publish step: `pnpm release`, tolerating npm's staged
// publishing when npm's provenance shows the staged versions were built from
// this commit (see lib/publish-wait.mjs and docs/releasing.md).
// NF_PUBLISH_WAIT_MINUTES sets how long to wait for staged versions (15).
import { execFile, spawn } from 'node:child_process'
import { publishWithStagedWait } from './lib/publish-wait.mjs'

/** Runs a command, showing its output as it comes and keeping a copy. */
function run(/** @type {string[]} */ [command, ...args]) {
  return new Promise((resolve) => {
    let output = ''
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      output += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      output += String(chunk)
    })
    child.on('error', (error) => {
      output += String(error)
      resolve({ code: 1, output })
    })
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
  })
}

/** Runs a command without a shell; its exit code and stdout. */
function capture(/** @type {string} */ command, /** @type {string[]} */ args) {
  return new Promise((resolve) => {
    execFile(command, args, (error, stdout) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
      resolve({ code, stdout: String(stdout) })
    })
  })
}

/** `npm view <spec> <field> --json`. */
function view(/** @type {string} */ spec, /** @type {string} */ field) {
  return capture('npm', ['view', spec, field, '--json'])
}

/** The commit this run publishes from. */
async function head() {
  const { code, stdout } = await capture('git', ['rev-parse', 'HEAD'])
  return code === 0 ? stdout.trim() : null
}

/** GETs a JSON document: its status, and its body when it parses. */
async function fetchJson(/** @type {string} */ url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    /** @type {unknown} */
    let json
    try {
      json = await response.json()
    } catch {
      json = undefined
    }
    return { status: response.status, json }
  } catch {
    return { status: 0, json: undefined }
  }
}

// The repository npm's provenance must name: this run's.
const repository = `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY ?? 'tariqule/next-federation'}`

const minutes = Number(process.env.NF_PUBLISH_WAIT_MINUTES ?? 15)

process.exitCode = await publishWithStagedWait({
  run,
  view,
  fetchJson,
  head,
  repository,
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (line) => console.log(line),
  timeoutMs: (Number.isFinite(minutes) && minutes > 0 ? minutes : 15) * 60_000,
  intervalMs: 20_000,
})
