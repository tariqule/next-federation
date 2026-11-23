// The Rspack components remotes of the e2e run (test/e2e/servers.ts starts
// this): builds three remotes one after the other, then serves each with
// nf-serve, in this process.
//   signed    rs1, signed with the test key   port 4114
//   unsigned  ru1, no signature              port 4115
//   routerMiss rsm1, signed, accepts @next-federation/router >=0.99.0 only
//             (no host has it: it loads its bundled 0.99.0)  port 4120
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { serveBuilds } from '@next-federation/server/node'
import {
  COMPONENTS_PORTS,
  COMPONENTS_SIGNING_KEY,
} from '../../../e2e/fixtures/components-keys.ts'
import { laneName, lanePort } from '../../../e2e/lane.ts'

const here = join(import.meta.dirname, '..')
const lane = laneName()
type Kind = 'signed' | 'unsigned' | 'routerMiss'
const PORTS: Record<Kind, number> = {
  signed: COMPONENTS_PORTS.rspack,
  unsigned: COMPONENTS_PORTS.rspackUnsigned,
  routerMiss: COMPONENTS_PORTS.rspackRouterMiss,
}

/** Output folder of one remote, relative to the fixture (lane-scoped). */
const distOf = (kind: Kind): string =>
  lane ? `dist/${lane}/${kind}` : `dist/${kind}`

function build(kind: Kind, buildId: string): void {
  execFileSync(process.execPath, ['scripts/build.ts'], {
    cwd: here,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      PORT: String(lanePort(PORTS[kind])),
      NF_BUILD_ID: buildId,
      NF_OUT: distOf(kind),
      NF_COMPONENTS_SIGNING_KEY:
        kind === 'unsigned' ? '' : JSON.stringify(COMPONENTS_SIGNING_KEY),
      ...(kind === 'routerMiss' && { NF_ROUTER_RANGE: '>=0.99.0' }),
    },
  })
}

const remotes: Array<[Kind, string]> = [
  ['signed', 'rs1'],
  ['unsigned', 'ru1'],
  ['routerMiss', 'rsm1'],
]
for (const [kind] of remotes) {
  rmSync(join(here, distOf(kind)), { recursive: true, force: true })
}
for (const [kind, id] of remotes) build(kind, id)
const served = await Promise.all(
  remotes.map(([kind]) =>
    serveBuilds({ dir: join(here, distOf(kind)), port: lanePort(PORTS[kind]) })
  )
)
const close = () => {
  void Promise.all(served.map((s) => s.close())).then(() => process.exit(0))
}
process.on('SIGTERM', close)
process.on('SIGINT', close)
console.log(`rspack components remotes ready (pid ${process.pid})`)
