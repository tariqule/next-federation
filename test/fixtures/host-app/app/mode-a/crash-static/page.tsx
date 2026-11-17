import { Suspense } from 'react'
import { getComponentDescriptor } from '@next-federation/next/server'
import { componentsFederation } from '../../../lib/components'
import { HostProviders } from '../../../lib/HostProviders'
import { RemoteBoom } from '../../../lib/RemoteBoom'
import { RemoteCounter } from '../../../lib/RemoteCounter'

async function Section() {
  // Cached descriptor: this page is prerendered at build time.
  const descriptor = await getComponentDescriptor(
    componentsFederation,
    'cached'
  )
  return (
    <>
      <div data-testid="boom-server-slot">
        <RemoteBoom descriptor={descriptor} where="server" />
      </div>
      <div data-testid="boom-always-slot">
        <RemoteBoom descriptor={descriptor} where="always" />
      </div>
      <HostProviders value="from-app-host">
        <RemoteCounter descriptor={descriptor} start={1} />
      </HostProviders>
    </>
  )
}

// A static page whose remote component throws while the server renders it:
// `next build` must pass, with the fallback in the static HTML.
export default function Page() {
  return (
    <main>
      <h1>Mode A render errors</h1>
      <Suspense fallback={<span data-testid="shell-fallback">loading</span>}>
        <Section />
      </Suspense>
    </main>
  )
}
