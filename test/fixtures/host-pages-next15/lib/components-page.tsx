import type { RemoteComponentDescriptor } from '@next-federation/next/pages/server'
import { RemotePagesNavLink } from './RemoteNav'

export type ComponentsProps = { descriptor: RemoteComponentDescriptor | null }

export function ComponentsPage({ descriptor }: ComponentsProps) {
  return (
    <main>
      <h1>Remote components (Next 15, Pages Router)</h1>
      <p data-testid="rendered-build">{descriptor?.buildId ?? 'none'}</p>
      <RemotePagesNavLink
        descriptor={descriptor}
        href="/nav/one"
        label="to nav"
      />
    </main>
  )
}
