import { withNextFederation } from '@next-federation/next/config'

// A Pages Router host on Next 15 and React 18 (react18.spec.ts): a copy of
// this folder with React 18.3.1 and the packed next-federation tarballs in a
// real node_modules (test/e2e/fixtures/installed-host.ts). Plain JavaScript,
// so it needs no TypeScript.
const root = import.meta.dirname

export default withNextFederation({
  reactStrictMode: true,
  // `next build` would find the repo's ESLint config above this copy.
  eslint: { ignoreDuringBuilds: true },
  outputFileTracingRoot: root,
  turbopack: { root },
})
