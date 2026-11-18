// The publish workflow's publish step: `pnpm release`, tolerating npm's staged
// publishing (see lib/publish-wait.mjs and docs/releasing.md).
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

/** `npm view <spec> version --json`. */
function view(/** @type {string} */ spec) {
  return new Promise((resolve) => {
    execFile('npm', ['view', spec, 'version', '--json'], (error, stdout) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
      resolve({ code, stdout: String(stdout) })
    })
  })
}

const minutes = Number(process.env.NF_PUBLISH_WAIT_MINUTES ?? 15)

process.exitCode = await publishWithStagedWait({
  run,
  view,
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (line) => console.log(line),
  timeoutMs: (Number.isFinite(minutes) && minutes > 0 ? minutes : 15) * 60_000,
  intervalMs: 20_000,
})
