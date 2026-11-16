import {
  ISLAND_SHARE_NAMESPACE,
  islandShareScope,
} from '@next-federation/protocol'
import React from 'react'
import ReactDOM from 'react-dom'
import ReactDOMClient from 'react-dom/client'
import JsxRuntime from 'react/jsx-runtime'

type Share = { __SHARE__?: Record<string, unknown> }
const g = globalThis as { __FEDERATION__?: Share }
const savedEnv = process.env.NODE_ENV

beforeEach(() => {
  delete g.__FEDERATION__
  rstest.resetModules()
})

afterEach(() => {
  process.env.NODE_ENV = savedEnv
  rstest.doUnmock('react')
})

const load = async () =>
  (await import('../src/provide-host-react.ts')) as typeof import('../src/provide-host-react.ts')

test('a canary React version returns false and registers nothing', async () => {
  process.env.NODE_ENV = 'production'
  rstest.doMock('react', () => {
    const canary = { ...React, version: '19.3.0-canary-df6aa4ec-20261112' }
    return { ...canary, default: canary }
  })
  const { provideHostReact, isHostReactProvided } = await load()
  expect(provideHostReact()).toBe(false)
  expect(g.__FEDERATION__).toBeUndefined()
  expect(isHostReactProvided()).toBe(false)
})

test('development mode returns false', async () => {
  process.env.NODE_ENV = 'development'
  const { provideHostReact } = await load()
  expect(provideHostReact()).toBe(false)
  expect(g.__FEDERATION__).toBeUndefined()
})

test('stable production React registers four entries under nf-islands', async () => {
  process.env.NODE_ENV = 'production'
  const { provideHostReact, isHostReactProvided } = await load()
  expect(provideHostReact()).toBe(true)
  expect(isHostReactProvided()).toBe(true)
  expect(Object.keys(g.__FEDERATION__!.__SHARE__!)).toEqual([
    ISLAND_SHARE_NAMESPACE,
  ])
  const scope = islandShareScope()
  expect(Object.keys(scope).sort()).toEqual([
    'react',
    'react-dom',
    'react-dom/client',
    'react/jsx-runtime',
  ])
  const libs: Record<string, unknown> = {
    react: React,
    'react-dom': ReactDOM,
    'react-dom/client': ReactDOMClient,
    'react/jsx-runtime': JsxRuntime,
  }
  for (const [name, lib] of Object.entries(libs)) {
    const entry = scope[name]![React.version]!
    expect(entry).toMatchObject({
      version: React.version,
      from: 'host',
      loaded: true,
    })
    // The host's own module objects, ready to use with no load.
    expect(entry.lib!()).toBe(lib)
    await expect(entry.get().then((f) => f())).resolves.toBe(lib)
  }
})

test('calling it again is harmless; after a remote provided that version it registers nothing', async () => {
  process.env.NODE_ENV = 'production'
  const { provideHostReact } = await load()
  expect(provideHostReact()).toBe(true)
  const first = islandShareScope().react![React.version]
  expect(provideHostReact()).toBe(true)
  expect(islandShareScope().react![React.version]).toBe(first)

  // Too late: a remote already provides this version. The host's react-dom
  // next to the remote's react would pair two Reacts, so nothing changes.
  delete g.__FEDERATION__
  const remoteEntry = { version: React.version, from: 'https://r.test/' }
  islandShareScope().react = { [React.version]: remoteEntry as never }
  expect(provideHostReact()).toBe(false)
  const scope = islandShareScope()
  expect(scope.react![React.version]).toBe(remoteEntry)
  expect(scope['react-dom']).toBeUndefined()
})
