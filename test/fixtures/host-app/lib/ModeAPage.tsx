import { Suspense } from 'react'
import { getComponentDescriptor } from '@next-federation/next/server'
import { componentsFederation } from './components'
import { HostProviders } from './HostProviders'
import { ReactProbe } from './ReactProbe'
import { RemoteCounter } from './RemoteCounter'

async function Section({
  remote,
  dynamic,
}: {
  remote: Promise<string> | string
  dynamic: boolean
}) {
  const name = await remote
  const descriptor = await getComponentDescriptor(componentsFederation, name, {
    dynamic,
  })
  return (
    <>
      <p data-testid="rendered-build">{descriptor?.buildId ?? 'none'}</p>
      <HostProviders value="from-app-host">
        <RemoteCounter descriptor={descriptor} start={1} />
        <ReactProbe descriptor={descriptor} />
      </HostProviders>
    </>
  )
}

/**
 * Valid in both caching models: the descriptor is read inside <Suspense>.
 * `dynamic`: fetched per request (cacheComponents: a PPR hole); otherwise
 * cached (cacheComponents: prerendered static).
 */
export function ModeAPage({
  remote,
  dynamic,
}: {
  remote: Promise<string> | string
  dynamic: boolean
}) {
  return (
    <main>
      <h1>Mode A</h1>
      <Suspense fallback={<span data-testid="shell-fallback">loading</span>}>
        <Section remote={remote} dynamic={dynamic} />
      </Suspense>
    </main>
  )
}
