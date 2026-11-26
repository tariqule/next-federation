// Fakes shared by the remote component render specs (React 19 in the `dom`
// project, React 18 in `dom-react18`): one component, settled thenables, a
// descriptor and a runtime that never loads anything.
import { useState } from 'react'
import type {
  ComponentRefusalCode,
  RemoteComponentDescriptor,
} from '@next-federation/protocol'
import type { BindingsRuntime } from '../../src/components/render.tsx'
import type { RemoteModule, Thenable } from '../../src/components/runtime.ts'

export function Counter({ start = 0 }: { start?: number }) {
  const [n] = useState(start)
  return <span data-testid="counter">count {n}</span>
}
export const mod: RemoteModule = { default: Counter }

export const fulfilled = <T,>(value: T): Thenable<T> =>
  Object.assign(Promise.resolve(value), {
    status: 'fulfilled' as const,
    value,
  })

export const descriptor = (ssr: boolean): RemoteComponentDescriptor => ({
  remote: 'components',
  name: 'components',
  buildId: 'c1',
  base: 'http://127.0.0.1:4110/b/c1/',
  manifest: 'http://127.0.0.1:4110/b/c1/mf-manifest.json',
  ssr: ssr ? { integrity: { 'mf-manifest.json': 'sha384-AAAA' } } : null,
  maxBuilds: 5,
})

export function fakeRuntime(server: RemoteModule | null): BindingsRuntime {
  const refused = new Map<string, ComponentRefusalCode>()
  return {
    refuse: ({ base }, code) => void refused.set(base, code),
    refusedBuild: (d) => d.refused?.code ?? refused.get(d.base),
    load: () => fulfilled(mod),
    serverLoad: () => fulfilled(server),
    serverBlock: () => null,
    serverOutcome: () => undefined,
    registerShared: () => {},
  }
}
