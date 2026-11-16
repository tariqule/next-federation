// Server-side only (getServerSideProps): the Mode A remotes.
import { defineFederation } from '@next-federation/core'
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

export const componentsFederation = defineFederation({
  remotes: {
    components: { origin: at(COMPONENTS_PORTS.signed), components: trusted },
    tampered: { origin: at(COMPONENTS_PORTS.tampered), components: trusted },
    unsigned: { origin: at(COMPONENTS_PORTS.unsigned), components: trusted },
    redeploy: { origin: at(COMPONENTS_PORTS.redeploy), components: trusted },
    down: { origin: at(COMPONENTS_PORTS.down), components: trusted },
  },
})

export const MODE_A_REMOTES: readonly string[] = [
  'components',
  'tampered',
  'unsigned',
  'redeploy',
  'down',
]
