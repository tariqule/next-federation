import type { GetServerSideProps } from 'next'
import { getComponentDescriptor } from '@next-federation/next/pages/server'
import type { RemoteComponentDescriptor } from '@next-federation/next/pages/server'
import { MODE_A_REMOTES, componentsFederation } from './components'
import { HostProviders } from './HostProviders'
import { ReactProbe } from './ReactProbe'
import { RemoteCounter } from './RemoteCounter'

export type ModeAProps = { descriptor: RemoteComponentDescriptor | null }

/** `?preload=1`: load the module before rendering (inline HTML on a cold cache). */
export const getModeAProps =
  (fixed?: string): GetServerSideProps<ModeAProps> =>
  async ({ params, query }) => {
    const remote = fixed ?? String(params?.remote ?? '')
    if (!MODE_A_REMOTES.includes(remote)) return { notFound: true }
    const descriptor = await getComponentDescriptor(
      componentsFederation,
      remote
    )
    if (query.preload === '1') await RemoteCounter.preload(descriptor)
    return { props: { descriptor } }
  }

export function ModeAPage({ descriptor }: ModeAProps) {
  return (
    <main>
      <h1>Mode A (Pages Router)</h1>
      <p data-testid="rendered-build">{descriptor?.buildId ?? 'none'}</p>
      <HostProviders value="from-pages-host">
        <RemoteCounter descriptor={descriptor} start={1} />
        <ReactProbe descriptor={descriptor} />
      </HostProviders>
    </main>
  )
}
