import { Suspense } from 'react'
import { getComponentDescriptor } from '@next-federation/next/server'
import { componentsFederation } from '../../lib/components'
import {
  RemoteNavLink,
  RemotePagesNavLink,
  RemoteVersioned,
} from '../../lib/RemoteNav'

async function Section() {
  // Per request (cacheComponents: a PPR hole), as /mode-a: this remote's
  // descriptor revalidates every second, which a cached prerender would race.
  const descriptor = await getComponentDescriptor(
    componentsFederation,
    'components',
    { dynamic: true }
  )
  return (
    <>
      <p data-testid="rendered-build">{descriptor?.buildId ?? 'none'}</p>
      <RemoteNavLink descriptor={descriptor} href="/mode-a" label="to Mode A" />
      <RemotePagesNavLink
        descriptor={descriptor}
        href="/mode-a"
        label="pages link"
      />
      <RemoteVersioned descriptor={descriptor} />
    </>
  )
}

// Remote components using the host's next/link and next/navigation.
export default function Page() {
  return (
    <main>
      <h1>Mode A: Next modules</h1>
      <Suspense fallback={<span data-testid="shell-fallback">loading</span>}>
        <Section />
      </Suspense>
    </main>
  )
}
