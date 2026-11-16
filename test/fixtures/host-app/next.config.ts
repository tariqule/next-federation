import path from 'node:path'
import { withNextFederation } from '@next-federation/next/config'
import { laneName } from '../../e2e/lane.ts'

const CC = process.env.NF_CC === '1'
const root = path.join(import.meta.dirname, '../../..')
// NF_LANE (test/e2e/lane.ts): each e2e lane builds into its own folders.
const lane = laneName()

export default withNextFederation({
  cacheComponents: CC,
  // Both hosts (3100, 3102) run from this folder at the same time.
  distDir: `${CC ? '.next-cc' : '.next'}${lane ? `-${lane}` : ''}`,
  // `page.cc.tsx` routes use 'use cache', which compiles only with
  // cacheComponents: they exist on the cacheComponents host only.
  pageExtensions: CC ? ['cc.tsx', 'tsx', 'ts'] : ['tsx', 'ts'],
  outputFileTracingRoot: root,
  turbopack: { root },
})
