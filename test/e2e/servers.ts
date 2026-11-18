// The e2e harness: which servers a run starts, on which ports, with which env.
//
// Run modes (env read by this file):
//   NF_MODE     dev | prod (default dev). prod builds every app first.
//   NF_BUNDLER  turbopack | webpack (default turbopack); Next hosts only.
//               (Next 15 hosts: `--turbopack`, or their default webpack.)
//   NF_SUITE    default | skew | installed (default default). skew: remote `a`
//               serves two builds (v1 and v2) side by side; prod only. A second
//               `nf-serve` of the same builds on 4103 keeps one build
//               (`--max-builds 1 --min-age-hours 0`), so `v1` is retired there.
//               installed: the installed-library hosts (3106 on Next 15, 3107 on
//               Next 16, and 3108/3109 the same under `next dev
//               --disable-source-maps`; installed-dev.spec.ts), which install
//               the packed packages into a real node_modules first.
//   NF_APPS     optional comma list of app keys (see APPS below) to start a
//               subset, e.g. NF_APPS=issuer,remote-a,remote-b.
//   NF_SHARE    '0': remotes build with `share: false` (no React sharing).
//               Default: production remotes share React. Passed
//               through to the remotes.
//   NF_MEASURE  '1': remotes build without the fixture's React copy probe,
//               for the sharing measurements.
//   NF_LANE     a | b (default a): run a parallel lane. Every port below moves
//               by the lane's offset (b: +2000, see lane.ts) and the remote
//               build folders, the Next hosts' build folders (`nextDist`),
//               `.logs` and Playwright's output folder are lane-scoped. The
//               default lane is unchanged. Passed through to every app.
//
// Env the harness passes to the apps (fixtures read these; Tasks 22 and 23
// refer to this table):
//   PORT                  remotes: listen port; also baked into the remote's
//                         `base` at BUILD time, so prod builds get it too.
//   NF_REMOTE             remotes: remote name (`a`, `b`); build and serve.
//   NF_BUILD_ID           remotes, skew suite only: `v1`, then `v2`.
//   NF_PORT               hosts: own port; the host's identity issuer is
//                         `http://localhost:${NF_PORT}` (plus basePath).
//   NF_CC                 host-app on 3102: '1' turns on cacheComponents.
//   NF_BASE_PATH_FIXTURE  host-pages on 3103: '/base' (the Next basePath);
//                         its build folder is `.next-base`.
//   NF_SIGNING_KEY        hosts: the test-only private JWK from
//                         fixtures/test-signing-key.json.
//   NF_REMOTE_A_ORIGIN    host-app: remote `a`'s origin, set from
//                         NF_VERCEL_PROD_URL when that is set (vercel.spec.ts).
//   VITE_NF_ORIGIN_*      host-spa: remote origins (A, B, FAKE, C, RETIRED).
//   VITE_NF_COMPONENTS_*  host-spa: the components remote (ORIGIN), a down
//                         one (DOWN) and the Rspack-built one (RSPACK).
//                         Components remote ports: fixtures/components-keys.ts.
// Ports below are the lane's: BASE_PORTS plus lane.ts's offset.
//
// Origins: hosts are reached as `localhost`, remotes as `127.0.0.1`, so a
// host and a remote are different sites, as in production.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMPONENTS_PORTS } from './fixtures/components-keys.ts'
import { laneName, lanePort } from './lane.ts'

export type Mode = 'dev' | 'prod'
export type Suite = 'default' | 'skew' | 'installed'

export const MODE: Mode = process.env.NF_MODE === 'prod' ? 'prod' : 'dev'
export const BUNDLER: 'turbopack' | 'webpack' =
  process.env.NF_BUNDLER === 'webpack' ? 'webpack' : 'turbopack'
export const SUITE: Suite =
  process.env.NF_SUITE === 'skew' || process.env.NF_SUITE === 'installed'
    ? process.env.NF_SUITE
    : 'default'
/** How long Playwright waits for each app to answer (builds included). */
const WEB_SERVER_TIMEOUT_MS = 240_000

const BASE_PORTS = {
  issuer: 3999,
  remoteA: 4100,
  remoteB: 4101,
  fakeRemote: 4102,
  remoteARetired: 4103,
  remoteC: 4104,
  hostApp: 3100,
  hostPages: 3101,
  hostAppCc: 3102,
  hostPagesBase: 3103,
  hostAppNext15: 3104,
  hostPagesNext15: 3105,
  hostInstalled15: 3106,
  hostInstalled16: 3107,
  hostInstalled15NoSourceMaps: 3108,
  hostInstalled16NoSourceMaps: 3109,
  hostSpa: 4200,
} as const

/** The lane this run uses ('' for the default lane). */
export const LANE = laneName()
export const PORTS = Object.fromEntries(
  Object.entries(BASE_PORTS).map(([key, base]) => [key, lanePort(base)])
) as { [K in keyof typeof BASE_PORTS]: number }

export const ISSUER = `http://localhost:${PORTS.issuer}`
export const REMOTE_A = `http://127.0.0.1:${PORTS.remoteA}`
export const REMOTE_B = `http://127.0.0.1:${PORTS.remoteB}`
export const FAKE_REMOTE = `http://127.0.0.1:${PORTS.fakeRemote}`
export const REMOTE_A_RETIRED = `http://127.0.0.1:${PORTS.remoteARetired}`
export const REMOTE_C = `http://127.0.0.1:${PORTS.remoteC}`
export const HOST_APP = `http://localhost:${PORTS.hostApp}`
export const HOST_APP_CC = `http://localhost:${PORTS.hostAppCc}`
export const HOST_PAGES = `http://localhost:${PORTS.hostPages}`
export const HOST_PAGES_BASE = `http://localhost:${PORTS.hostPagesBase}`
export const HOST_SPA = `http://localhost:${PORTS.hostSpa}`
/** The Next 15 hosts (next15.spec.ts): host-app-next15, host-pages-next15. */
export const HOST_APP_NEXT15 = `http://localhost:${PORTS.hostAppNext15}`
export const HOST_PAGES_NEXT15 = `http://localhost:${PORTS.hostPagesNext15}`
/**
 * The installed-library hosts (NF_SUITE=installed, installed-dev.spec.ts):
 * each Next major, with Next's default dev source maps and with
 * `next dev --disable-source-maps`.
 */
export const INSTALLED_HOSTS = [
  {
    key: 'host-installed-15',
    major: 15,
    port: PORTS.hostInstalled15,
    flags: '',
  },
  {
    key: 'host-installed-16',
    major: 16,
    port: PORTS.hostInstalled16,
    flags: '',
  },
  {
    key: 'host-installed-15-no-source-maps',
    major: 15,
    port: PORTS.hostInstalled15NoSourceMaps,
    flags: '--disable-source-maps',
  },
  {
    key: 'host-installed-16-no-source-maps',
    major: 16,
    port: PORTS.hostInstalled16NoSourceMaps,
    flags: '--disable-source-maps',
  },
] as const
export const INSTALLED_NEXT = { 15: '15.5.28', 16: '16.4.6' } as const
/**
 * Remote `c` (an older React, 19.2.9, for the sharing e2e) runs in prod
 * only: dev remotes never share React. It lives outside the pnpm workspace
 * (`pnpm install --ignore-workspace` in its folder).
 */
const WITH_REMOTE_C = MODE === 'prod'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, '..', 'fixtures')
// `nf-serve` is run from the workspace's built server package, not through a
// bin link: pnpm links the bin only if `dist` existed at install time, which a
// fresh clone (CI: install, then build) does not satisfy.
const NF_SERVE = join(
  here,
  '..',
  '..',
  'packages',
  'server',
  'dist',
  'node',
  'cli.js'
)
const nfServe = (dir: string, port: number, extra = ''): string => {
  if (!existsSync(NF_SERVE)) {
    throw new Error(`${NF_SERVE} is missing: run \`pnpm build\` first.`)
  }
  return `node ${JSON.stringify(NF_SERVE)} --dir ${dir} --port ${port}${extra}`
}
/** Lane-scoped: `.logs` (default lane), `.logs-b`, ... */
export const LOGS_DIR = join(here, LANE ? `.logs-${LANE}` : '.logs')
/** Playwright's output folder, which it empties at the start of a run. */
export const OUTPUT_DIR = join(
  here,
  LANE ? `test-results-${LANE}` : 'test-results'
)
/** Remote build output, relative to the remote fixture: `dist/<name>` or `dist/<lane>/<name>`. */
export const remoteDist = (name: string): string =>
  LANE ? `dist/${LANE}/${name}` : `dist/${name}`
const logs = LOGS_DIR

// One line, as a host reads it from the environment.
const SIGNING_KEY = JSON.stringify(
  JSON.parse(
    readFileSync(join(here, 'fixtures', 'test-signing-key.json'), 'utf8')
  )
)

type App = {
  key: string
  /** Folder under test/fixtures, or null for a file in test/e2e. */
  dir: string | null
  url: string
  command: string
  env?: Record<string, string>
  /** Started only when NF_SUITE=skew. */
  skewOnly?: boolean
  /** Started only in prod (remote `c`, React sharing). */
  shareOnly?: boolean
  /** Started only when NF_SUITE=installed. */
  installedOnly?: boolean
}

/**
 * A Next host's build folder: `.next`, `.next-cc` or `.next-base`, plus
 * `-<lane>` outside the default lane. The fixtures' next.config computes the
 * same name from NF_LANE.
 */
const nextDist = (base: string): string => (LANE ? `${base}-${LANE}` : base)

/**
 * `next build` output goes to test/e2e/.logs/<app>-<port>.build.log.
 * Every run first removes the host's own fetch cache, where public island
 * envelopes live: prod builds remove `<distDir>/cache` (envelopes cached by an
 * earlier run point at remote builds this run has deleted), `next dev` its
 * `<distDir>/dev/cache/fetch-cache` (a dev remote keeps one buildId, so a
 * cached envelope's HTML may predate the remote's current source and fail
 * hydration).
 */
function nextCommand(app: string, port: number, distDir: string): string {
  const flag = BUNDLER === 'webpack' ? ' --webpack' : ''
  if (MODE === 'dev') {
    return `rm -rf ${distDir}/dev/cache/fetch-cache && pnpm exec next dev -p ${port}${flag}`
  }
  return nextProd(app, port, distDir, flag)
}

/**
 * The cacheComponents host's server output (dev or `next start`) also goes
 * to test/e2e/.logs/<app>-<port>.server.log, for checks on what the server
 * logged (still shown on stderr).
 */
export const serverLog = (app: string, port: number): string =>
  join(logs, `${app}-${port}.server.log`)
function withServerLog(command: string, app: string, port: number): string {
  const log = JSON.stringify(serverLog(app, port))
  return `mkdir -p ${JSON.stringify(logs)} && rm -f ${log} && { ${command}; } 2>&1 | tee ${log} >&2`
}

/**
 * Next 15 hosts: webpack is the default there and `--turbopack` opts in;
 * `next dev` keeps its fetch cache in `<distDir>/cache/fetch-cache`.
 */
function next15Command(app: string, port: number, distDir: string): string {
  const flag = BUNDLER === 'turbopack' ? ' --turbopack' : ''
  if (MODE === 'dev') {
    return `rm -rf ${distDir}/cache/fetch-cache && pnpm exec next dev -p ${port}${flag}`
  }
  return nextProd(app, port, distDir, flag)
}

function nextProd(
  app: string,
  port: number,
  distDir: string,
  flag: string
): string {
  const log = join(logs, `${app}-${port}.build.log`)
  return [
    `mkdir -p ${JSON.stringify(logs)}`,
    `rm -rf ${distDir}/cache`,
    `{ pnpm exec next build${flag} > ${JSON.stringify(log)} 2>&1 || { cat ${JSON.stringify(log)} >&2; exit 1; }; }`,
    `pnpm exec next start -p ${port}`,
  ].join(' && ')
}

/**
 * Remote commands. Each remote builds into its own `remoteDist(name)` folder, which
 * is removed first, so `nf-serve` sees only this run's builds.
 */
function remoteCommand(
  name: string,
  port: number,
  vite = 'pnpm exec vite'
): string {
  if (MODE === 'dev') return `${vite} --port ${port}`
  const dir = remoteDist(name)
  if (SUITE === 'skew' && name === 'a') {
    return [
      `rm -rf ${dir}`,
      'NF_BUILD_ID=v1 pnpm exec vite build',
      'NF_BUILD_ID=v2 pnpm exec vite build',
      nfServe(dir, port),
    ].join(' && ')
  }
  return [`rm -rf ${dir}`, `${vite} build`, nfServe(dir, port)].join(' && ')
}

// Remote `c` lives outside the pnpm workspace (its own React install), so it
// runs the island-remote fixture's Vite.
const FIXTURE_VITE = `node ${JSON.stringify(join(fixtures, 'island-remote', 'node_modules', 'vite', 'bin', 'vite.js'))}`

/**
 * Skew suite: a second `nf-serve` of remote `a`'s builds that keeps only the
 * newest (v2). It reads the folder remote-a builds into, so it waits until
 * remote-a answers its health check (builds done) before starting. The wait
 * is bounded by the webServer timeout, so it never outlives the run.
 */
function retiredCommand(): string {
  const health = `${REMOTE_A}/_nf/health`
  const tries = WEB_SERVER_TIMEOUT_MS / 1000
  return [
    `n=0; until curl -sf ${health} > /dev/null; do n=$((n+1)); if [ $n -ge ${tries} ]; then echo "${health} did not answer in ${tries} s" >&2; exit 1; fi; sleep 1; done`,
    nfServe(
      remoteDist('a'),
      PORTS.remoteARetired,
      ' --max-builds 1 --min-age-hours 0'
    ),
  ].join(' && ')
}

const spaEnv: Record<string, string> = {
  VITE_NF_ORIGIN_A: REMOTE_A,
  VITE_NF_ORIGIN_B: REMOTE_B,
  VITE_NF_ORIGIN_FAKE: FAKE_REMOTE,
  VITE_NF_ORIGIN_C: REMOTE_C,
  VITE_NF_ORIGIN_RETIRED: REMOTE_A_RETIRED,
  VITE_NF_ISSUER: ISSUER,
  VITE_NF_COMPONENTS_ORIGIN: `http://127.0.0.1:${lanePort(COMPONENTS_PORTS.signed)}`,
  VITE_NF_COMPONENTS_DOWN: `http://127.0.0.1:${lanePort(COMPONENTS_PORTS.down)}`,
  VITE_NF_COMPONENTS_RSPACK: `http://127.0.0.1:${lanePort(COMPONENTS_PORTS.rspack)}`,
}

const hostEnv = (port: number): Record<string, string> => ({
  NF_PORT: String(port),
  NF_SIGNING_KEY: SIGNING_KEY,
  ...(process.env.NF_VERCEL_PROD_URL
    ? { NF_REMOTE_A_ORIGIN: process.env.NF_VERCEL_PROD_URL.replace(/\/+$/, '') }
    : {}),
})

export const APPS: App[] = [
  {
    key: 'issuer',
    dir: null,
    url: `${ISSUER}/jwks`,
    command: 'node fixtures/jwks-server.ts',
    env: { PORT: String(PORTS.issuer) },
  },
  {
    key: 'fake-remote',
    dir: null,
    url: `${FAKE_REMOTE}/_nf/health`,
    command: 'node fixtures/fake-remote.ts',
    env: { PORT: String(PORTS.fakeRemote) },
  },
  {
    key: 'remote-a',
    dir: 'island-remote',
    url: `${REMOTE_A}/_nf/health`,
    command: remoteCommand('a', PORTS.remoteA),
    env: { NF_REMOTE: 'a', PORT: String(PORTS.remoteA) },
  },
  {
    key: 'remote-b',
    dir: 'island-remote',
    url: `${REMOTE_B}/_nf/health`,
    command: remoteCommand('b', PORTS.remoteB),
    env: { NF_REMOTE: 'b', PORT: String(PORTS.remoteB) },
  },
  {
    key: 'remote-c',
    dir: 'island-remote-old-react',
    url: `${REMOTE_C}/_nf/health`,
    command: remoteCommand('c', PORTS.remoteC, FIXTURE_VITE),
    env: { NF_REMOTE: 'c', PORT: String(PORTS.remoteC) },
    shareOnly: true,
  },
  {
    key: 'remote-a-retired',
    dir: 'island-remote',
    url: `${REMOTE_A_RETIRED}/_nf/health`,
    command: retiredCommand(),
    skewOnly: true,
  },
  {
    // Components remotes (signed, tampered, unsigned), built one after the
    // other then served by nf-serve, in dev and prod (hosts server-render
    // them only from a build). Listed before the hosts: Playwright starts
    // web servers in order, so cacheComponents prerenders can reach it.
    key: 'components-remote',
    dir: 'components-remote',
    url: `http://127.0.0.1:${lanePort(COMPONENTS_PORTS.signed)}/_nf/components.json`,
    command: 'node scripts/e2e.ts',
  },
  {
    // Components remotes built with Rspack + @module-federation/enhanced (not
    // Vite) and described by nf-describe: signed rs1, unsigned ru1.
    key: 'components-remote-rspack',
    dir: 'components-remote-rspack',
    url: `http://127.0.0.1:${lanePort(COMPONENTS_PORTS.rspack)}/_nf/components.json`,
    command: 'node scripts/e2e.ts',
  },
  {
    key: 'host-app',
    dir: 'host-app',
    url: `http://localhost:${PORTS.hostApp}`,
    command: nextCommand('host-app', PORTS.hostApp, nextDist('.next')),
    env: hostEnv(PORTS.hostApp),
  },
  {
    key: 'host-app-cc',
    dir: 'host-app',
    url: `http://localhost:${PORTS.hostAppCc}`,
    command: withServerLog(
      nextCommand('host-app', PORTS.hostAppCc, nextDist('.next-cc')),
      'host-app',
      PORTS.hostAppCc
    ),
    env: { ...hostEnv(PORTS.hostAppCc), NF_CC: '1' },
  },
  {
    key: 'host-pages',
    dir: 'host-pages',
    url: `http://localhost:${PORTS.hostPages}`,
    command: nextCommand('host-pages', PORTS.hostPages, nextDist('.next')),
    env: hostEnv(PORTS.hostPages),
  },
  {
    key: 'host-pages-base',
    dir: 'host-pages',
    url: `http://localhost:${PORTS.hostPagesBase}/base`,
    command: nextCommand(
      'host-pages',
      PORTS.hostPagesBase,
      nextDist('.next-base')
    ),
    env: { ...hostEnv(PORTS.hostPagesBase), NF_BASE_PATH_FIXTURE: '/base' },
  },
  {
    key: 'host-app-next15',
    dir: 'host-app-next15',
    url: `http://localhost:${PORTS.hostAppNext15}`,
    command: next15Command(
      'host-app-next15',
      PORTS.hostAppNext15,
      nextDist('.next')
    ),
    env: hostEnv(PORTS.hostAppNext15),
  },
  {
    key: 'host-pages-next15',
    dir: 'host-pages-next15',
    url: `http://localhost:${PORTS.hostPagesNext15}`,
    command: next15Command(
      'host-pages-next15',
      PORTS.hostPagesNext15,
      nextDist('.next')
    ),
    env: hostEnv(PORTS.hostPagesNext15),
  },
  ...INSTALLED_HOSTS.map(
    (host): App => ({
      key: host.key,
      dir: null,
      url: `http://localhost:${host.port}`,
      command: `node fixtures/installed-host.ts ${INSTALLED_NEXT[host.major]} ${host.port}${host.flags ? ` ${host.flags}` : ''}`,
      env: { ...hostEnv(host.port), NF_REMOTE_A_ORIGIN: REMOTE_A },
      installedOnly: true,
    })
  ),
  {
    key: 'host-spa',
    dir: 'host-spa',
    url: `http://localhost:${PORTS.hostSpa}`,
    command:
      MODE === 'dev'
        ? `pnpm exec vite --port ${PORTS.hostSpa}`
        : `pnpm exec vite build && pnpm exec vite preview --port ${PORTS.hostSpa}`,
    env: spaEnv,
  },
]

const only = process.env.NF_APPS?.split(',').map((s) => s.trim())

/** Playwright `webServer` entries for this run. Apps whose folder does not exist yet are skipped. */
export function webServers() {
  return APPS.filter((app) => !app.skewOnly || SUITE === 'skew')
    .filter((app) => !app.shareOnly || WITH_REMOTE_C)
    .filter((app) => !app.installedOnly || SUITE === 'installed')
    .filter((app) => !only || only.includes(app.key))
    .filter(
      (app) =>
        app.dir === null || existsSync(join(fixtures, app.dir, 'package.json'))
    )
    .map((app) => ({
      name: app.key,
      command: app.command,
      cwd: app.dir === null ? here : join(fixtures, app.dir),
      url: app.url,
      env: { ...process.env, ...app.env } as Record<string, string>,
      // Never silently test someone else's server on a busy port.
      reuseExistingServer: false,
      timeout: WEB_SERVER_TIMEOUT_MS,
      stdout: 'ignore' as const,
      stderr: 'pipe' as const,
    }))
}
