// Server-side only (getServerSideProps): the components remotes.
import { defineFederation } from '@next-federation/core'
import type { FederationEvent } from '@next-federation/core'
import {
  COMPONENTS_PORTS,
  COMPONENTS_PUBLIC_KEY,
} from '../../../e2e/fixtures/components-keys.ts'
import { lanePort } from '../../../e2e/lane.ts'

const at = (port: number) => `http://127.0.0.1:${lanePort(port)}`
const trusted = {
  ssr: { publicKeys: [{ ...COMPONENTS_PUBLIC_KEY }] },
  revalidate: 1,
}

/** Server events of componentsFederation, read by /api/nf-events (preload.spec.ts). */
export const recordedEvents = ((
  globalThis as { __nfRecordedEvents?: FederationEvent[] }
).__nfRecordedEvents ??= [])

export const componentsFederation = defineFederation({
  onEvent: (event) => {
    recordedEvents.push(event)
  },
  remotes: {
    components: { origin: at(COMPONENTS_PORTS.signed), components: trusted },
    tampered: { origin: at(COMPONENTS_PORTS.tampered), components: trusted },
    unsigned: { origin: at(COMPONENTS_PORTS.unsigned), components: trusted },
    redeploy: { origin: at(COMPONENTS_PORTS.redeploy), components: trusted },
    down: { origin: at(COMPONENTS_PORTS.down), components: trusted },
    // Holds server-side asset requests: preload always times out.
    slow: { origin: at(COMPONENTS_PORTS.slow), components: trusted },
    // Built with Rspack + @module-federation/enhanced, described by nf-describe.
    rspack: { origin: at(COMPONENTS_PORTS.rspack), components: trusted },
    'rspack-unsigned': {
      origin: at(COMPONENTS_PORTS.rspackUnsigned),
      components: trusted,
    },
    // The links build l1 (router.spec.ts): remote components written with
    // next/link, next/navigation and react-router, rewired by the build.
    links: { origin: at(COMPONENTS_PORTS.links), components: trusted },
    // Accepts @next-federation/router >=0.99.0 only (router.spec.ts).
    'rspack-router-miss': {
      origin: at(COMPONENTS_PORTS.rspackRouterMiss),
      components: trusted,
    },
  },
})

export const MODE_A_REMOTES: readonly string[] = [
  'components',
  'tampered',
  'unsigned',
  'redeploy',
  'down',
  'rspack',
  'rspack-unsigned',
]
