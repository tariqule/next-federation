import { withNextFederation } from '@next-federation/next/config'

// The installed-library host (installed-dev.spec.ts): a copy of this folder
// with the packed next-federation tarballs in a real node_modules
// (fixtures/installed-host.ts). Plain JavaScript, so it needs no TypeScript.
const root = import.meta.dirname

export default withNextFederation({
  outputFileTracingRoot: root,
  turbopack: { root },
})
