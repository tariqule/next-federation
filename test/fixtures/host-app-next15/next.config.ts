import path from 'node:path'
import { withNextFederation } from '@next-federation/next/config'
import { laneName } from '../../e2e/lane.ts'

// An App Router host on Next 15 (test/e2e/next15.spec.ts): the legacy caching
// model only (cacheComponents is Next 16).
const root = path.join(import.meta.dirname, '../../..')
// NF_LANE (test/e2e/lane.ts): each e2e lane builds into its own folder.
const lane = laneName()

export default withNextFederation({
  distDir: `.next${lane ? `-${lane}` : ''}`,
  outputFileTracingRoot: root,
  turbopack: { root },
})
