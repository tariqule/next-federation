// Mode A render paths, server HTML then hydration (happy-dom): a server
// render, a boundary the server left to the browser (the mark), and an
// unverified build (BrowserOnly). None may produce a recoverable error.
import { act, useState } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import type { RemoteComponentDescriptor } from '@next-federation/protocol'
import { BROWSER_ONLY_ATTR, createBindings } from '../src/components/render.tsx'
import type { BindingsRuntime } from '../src/components/render.tsx'
import type { RemoteModule, Thenable } from '../src/components/runtime.ts'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function Counter({ start = 0 }: { start?: number }) {
  const [n] = useState(start)
  return <span data-testid="counter">count {n}</span>
}
const mod: RemoteModule = { default: Counter }

const fulfilled = <T,>(value: T): Thenable<T> =>
  Object.assign(Promise.resolve(value), {
    status: 'fulfilled' as const,
    value,
  })

const descriptor = (ssr: boolean): RemoteComponentDescriptor => ({
  remote: 'components',
  name: 'components',
  buildId: 'c1',
  base: 'http://127.0.0.1:4110/b/c1/',
  manifest: 'http://127.0.0.1:4110/b/c1/mf-manifest.json',
  ssr: ssr ? { integrity: { 'mf-manifest.json': 'sha384-AAAA' } } : null,
  maxBuilds: 5,
})

function fakeRuntime(server: RemoteModule | null): BindingsRuntime {
  return {
    load: () => fulfilled(mod),
    serverLoad: () => fulfilled(server),
    serverBlock: () => null,
    registerShared: () => {},
  }
}

async function serverThenHydrate(
  serverModule: RemoteModule | null,
  ssr: boolean
) {
  const server = createBindings({
    runtime: fakeRuntime(serverModule),
    isServer: true,
  }).createRemoteComponent<{ start?: number }>({
    expose: './Counter',
    fallback: <i data-testid="fallback">unavailable</i>,
  })
  const client = createBindings({
    runtime: fakeRuntime(null),
    isServer: false,
  }).createRemoteComponent<{ start?: number }>({
    expose: './Counter',
    fallback: <i data-testid="fallback">unavailable</i>,
  })
  const d = descriptor(ssr)
  const Page = ({ C }: { C: typeof server }) => (
    <main>
      <C descriptor={d} start={2} />
    </main>
  )
  const raw = renderToString(<Page C={server} />)
  const html = raw.replaceAll('<!-- -->', '')
  const container = document.createElement('div')
  container.innerHTML = raw
  document.body.appendChild(container)
  const recoverable: unknown[] = []
  const caught: unknown[] = []
  await act(async () => {
    hydrateRoot(container, <Page C={client} />, {
      onRecoverableError: (e) => recoverable.push(e),
      onCaughtError: (e) => caught.push(e),
    })
  })
  await act(async () => {})
  const text = container.textContent
  container.remove()
  return { html, text, recoverable, caught }
}

test('server rendered: the server HTML has the component and hydrates as is', async () => {
  const r = await serverThenHydrate(mod, true)
  expect(r.html).toContain('count 2')
  expect(r.html).not.toContain(BROWSER_ONLY_ATTR)
  expect(r.text).toBe('count 2')
  expect(r.recoverable).toEqual([])
  expect(r.caught).toEqual([])
})

test('left to the browser by the server: mark + fallback, then the component, no recoverable error', async () => {
  const r = await serverThenHydrate(null, true)
  expect(r.html).toContain(`<template ${BROWSER_ONLY_ATTR}=`)
  expect(r.html).toContain('unavailable')
  expect(r.html).not.toContain('count')
  expect(r.text).toBe('count 2')
  expect(r.recoverable).toEqual([])
  expect(r.caught).toEqual([])
})

test('unverified build (ssr: null): fallback on the server, the component after hydration', async () => {
  const r = await serverThenHydrate(mod, false)
  expect(r.html).toContain('unavailable')
  expect(r.html).not.toContain('count')
  expect(r.text).toBe('count 2')
  expect(r.recoverable).toEqual([])
  expect(r.caught).toEqual([])
})
