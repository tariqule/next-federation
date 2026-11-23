import { RouterPage } from '../../../lib/RouterPage'

// The Rspack build that accepts @next-federation/router >=0.99.0 only: it
// loads its bundled copy. Later builds still get this host's router. The
// host link goes to the normal Rspack page in the same document.
export default function Page() {
  return (
    <RouterPage
      title="router rspack miss"
      remote="rspack-router-miss"
      dynamic
      hostLink="/router/rspack"
    />
  )
}
