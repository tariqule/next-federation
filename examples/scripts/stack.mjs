// Starts and stops the example apps: the five simple ones by default, or
// another list (the commerce platform, platform.mjs). Used by run.mjs
// (examples:dev, examples:start, examples:smoke), walkthrough.mjs and
// platform.mjs.
import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, rmSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join } from 'node:path'

export const EXAMPLES = join(import.meta.dirname, '..')
const LOGS = join(EXAMPLES, '.logs')

export const URLS = {
  remote: 'http://127.0.0.1:3300',
  app: 'http://localhost:3301',
  pages: 'http://localhost:3302/shop',
  spa: 'http://localhost:3303',
  components: 'http://127.0.0.1:3304',
}

/**
 * The apps, in start order. `dev` and `start` are package scripts; `build`
 * runs before `start` (and before `dev` for the components remote: hosts
 * server-render client components from a build only).
 */
export const APPS = [
  {
    key: 'remote',
    dir: 'vite-remote',
    port: 3300,
    ready: `${URLS.remote}/_nf/health`,
    remote: true,
  },
  {
    key: 'components',
    dir: 'components-remote',
    port: 3304,
    ready: `${URLS.components}/_nf/components.json`,
    remote: true,
    buildInDev: true,
  },
  { key: 'app', dir: 'next-app-router', port: 3301, ready: `${URLS.app}/` },
  { key: 'pages', dir: 'next-pages-router', port: 3302, ready: URLS.pages },
  { key: 'spa', dir: 'react-spa', port: 3303, ready: `${URLS.spa}/` },
]

const running = new Map()

/**
 * Checks start clean: empty logs, and empty Next caches (island envelopes and
 * descriptors cached by an earlier run would show older remote builds).
 */
export function freshRun(apps = APPS) {
  rmSync(LOGS, { recursive: true, force: true })
  for (const app of apps.filter((a) => a.next ?? a.dir.startsWith('next-'))) {
    rmSync(join(EXAMPLES, app.dir, '.next', 'cache'), {
      recursive: true,
      force: true,
    })
  }
}

/** True when something already listens on the port (never reuse it). */
function portBusy(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

export async function assertPortsFree(apps = APPS) {
  const busy = []
  for (const app of apps) if (await portBusy(app.port)) busy.push(app.port)
  if (busy.length > 0) {
    throw new Error(
      `port(s) ${busy.join(', ')} already in use: stop what runs there first.`
    )
  }
}

/**
 * Runs `pnpm run <script>` in an example's folder, in its own process group
 * (so stopping it stops Next's and Vite's child processes too). `stdio`:
 * 'inherit' with a prefix (examples:dev) or a log file under examples/.logs.
 */
function pnpmRun(app, script, { log, env } = {}) {
  const child = spawn('pnpm', ['run', '--silent', script], {
    cwd: join(EXAMPLES, app.dir),
    detached: true,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (log === 'console') {
    const prefix = `[${app.key}] `
    const write = (stream) => (chunk) =>
      stream.write(
        String(chunk)
          .split('\n')
          .filter(Boolean)
          .map((l) => prefix + l + '\n')
          .join('')
      )
    child.stdout.on('data', write(process.stdout))
    child.stderr.on('data', write(process.stderr))
  } else {
    mkdirSync(LOGS, { recursive: true })
    const file = createWriteStream(join(LOGS, `${app.key}.log`), { flags: 'a' })
    child.stdout.pipe(file)
    child.stderr.pipe(file)
  }
  return child
}

function exited(child) {
  return new Promise((resolve) => child.once('exit', (code) => resolve(code)))
}

/** Runs a package script to completion; throws on a non-zero exit. */
export async function runScript(app, script, options) {
  const child = pnpmRun(app, script, options)
  // Tracked like a server, so stopAll() also stops a build in progress.
  const key = `${app.key}:${script}`
  running.set(key, child)
  const code = await exited(child)
  running.delete(key)
  if (code !== 0) {
    throw new Error(
      `${app.dir}: \`pnpm run ${script}\` exited with ${code} (see examples/.logs/${app.key}.log)`
    )
  }
}

/** Starts a long-running package script (dev or start). */
export function startScript(app, script, options) {
  const child = pnpmRun(app, script, options)
  running.set(app.key, child)
  child.once('exit', () => {
    if (running.get(app.key) === child) running.delete(app.key)
  })
  return child
}

export async function waitFor(url, timeoutMs = 240_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try {
      const res = await fetch(url, { redirect: 'manual' })
      if (res.status < 500) return
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000} s`)
}

/** Stops one app (its whole process group) and waits for it to exit. */
export async function stopApp(key) {
  const child = running.get(key)
  if (!child) return
  running.delete(key)
  const done = exited(child)
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    return
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }, 5000)
  await done
  clearTimeout(timer)
}

export async function stopAll() {
  await Promise.all([...running.keys()].map(stopApp))
}

/**
 * mode 'dev': the island remote and the hosts run their dev servers; the
 * components remote is built and served. mode 'start': everything is
 * built, then served as in production. Remotes start first: Next builds
 * prerender pages that fetch from them.
 */
export async function startStack(mode, { log, apps = APPS } = {}) {
  await assertPortsFree(apps)
  const remotes = apps.filter((a) => a.remote)
  const hosts = apps.filter((a) => !a.remote)
  if (mode === 'dev') {
    await Promise.all(
      apps
        .filter((a) => a.buildInDev)
        .map((a) => runScript(a, 'build', { log }))
    )
    for (const a of apps)
      startScript(a, a.buildInDev ? 'start' : 'dev', { log })
    await Promise.all(apps.map((a) => waitFor(a.ready)))
    return
  }
  await Promise.all(remotes.map((a) => runScript(a, 'build', { log })))
  for (const a of remotes) startScript(a, 'start', { log })
  await Promise.all(remotes.map((a) => waitFor(a.ready)))
  await Promise.all(hosts.map((a) => runScript(a, 'build', { log })))
  for (const a of hosts) startScript(a, 'start', { log })
  await Promise.all(hosts.map((a) => waitFor(a.ready)))
}

/** Stop everything on Ctrl-C or a kill, then exit. */
export function stopOnSignal() {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      void stopAll().then(() => process.exit(130))
    })
  }
}
