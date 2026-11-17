// B4: a verified build whose Module Federation manifest lists remotes of its
// own (or no remotes list) is never server-rendered. The descriptor fetch
// decides it, before any render: the descriptor comes back browser-only with
// NF-028, so the host neither defers a static page for it (NF-039) nor asks
// the server loader (and the MF runtime) to load it.
import { createHash } from 'node:crypto'
import { componentDescriptorDigest } from '@next-federation/protocol'
import type { ComponentBuildDescriptor } from '@next-federation/protocol'
import { fetchVerifiedComponentDescriptor } from '../src/components.ts'
import { defineFederation } from '../src/config.ts'

const ORIGIN = 'https://remote.example'
const BASE = `${ORIGIN}/b/c1/`
const sri = (text: string) =>
  `sha384-${createHash('sha384').update(text).digest('base64')}`

const manifestOf = (extra: Record<string, unknown>) =>
  JSON.stringify({
    id: 'components',
    name: 'components',
    metaData: { pluginVersion: '1.24.0' },
    shared: [],
    exposes: [],
    ...extra,
  })

async function setup(opts: {
  manifest: string
  /** What the remote serves at the manifest URL (default: `manifest`). */
  served?: string | number
  manifestPath?: string
  listed?: boolean
}) {
  const manifestPath = opts.manifestPath ?? 'mf-manifest.json'
  const payload: ComponentBuildDescriptor = {
    v: 1,
    name: 'components',
    buildId: 'c1',
    base: BASE,
    manifest: `${BASE}${manifestPath}`,
    ssr: {
      integrity: {
        ...(opts.listed === false
          ? {}
          : { [manifestPath]: sri(opts.manifest) }),
        'remoteEntry.ssr.js': sri('exports.x = 1'),
      },
    },
  }
  const digest = await componentDescriptorDigest(payload)
  const target = defineFederation({
    remotes: {
      components: {
        origin: ORIGIN,
        components: { ssr: { pinned: { c1: digest } } },
      } as never,
    },
  }).componentTarget('components')
  const requests: string[] = []
  const fetch = (async (url: string) => {
    requests.push(url)
    if (url === target.descriptorUrl) {
      return new Response(JSON.stringify({ ...payload, digest }), {
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url === payload.manifest) {
      const served = opts.served ?? opts.manifest
      return typeof served === 'number'
        ? new Response('down', { status: served })
        : new Response(served, {
            headers: { 'content-type': 'application/json' },
          })
    }
    return new Response('', { status: 404 })
  }) as typeof globalThis.fetch
  const result = await fetchVerifiedComponentDescriptor(target, { fetch })
  if (!result.ok) throw new Error(`descriptor fetch failed: ${result.detail}`)
  return { verified: result.verified, requests, payload }
}

test('nested remotes: browser-only with NF-028, decided from the verified manifest', async () => {
  const { verified, requests, payload } = await setup({
    manifest: manifestOf({ remotes: [{ federationContainerName: 'other' }] }),
  })
  expect(verified.trust).toBeNull()
  expect(verified.descriptor.ssr).toBeNull()
  expect(verified.descriptor).not.toHaveProperty('jws')
  expect(verified.code).toBe('NF-028')
  expect(verified.detail).toMatch(
    new RegExp(`The build at ${BASE} lists remotes of its own`)
  )
  // The descriptor and the manifest: no server code is fetched.
  expect(requests).toEqual([`${ORIGIN}/_nf/components.json`, payload.manifest])
})

test('no remotes list, or a manifest that is not JSON: browser-only with NF-028', async () => {
  const missing = await setup({ manifest: manifestOf({ remotes: undefined }) })
  expect(missing.verified.descriptor.ssr).toBeNull()
  expect(missing.verified.code).toBe('NF-028')
  expect(missing.verified.detail).toMatch(/has no remotes list/)
  const notJson = await setup({ manifest: 'not json' })
  expect(notJson.verified.descriptor.ssr).toBeNull()
  expect(notJson.verified.code).toBe('NF-028')
})

test('an empty remotes list keeps server rendering', async () => {
  const { verified, payload } = await setup({
    manifest: manifestOf({ remotes: [] }),
  })
  expect(verified.trust).toBe('pinned')
  expect(verified.descriptor.ssr).toEqual(payload.ssr)
  expect(verified.code).toBeUndefined()
})

test('an unverifiable manifest is left to the server loader (it refuses or fails itself)', async () => {
  const nested = manifestOf({ remotes: [{ name: 'other' }] })
  // Down, tampered with, or not in the integrity map: the descriptor keeps
  // its ssr; the server loader verifies every file again before any use.
  for (const opts of [
    { manifest: nested, served: 503 },
    { manifest: nested, served: manifestOf({ remotes: [{ name: 'x' }] }) },
    { manifest: nested, listed: false },
  ]) {
    const { verified } = await setup(opts)
    expect(verified.trust).toBe('pinned')
    expect(verified.descriptor.ssr).not.toBeNull()
  }
})

test('a browser-only build never fetches its manifest', async () => {
  const target = defineFederation({
    remotes: {
      components: { origin: ORIGIN, components: { ssr: false } } as never,
    },
  }).componentTarget('components')
  const payload: ComponentBuildDescriptor = {
    v: 1,
    name: 'components',
    buildId: 'c1',
    base: BASE,
    manifest: `${BASE}mf-manifest.json`,
    ssr: null,
  }
  const digest = await componentDescriptorDigest(payload)
  const requests: string[] = []
  const result = await fetchVerifiedComponentDescriptor(target, {
    fetch: (async (url: string) => {
      requests.push(url)
      return new Response(JSON.stringify({ ...payload, digest }))
    }) as typeof fetch,
  })
  expect(result.ok).toBe(true)
  expect(requests).toEqual([`${ORIGIN}/_nf/components.json`])
})
