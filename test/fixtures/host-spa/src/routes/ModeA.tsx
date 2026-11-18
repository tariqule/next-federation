import * as HostContextModule from 'components-context'
import { HostContext } from 'components-context'
import {
  createRemoteComponent,
  fetchDescriptorInBrowser,
} from '@next-federation/react/components'
import { Suspense, use } from 'react'

// Remote components in a client-only host: the descriptor is fetched in the
// browser and the component renders in the browser only. The harness sets
// VITE_NF_COMPONENTS_ORIGIN (per lane, see test/e2e/servers.ts).
const origin =
  import.meta.env.VITE_NF_COMPONENTS_ORIGIN ?? 'http://127.0.0.1:4110'
const down = import.meta.env.VITE_NF_COMPONENTS_DOWN ?? 'http://127.0.0.1:4119'
// `?rspack=1`: the remote built with Rspack (components-remote-rspack).
const rspack =
  import.meta.env.VITE_NF_COMPONENTS_RSPACK ?? 'http://127.0.0.1:4114'

const RemoteCounter = createRemoteComponent<{ start?: number }>({
  expose: './Counter',
  shared: {
    'components-context': { version: '1.0.0', module: HostContextModule },
  },
  fallback: <span data-testid="fallback">counter unavailable</span>,
})

const descriptors = new Map<
  string,
  ReturnType<typeof fetchDescriptorInBrowser>
>()
function descriptorOf(url: string) {
  let p = descriptors.get(url)
  if (!p) {
    p = fetchDescriptorInBrowser(`${url}/_nf/components.json`, {
      remote: url === rspack ? 'rspack' : 'components',
    })
    descriptors.set(url, p)
  }
  return p
}

function Section({ url }: { url: string }) {
  const descriptor = use(descriptorOf(url))
  return (
    <>
      <p data-testid="rendered-build">{descriptor?.buildId ?? 'none'}</p>
      <HostContext.Provider value="from-spa-host">
        <RemoteCounter descriptor={descriptor} start={1} />
      </HostContext.Provider>
    </>
  )
}

export function ModeA() {
  const query = new URLSearchParams(location.search)
  const url = query.get('down') ? down : query.get('rspack') ? rspack : origin
  return (
    <main>
      <h1>Mode A (SPA)</h1>
      <Suspense fallback={<span data-testid="shell-fallback">loading</span>}>
        <Section url={url} />
      </Suspense>
    </main>
  )
}
