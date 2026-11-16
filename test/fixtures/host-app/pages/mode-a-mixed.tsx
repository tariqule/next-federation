import type { GetServerSideProps } from 'next'
import { getComponentDescriptor } from '@next-federation/next/pages/server'
import type { RemoteComponentDescriptor } from '@next-federation/next/pages/server'
import { componentsFederation } from '../lib/components'
import { HostProviders } from '../lib/HostProviders'
import { RemoteCounter } from '../lib/RemoteCounter'

// Mixed-router host (officially post-v1): a Pages Router route in the App
// Router host. Its server React (node_modules) differs from the App Router's
// (Next's vendored copy) in one process; Mode A must not crash here.
type Props = { descriptor: RemoteComponentDescriptor | null }

export const getServerSideProps: GetServerSideProps<Props> = async () => ({
  props: {
    descriptor: await getComponentDescriptor(
      componentsFederation,
      'components'
    ),
  },
})

export default function Page({ descriptor }: Props) {
  return (
    <main>
      <h1>Mode A (mixed router)</h1>
      <HostProviders value="from-mixed-host">
        <RemoteCounter descriptor={descriptor} start={1} />
      </HostProviders>
    </main>
  )
}
