import path from 'node:path'
import { withNextFederation } from '@next-federation/next/config'
import { laneName } from '../../e2e/lane.ts'

// The e2e harness sets these (test/e2e/servers.ts): the basePath host (3103)
// gets NF_BASE_PATH_FIXTURE='/base'; NF_LANE picks the lane.
const base = process.env.NF_BASE_PATH_FIXTURE ?? ''
const lane = laneName()
const root = path.join(import.meta.dirname, '../../..')

export default withNextFederation({
  reactStrictMode: true,
  basePath: base,
  // Both hosts (3101, 3103) run from this folder at the same time, in either
  // lane: one build folder each.
  distDir: `${base ? '.next-base' : '.next'}${lane ? `-${lane}` : ''}`,
  i18n: { locales: ['en', 'fr'], defaultLocale: 'en' },
  outputFileTracingRoot: root,
  turbopack: { root },
})
