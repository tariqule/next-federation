// Starts a host that gets next-federation the way an app does: packed
// packages installed under a real node_modules, not a workspace link.
//
//   node fixtures/installed-host.ts <next version> <port> [next dev flag...]
//   node fixtures/installed-host.ts <react 18 host> <port>
//
// The first form is the installed-library host (installed-dev.spec.ts): the
// fixtures/installed-host template on the given Next and React 19.3.1. Extra
// arguments go to `next dev` (e.g. `--disable-source-maps`) and give the host
// its own work folder.
// The second form is one of REACT18_HOSTS (react18.spec.ts), a template under
// test/fixtures on React 18.3.1:
//   pages-next15-react18  test/fixtures/host-pages-next15-react18, Next 15
//   spa-react18           test/fixtures/host-spa-react18, Vite
// Their components remote is the react18 build (COMPONENTS_PORTS.react18,
// NF_SUITE=react18): this script passes its origin (and the Pages host its
// public key) as the in-repo fixtures import them, from
// fixtures/components-keys.ts and the lane. Everything else comes from the
// harness, as for the installed-library host: NF_PORT, NF_SIGNING_KEY and
// NF_REMOTE_A_ORIGIN (Pages host), VITE_NF_ORIGIN_A (SPA).
//
// createInstalledHost (below):
// 1. `pnpm pack`s the built packages (run `pnpm build` first) into
//    <work>/tarballs, where <work> is test/e2e/.installed[-<lane>]/<name>
//    (git-ignored).
// 2. Copies the template into <work>/app and writes its package.json: the
//    given React, the template's dependencies and the tarballs (pnpm
//    overrides point the packages' own @next-federation/* dependencies at the
//    tarballs).
// 3. `pnpm install --ignore-workspace` there (no lockfile: the newest
//    versions the ranges allow, as an app gets them).
// Then this script runs `next dev` (dev) or `next build` + `next start`
// (prod), honouring NF_BUNDLER; the SPA `vite` or `vite build` +
// `vite preview`.
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { laneName, lanePort } from '../lane.ts'
import { COMPONENTS_PORTS, COMPONENTS_PUBLIC_KEY } from './components-keys.ts'

/** The packages the installed-library host installs (the default set). */
export const PACKAGES = [
  'sdk',
  'protocol',
  'core',
  'react',
  'router',
  'next',
] as const
/** The installed-library host's React (the default). */
export const REACT = '19.3.1'

export type InstalledHostOptions = {
  /** Folder copied to <work>/app (it has no package.json of its own). */
  template: string
  /** react and react-dom, an exact version. */
  react: string
  /**
   * Packages under packages/ to pack: each is pinned to its tarball wherever
   * it is a dependency (pnpm overrides).
   */
  packages: readonly string[]
  /** The work folder's name under test/e2e/.installed[-<lane>]. */
  work: string
  /** Those of `packages` the app depends on directly. */
  direct: readonly string[]
  /** The app's other dependencies, besides react and react-dom. */
  dependencies: Readonly<Record<string, string>>
}

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..')
const fixtures = join(repo, 'test', 'fixtures')

const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] })

/**
 * Packs `packages`, copies `template` and installs it on `react` with the
 * tarballs, in a fresh work folder. Returns the app folder.
 */
export function createInstalledHost(options: InstalledHostOptions): string {
  const lane = laneName()
  const work = join(
    here,
    '..',
    lane ? `.installed-${lane}` : '.installed',
    options.work
  )
  const tarballs = join(work, 'tarballs')
  const app = join(work, 'app')
  for (const name of options.direct) {
    if (!options.packages.includes(name)) {
      throw new Error(`@next-federation/${name} is not in packages`)
    }
  }

  const started = Date.now()
  rmSync(work, { recursive: true, force: true })
  mkdirSync(tarballs, { recursive: true })
  for (const name of options.packages) {
    run(
      'pnpm',
      ['pack', '--pack-destination', tarballs],
      join(repo, 'packages', name)
    )
  }
  const tarball = (name: string): string => {
    const file = readdirSync(tarballs).find((f) =>
      f.startsWith(`next-federation-${name}-`)
    )
    if (!file) throw new Error(`no tarball for @next-federation/${name}`)
    return `file:${join(tarballs, file)}`
  }
  const local = Object.fromEntries(
    options.packages.map((name) => [`@next-federation/${name}`, tarball(name)])
  )

  cpSync(options.template, app, { recursive: true })
  const dependencies: Record<string, string> = {
    ...Object.fromEntries(
      options.direct.map((name) => [
        `@next-federation/${name}`,
        local[`@next-federation/${name}`]!,
      ])
    ),
    ...options.dependencies,
    react: options.react,
    'react-dom': options.react,
  }
  writeFileSync(
    join(app, 'package.json'),
    JSON.stringify(
      {
        name: `installed-host-${options.work}`,
        private: true,
        type: 'module',
        dependencies: Object.fromEntries(
          Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))
        ),
        pnpm: { overrides: local },
      },
      null,
      2
    )
  )
  run(
    'pnpm',
    ['install', '--ignore-workspace', '--prefer-offline', '--reporter=silent'],
    app
  )
  process.stderr.write(
    `installed-host ${options.work}: packed and installed in ${Math.round((Date.now() - started) / 1000)} s\n`
  )
  return app
}

/** Next 15 for the React 18 Pages host, as host-pages-next15. */
const NEXT15 = '15.5.28'
const REACT18 = '18.3.1'
const react18Origin = `http://127.0.0.1:${lanePort(COMPONENTS_PORTS.react18)}`

type Host = {
  options: InstalledHostOptions
  start: (app: string, port: string) => void
  /** Env the app reads, as the in-repo fixtures import it. */
  env: Record<string, string>
}

/** The React 18 hosts (react18.spec.ts). */
export const REACT18_HOSTS: Record<string, Host> = {
  'pages-next15-react18': {
    options: {
      template: join(fixtures, 'host-pages-next15-react18'),
      react: REACT18,
      packages: PACKAGES,
      work: 'pages-next15-react18',
      direct: ['core', 'next', 'react'],
      dependencies: { next: NEXT15 },
    },
    start: (app, port) => startNext(app, 15, port, []),
    env: {
      NF_COMPONENTS_REACT18_ORIGIN: react18Origin,
      NF_COMPONENTS_PUBLIC_KEY: JSON.stringify(COMPONENTS_PUBLIC_KEY),
    },
  },
  'spa-react18': {
    options: {
      template: join(fixtures, 'host-spa-react18'),
      react: REACT18,
      packages: ['sdk', 'protocol', 'core', 'react', 'router'],
      work: 'spa-react18',
      direct: ['core', 'react'],
      dependencies: { vite: '8.3.8', '@vitejs/plugin-react': '6.3.0' },
    },
    start: (app, port) => startVite(app, port),
    env: { VITE_NF_COMPONENTS_REACT18: react18Origin },
  },
}

const prod = process.env.NF_MODE === 'prod'

function serve(bin: string, args: string[], app: string): void {
  const child = spawn(bin, args, { cwd: app, stdio: 'inherit' })
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill(signal))
  }
  child.on('exit', (code) => process.exit(code ?? 1))
}

/** `next dev`, or `next build` + `next start`, honouring NF_BUNDLER. */
function startNext(
  app: string,
  major: number,
  port: string,
  devFlags: string[]
): void {
  const bundler =
    process.env.NF_BUNDLER === 'webpack'
      ? major >= 16
        ? ['--webpack']
        : []
      : major >= 16
        ? []
        : ['--turbopack']
  const next = join(app, 'node_modules', '.bin', 'next')
  if (prod) run(next, ['build', ...bundler], app)
  serve(
    next,
    prod ? ['start', '-p', port] : ['dev', '-p', port, ...bundler, ...devFlags],
    app
  )
}

/** `vite`, or `vite build` + `vite preview`. */
function startVite(app: string, port: string): void {
  const vite = join(app, 'node_modules', '.bin', 'vite')
  if (prod) run(vite, ['build', '--logLevel', 'warn'], app)
  serve(vite, [...(prod ? ['preview'] : []), '--port', port], app)
}

function main(): void {
  const [first, port, ...devFlags] = process.argv.slice(2)
  if (!first || !port) {
    throw new Error(
      `usage: installed-host.ts <next version | ${Object.keys(REACT18_HOSTS).join(' | ')}> <port> [next dev flag...]`
    )
  }
  const host = REACT18_HOSTS[first]
  if (host) {
    Object.assign(process.env, host.env)
    host.start(createInstalledHost(host.options), port)
    return
  }
  const major = Number.parseInt(first, 10)
  if (Number.isNaN(major)) throw new Error(`unknown host ${first}`)
  const app = createInstalledHost({
    template: join(here, 'installed-host'),
    react: REACT,
    packages: PACKAGES,
    work: [`next${major}`, ...devFlags.map((f) => f.replace(/^-+/, ''))].join(
      '-'
    ),
    direct: ['core', 'next', 'react'],
    dependencies: { next: first, 'server-only': '0.0.1' },
  })
  startNext(app, major, port, devFlags)
}

if (process.argv[1] && import.meta.filename === process.argv[1]) main()
