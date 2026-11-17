import { Suspense } from 'react'
import { getComponentDescriptor } from '@next-federation/next/server'
import { componentsFederation } from './components'
import { RemoteNavLink } from './RemoteNav'

async function Section({ remote }: { remote: string }) {
  const descriptor = await getComponentDescriptor(
    componentsFederation,
    remote,
    {
      dynamic: true,
    }
  )
  return (
    <>
      <p data-testid="rendered-build">{descriptor?.buildId ?? 'none'}</p>
      <RemoteNavLink descriptor={descriptor} href="/nav/one" label="to nav" />
    </>
  )
}

/** A remote component from `remote`'s signed descriptor, read per request. */
export function ComponentsPage({ remote }: { remote: string }) {
  return (
    <main>
      <h1>Remote components (Next 15)</h1>
      <Suspense fallback={<span data-testid="shell-fallback">loading</span>}>
        <Section remote={remote} />
      </Suspense>
    </main>
  )
}
