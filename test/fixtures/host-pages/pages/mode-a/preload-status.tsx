import type { GetServerSideProps } from 'next'
import { getComponentDescriptor } from '@next-federation/next/pages/server'
import type { RemoteComponentDescriptor } from '@next-federation/next/pages/server'
import { componentsFederation } from '../../lib/components'
import { HostProviders } from '../../lib/HostProviders'
import { RemoteCounter } from '../../lib/RemoteCounter'

// The documented getServerSideProps pattern: preload with a timeout, mark a
// degraded response uncacheable, and render the component only when ready
// (or browser-only on a timeout, with ?browserOnly=1).
// /mode-a/preload-status?remote=components|tampered|slow
const REMOTES = ['components', 'tampered', 'slow']

type Props = {
  descriptor: RemoteComponentDescriptor | null
  status: string
  browserOnly: boolean
}

export const getServerSideProps: GetServerSideProps<Props> = async ({
  query,
  res,
}) => {
  const remote = String(query.remote ?? '')
  if (!REMOTES.includes(remote)) return { notFound: true }
  const descriptor = await getComponentDescriptor(componentsFederation, remote)
  const status = await RemoteCounter.preload(descriptor, { timeoutMs: 200 })
  if (status.state !== 'ready') res.setHeader('Cache-Control', 'no-store')
  // Next sends no-store for getServerSideProps by default: a page that wants
  // a ready response cached says so.
  else res.setHeader('Cache-Control', 'public, s-maxage=10')
  return {
    props: {
      descriptor,
      status: status.state,
      browserOnly: query.browserOnly === '1',
    },
  }
}

export default function PreloadStatus({
  descriptor,
  status,
  browserOnly,
}: Props) {
  return (
    <main>
      <h1>Preload status</h1>
      <p data-testid="preload-state">{status}</p>
      <HostProviders value="from-pages-host">
        {status === 'ready' ? (
          <RemoteCounter descriptor={descriptor} start={1} />
        ) : status === 'timeout' && browserOnly ? (
          <RemoteCounter descriptor={descriptor} start={1} browserOnly />
        ) : null}
      </HostProviders>
    </main>
  )
}
