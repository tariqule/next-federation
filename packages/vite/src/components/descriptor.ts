import { readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import {
  COMPONENTS_JWS_TYPE,
  componentDescriptorBytes,
  componentDescriptorDigest,
  sha384Integrity,
} from '@next-federation/protocol'
import type {
  ComponentBuildDescriptor,
  ComponentDescriptorFile,
} from '@next-federation/protocol'
import { NFError } from '@next-federation/sdk'
import { CompactSign, importJWK } from 'jose'
import type { JWK } from 'jose'

/** `require("./x")` / `require("../x")` in the CommonJS server build. */
const RELATIVE_REQUIRE = /require\(["'](\.\.?\/[^"']+)["']\)/g

type Manifest = {
  metaData?: { ssrRemoteEntry?: { name?: unknown; path?: unknown } }
}

/**
 * The integrity map of a build's server code: the sha384 of `mf-manifest.json`
 * and of every file reachable from the SSR entry through relative
 * `require()`s, keyed by path relative to the build folder (= its base URL).
 * NF-002 when the manifest names no SSR entry or the graph leaves the folder.
 */
export async function collectServerIntegrity(
  dir: string
): Promise<Record<string, string>> {
  const root = resolve(dir)
  const manifestBytes = await readFile(join(root, 'mf-manifest.json'))
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as Manifest
  const entry = manifest.metaData?.ssrRemoteEntry
  if (typeof entry?.name !== 'string' || entry.name === '') {
    throw new NFError(
      'NF-002',
      'mf-manifest.json names no ssrRemoteEntry: the server build did not run.'
    )
  }
  const integrity: Record<string, string> = {
    'mf-manifest.json': await sha384Integrity(manifestBytes),
  }
  const pending = [
    resolve(root, typeof entry.path === 'string' ? entry.path : '', entry.name),
  ]
  while (pending.length > 0) {
    const file = pending.pop()!
    const rel = relative(root, file).split(sep).join('/')
    if (rel === '' || rel.startsWith('..') || resolve(root, rel) !== file) {
      throw new NFError(
        'NF-002',
        `The server build requires ${JSON.stringify(rel)}, outside the build folder.`
      )
    }
    if (rel in integrity) continue
    const bytes = await readFile(file)
    integrity[rel] = await sha384Integrity(bytes)
    for (const match of bytes.toString('utf8').matchAll(RELATIVE_REQUIRE)) {
      pending.push(resolve(file, '..', match[1]!))
    }
  }
  return integrity
}

async function signingKey(raw: string) {
  let jwk: JWK
  try {
    jwk = JSON.parse(raw) as JWK
  } catch {
    throw new NFError(
      'NF-002',
      'NF_COMPONENTS_SIGNING_KEY must be a private EC P-256 JWK (JSON).'
    )
  }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.d !== 'string') {
    throw new NFError(
      'NF-002',
      'NF_COMPONENTS_SIGNING_KEY must be a private EC P-256 JWK (kty "EC", crv "P-256", with "d").'
    )
  }
  return { key: await importJWK(jwk, 'ES256'), kid: jwk.kid }
}

/**
 * The descriptor file for a build: the payload, its digest and, when
 * `NF_COMPONENTS_SIGNING_KEY` holds a private JWK, a compact ES256 JWS of the
 * canonical payload (the key never leaves the build machine).
 */
export async function createDescriptorFile(
  payload: ComponentBuildDescriptor,
  env: Record<string, string | undefined>
): Promise<ComponentDescriptorFile> {
  const digest = await componentDescriptorDigest(payload)
  const raw = env.NF_COMPONENTS_SIGNING_KEY
  if (!raw) return { ...payload, digest }
  const { key, kid } = await signingKey(raw)
  const jws = await new CompactSign(componentDescriptorBytes(payload))
    .setProtectedHeader({
      alg: 'ES256',
      typ: COMPONENTS_JWS_TYPE,
      ...(kid ? { kid } : {}),
    })
    .sign(key)
  return { ...payload, digest, jws }
}
