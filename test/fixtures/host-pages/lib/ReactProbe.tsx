'use client'
import * as React from 'react'
import { Component, Suspense, use, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { loadRemoteModule } from '@next-federation/react/components'
import type { RemoteComponentDescriptor } from '@next-federation/react/components'

// One-React probe: the React the remote module received is this
// environment's React. The text is rendered on the server (SSR value) and
// must hydrate unchanged; `data-client` is the browser's own answer.
function Probe({ descriptor }: { descriptor: RemoteComponentDescriptor }) {
  const mod = use(
    loadRemoteModule(descriptor, './Counter') as Promise<{
      remoteReact?: { useState?: unknown }
    }>
  )
  const same = mod.remoteReact?.useState === React.useState
  const [client, setClient] = useState('pending')
  useEffect(() => setClient(String(same)), [same])
  return (
    <output data-testid="react-probe" data-client={client}>
      {String(same)}
    </output>
  )
}

// A failed load (remote down) shows no probe; it must not break the page.
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    return this.state.failed ? null : this.props.children
  }
}

export function ReactProbe({
  descriptor,
}: {
  descriptor: RemoteComponentDescriptor | null
}) {
  // The signed remote only: on the tampered page its own load would fail.
  if (!descriptor?.ssr || descriptor.remote !== 'components') return null
  return (
    <Quiet>
      <Suspense fallback={null}>
        <Probe descriptor={descriptor} />
      </Suspense>
    </Quiet>
  )
}
