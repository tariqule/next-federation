import { withNextFederation } from '@next-federation/next/config'

// One Next.js app with both routers: the storefront in app/ (with
// cacheComponents: static shells, streamed and blocking private islands) and
// the admin in pages/ (getServerSideProps). basePath applies to both.
// Required: adapter entry points fail with NF-017 without the wrapper.
export default withNextFederation({
  basePath: '/store',
  cacheComponents: true,
  // Next 16's default next to cacheComponents (create-next-app turns on both).
  partialPrefetching: true,
  // The demo labels (examples/advanced/inspect) ship as TypeScript source.
  transpilePackages: ['example-inspect'],
  // The App Router routes are per locale: /store/en, /store/fr.
  async redirects() {
    return [{ source: '/', destination: '/en', permanent: false }]
  },
})
