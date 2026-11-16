import { base64url } from 'jose'
import type { Federation } from '../config.ts'
import { signingKeys } from './keys.ts'

const secrets = new WeakMap<Federation, Promise<CryptoKey>>()

function hmacKey(federation: Federation, d: string): Promise<CryptoKey> {
  let key = secrets.get(federation)
  if (!key) {
    key = (async () => {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new Uint8Array(base64url.decode(d))
      )
      return crypto.subtle.importKey(
        'raw',
        digest,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
    })()
    secrets.set(federation, key)
  }
  return key
}

/** Opaque per-user marker, safe in HTML: reveals neither the sub nor the key. */
export async function identityKey(
  federation: Federation,
  sub: string
): Promise<string> {
  const [first] = await signingKeys(federation)
  const key = await hmacKey(federation, first!.d)
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(sub)
  )
  return base64url.encode(new Uint8Array(mac)).slice(0, 22)
}
