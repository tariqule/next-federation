// Starts the installed-library host (installed-dev.spec.ts): next-federation
// as an app gets it from npm, under a real node_modules, not a workspace link.
//
//   node fixtures/installed-host.ts <next version> <port> [next dev flag...]
//
// Extra arguments go to `next dev` (e.g. `--disable-source-maps`) and give
// the host its own work folder.
// 1. `pnpm pack`s the built packages (run `pnpm build` first) into
//    <work>/tarballs, where <work> is test/e2e/.installed[-<lane>]/next<major>
//    plus the extra flags (git-ignored).
// 2. Copies fixtures/installed-host into <work>/app and writes its
//    package.json: the given next, React, and the tarballs (pnpm overrides
//    point the packages' own @next-federation/* dependencies at the tarballs).
// 3. `pnpm install --ignore-workspace` there, then `next dev` (dev) or
//    `next build` + `next start` (prod), honouring NF_BUNDLER.
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { laneName } from '../lane.ts'

const [version, port, ...devFlags] = process.argv.slice(2)
if (!version || !port) {
  throw new Error(
    'usage: installed-host.ts <next version> <port> [next dev flag...]'
  )
}
const major = Number.parseInt(version, 10)
const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..')
const lane = laneName()
const work = join(
  here,
  '..',
  lane ? `.installed-${lane}` : '.installed',
  [`next${major}`, ...devFlags.map((f) => f.replace(/^-+/, ''))].join('-')
)
const tarballs = join(work, 'tarballs')
const app = join(work, 'app')
const PACKAGES = ['sdk', 'protocol', 'core', 'react', 'next']
const REACT = '19.3.1'

const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] })

const started = Date.now()
rmSync(work, { recursive: true, force: true })
mkdirSync(tarballs, { recursive: true })
for (const name of PACKAGES) {
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
  PACKAGES.map((name) => [`@next-federation/${name}`, tarball(name)])
)

cpSync(join(here, 'installed-host'), app, { recursive: true })
writeFileSync(
  join(app, 'package.json'),
  JSON.stringify(
    {
      name: `installed-host-next${major}`,
      private: true,
      type: 'module',
      dependencies: {
        '@next-federation/core': local['@next-federation/core'],
        '@next-federation/next': local['@next-federation/next'],
        '@next-federation/react': local['@next-federation/react'],
        next: version,
        react: REACT,
        'react-dom': REACT,
        'server-only': '0.0.1',
      },
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
  `installed-host next@${version}: packed and installed in ${Math.round((Date.now() - started) / 1000)} s\n`
)

const bundler =
  process.env.NF_BUNDLER === 'webpack'
    ? major >= 16
      ? ['--webpack']
      : []
    : major >= 16
      ? []
      : ['--turbopack']
const next = join(app, 'node_modules', '.bin', 'next')
const prod = process.env.NF_MODE === 'prod'
if (prod) run(next, ['build', ...bundler], app)
const child = spawn(
  next,
  prod ? ['start', '-p', port] : ['dev', '-p', port, ...bundler, ...devFlags],
  { cwd: app, stdio: 'inherit' }
)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal))
}
child.on('exit', (code) => process.exit(code ?? 1))
