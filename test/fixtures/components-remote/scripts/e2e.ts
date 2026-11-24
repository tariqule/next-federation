// The components remotes of the e2e run (test/e2e/servers.ts starts this):
// builds five remotes (six with NF_SUITE=react18) one after the other
// (Module Federation's Vite plugin keeps generated files in node_modules, so
// builds of one folder must not run in parallel), then serves each with
// nf-serve, in this process.
//   signed      c1, signed with the test key           port 4110
//   tampered    t1, signed, then a server chunk edited  port 4111
//   unsigned    u1, no signature                        port 4112
//   routerMiss  rm1, the links build, signed, accepts the router >=9.0.0
//               only (no host has it: it uses its own copy)  port 4117
//   links       l1, the links build (NF_LINKS: next/link, next/navigation
//               and react-router rewired), signed       port 4121
//   react18     c18, the default exposes accepting React '^18.3.0 ||
//               ^19.0.0' (NF_REACT_RANGE), signed; NF_SUITE=react18 only
//               (the React 18 hosts)                     port 4116
// `node scripts/e2e.ts build <kind> <buildId>` only builds (mode-a.spec.ts
// uses it for the redeploy remote).
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serveBuilds } from '@next-federation/server/node'
import {
  COMPONENTS_PORTS,
  COMPONENTS_SIGNING_KEY,
} from '../../../e2e/fixtures/components-keys.ts'
import { laneName, lanePort } from '../../../e2e/lane.ts'

const here = join(import.meta.dirname, '..')
const lane = laneName()
type Kind =
  | 'signed'
  | 'tampered'
  | 'unsigned'
  | 'redeploy'
  | 'routerMiss'
  | 'links'
  | 'react18'

/** Output folder of one remote, relative to the fixture (lane-scoped). */
export const distOf = (kind: Kind): string =>
  lane ? `dist/${lane}/${kind}` : `dist/${kind}`

/** The React versions the react18 build accepts. */
export const REACT18_RANGE = '^18.3.0 || ^19.0.0'

/** The side effect a tampered chunk performs if a host ever evaluates it. */
export const TAMPER_MARKER = '__nfTamperedServerChunkRan'

export function build(kind: Kind, buildId: string): void {
  const port = lanePort(COMPONENTS_PORTS[kind])
  execFileSync('pnpm', ['exec', 'vite', 'build', '--logLevel', 'warn'], {
    cwd: here,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      PORT: String(port),
      NF_BUILD_ID: buildId,
      NF_OUT: distOf(kind),
      ...((kind === 'links' || kind === 'routerMiss') && { NF_LINKS: '1' }),
      ...(kind === 'routerMiss' && { NF_ROUTER_RANGE: '>=9.0.0' }),
      ...(kind === 'react18' && { NF_REACT_RANGE: REACT18_RANGE }),
      ...(kind === 'unsigned'
        ? { NF_COMPONENTS_SIGNING_KEY: '' }
        : {
            NF_COMPONENTS_SIGNING_KEY: JSON.stringify(COMPONENTS_SIGNING_KEY),
          }),
    },
  })
  if (kind === 'tampered') {
    // After signing: the descriptor still lists the original sha384.
    const assets = join(here, distOf(kind), buildId, 'client', 'assets')
    const chunk = readdirSync(assets).find((f) => /^Counter-.*\.cjs$/.test(f))
    if (!chunk) throw new Error(`no Counter server chunk in ${assets}`)
    const file = join(assets, chunk)
    writeFileSync(
      file,
      `globalThis.${TAMPER_MARKER} = true;\n${readFileSync(file, 'utf8')}`
    )
  }
}

async function main(): Promise<void> {
  const [command, kind, buildId] = process.argv.slice(2)
  if (command === 'build') {
    build(kind as Kind, buildId!)
    return
  }
  const remotes: Array<[Kind, string]> = [
    ['signed', 'c1'],
    ['tampered', 't1'],
    ['unsigned', 'u1'],
    ['routerMiss', 'rm1'],
    ['links', 'l1'],
  ]
  if (process.env.NF_SUITE === 'react18') remotes.push(['react18', 'c18'])
  for (const [k] of remotes)
    rmSync(join(here, distOf(k)), { recursive: true, force: true })
  for (const [k, id] of remotes) build(k, id)
  const served = await Promise.all(
    remotes.map(([k]) =>
      serveBuilds({
        dir: join(here, distOf(k)),
        port: lanePort(COMPONENTS_PORTS[k]),
      })
    )
  )
  const close = () => {
    void Promise.all(served.map((s) => s.close())).then(() => process.exit(0))
  }
  process.on('SIGTERM', close)
  process.on('SIGINT', close)
  console.log(`components remotes ready (pid ${process.pid})`)
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  await main()
}
