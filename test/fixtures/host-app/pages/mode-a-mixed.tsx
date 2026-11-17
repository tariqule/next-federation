import type { GetServerSideProps } from 'next'
import { getComponentDescriptor } from '@next-federation/next/pages/server'
import type { RemoteComponentDescriptor } from '@next-federation/next/pages/server'
import { componentsFederation } from '../lib/components'
import { HostProviders } from '../lib/HostProviders'
import { ReactProbe } from '../lib/ReactProbe'
import { RemoteCounter } from '../lib/RemoteCounter'

// Mixed-router host: a Pages Router route in the App Router host. Its server
// React (node_modules) differs from the App Router's (Next's vendored copy)
// in one process; each layer has its own remote component runtime, so the
// remote server-renders here too, on this layer's React (the probe).
type Props = { descriptor: RemoteComponentDescriptor | null }

export const getServerSideProps: GetServerSideProps<Props> = async ({
  query,
}) => {
  // ?remote=rspack: the Rspack-built remote (its own MF runtime).
  const descriptor = await getComponentDescriptor(
    componentsFederation,
    query.remote === 'rspack' ? 'rspack' : 'components'
  )
  if (query.preload === '1') await RemoteCounter.preload(descriptor)
  return { props: { descriptor } }
}

export default function Page({ descriptor }: Props) {
  return (
    <main>
      <h1>Remote components (mixed router)</h1>
      <HostProviders value="from-mixed-host">
        <RemoteCounter descriptor={descriptor} start={1} />
        <ReactProbe descriptor={descriptor} />
      </HostProviders>
    </main>
  )
}
