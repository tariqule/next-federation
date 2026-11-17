import { defineFederation } from '@next-federation/core'
import {
  COMPONENTS_PORTS,
  COMPONENTS_PUBLIC_KEY,
} from '../../../e2e/fixtures/components-keys.ts'
import { lanePort } from '../../../e2e/lane.ts'

// Remote components (test/fixtures/components-remote): the signed build and
// a remote nothing listens on.
const at = (port: number) => `http://127.0.0.1:${lanePort(port)}`
const trusted = { ssr: { publicKeys: [{ ...COMPONENTS_PUBLIC_KEY }] } }

export const componentsFederation = defineFederation({
  remotes: {
    components: { origin: at(COMPONENTS_PORTS.signed), components: trusted },
    down: { origin: at(COMPONENTS_PORTS.down), components: trusted },
  },
})
