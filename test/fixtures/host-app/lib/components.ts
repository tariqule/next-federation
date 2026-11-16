// Public data only (URLs, public keys): imported by App Router pages and by
// the mixed-router Pages route (pages/mode-a-mixed.tsx).
import { defineFederation } from '@next-federation/core'
import {
  COMPONENTS_PORTS,
  COMPONENTS_PUBLIC_KEY,
} from '../../../e2e/fixtures/components-keys.ts'
import { lanePort } from '../../../e2e/lane.ts'

// Mode A remotes (test/fixtures/components-remote, ports in components-keys.ts).
const at = (port: number) => `http://127.0.0.1:${lanePort(port)}`
// Trust the test key; re-read descriptors every second (redeploy checks).
const trusted = {
  ssr: { publicKeys: [{ ...COMPONENTS_PUBLIC_KEY }] },
  revalidate: 1,
}

export const componentsFederation = defineFederation({
  remotes: {
    components: { origin: at(COMPONENTS_PORTS.signed), components: trusted },
    // The same remote with the default 60 s descriptor cache: a cacheLife
    // that short-lived (1 s) would make the cached page dynamic.
    cached: {
      origin: at(COMPONENTS_PORTS.signed),
      components: { ssr: trusted.ssr },
    },
    tampered: { origin: at(COMPONENTS_PORTS.tampered), components: trusted },
    unsigned: { origin: at(COMPONENTS_PORTS.unsigned), components: trusted },
    redeploy: { origin: at(COMPONENTS_PORTS.redeploy), components: trusted },
    down: { origin: at(COMPONENTS_PORTS.down), components: trusted },
  },
})

export const MODE_A_REMOTES = [
  'components',
  'tampered',
  'unsigned',
  'redeploy',
  'down',
] as const
