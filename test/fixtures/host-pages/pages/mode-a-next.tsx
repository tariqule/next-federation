import type { GetServerSideProps } from 'next'
import { getComponentDescriptor } from '@next-federation/next/pages/server'
import type { RemoteComponentDescriptor } from '@next-federation/next/pages/server'
import { componentsFederation } from '../lib/components'
import {
  RemoteNavLink,
  RemotePagesNavLink,
  RemoteVersioned,
} from '../lib/RemoteNav'

type Props = { descriptor: RemoteComponentDescriptor | null }

export const getServerSideProps: GetServerSideProps<Props> = async () => ({
  props: {
    descriptor: await getComponentDescriptor(
      componentsFederation,
      'components'
    ),
  },
})

// Remote components using the host's next/link and next/router: on the
// basePath host, /base/fr/mode-a-next links to /base/fr/mode-a.
export default function ModeANext({ descriptor }: Props) {
  return (
    <main>
      <h1>Mode A: Next modules (Pages Router)</h1>
      <p data-testid="rendered-build">{descriptor?.buildId ?? 'none'}</p>
      <RemotePagesNavLink
        descriptor={descriptor}
        href="/mode-a"
        label="to Mode A"
      />
      <RemoteNavLink descriptor={descriptor} href="/mode-a" label="app link" />
      <RemoteVersioned descriptor={descriptor} />
    </main>
  )
}
