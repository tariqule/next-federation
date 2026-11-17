/**
 * Browser token client for island Server Actions and refetches.
 *
 * Tokens are bound to the user's session on the host: they live in module
 * memory only (never in storage, cookies, logs, errors or events), are dropped
 * on a 401, on an identity change, on `clearIslandTokens()` and at their TTL,
 * and are requested from the host's own endpoint with same-origin credentials.
 * The cache is keyed by endpoint, which carries the remote (`aud`), and each
 * entry records the identity it was issued for.
 */

export type TokenClient = {
  getToken(): Promise<string | null>
  /**
   * Drops this endpoint's token. With `rejected`, only when the cached token is
   * that one (a remote answered 401 NF-014 for it).
   */
  invalidate(rejected?: string): void
}

type Entry = { token: string; expiresAt: number; identityKey: string }
type Inflight = {
  identityKey: string | null
  promise: Promise<string | null>
}

/** Seconds before expiry at which a cached token is no longer reused. */
const SKEW_SECONDS = 30

const cache = new Map<string, Entry>()
const inflight = new Map<string, Inflight>()
/**
 * Bumped when an endpoint is dropped (per endpoint) or everything is cleared
 * (global), so a response that lands afterwards is discarded without touching
 * other endpoints' in-flight requests.
 */
const generations = new Map<string, number>()
let clearedAll = 0

const generationOf = (endpoint: string): string =>
  `${clearedAll}:${generations.get(endpoint) ?? 0}`

function drop(endpoint: string): void {
  cache.delete(endpoint)
  inflight.delete(endpoint)
  generations.set(endpoint, (generations.get(endpoint) ?? 0) + 1)
}

/** Hosts call this on sign-out: forgets every cached token. */
export function clearIslandTokens(): void {
  cache.clear()
  inflight.clear()
  generations.clear()
  clearedAll++
}

const nowSeconds = (): number => Date.now() / 1000

function parse(body: unknown): Entry | null {
  if (typeof body !== 'object' || body === null) return null
  const { token, expiresAt, identityKey } = body as Record<string, unknown>
  if (
    typeof token !== 'string' ||
    token === '' ||
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt) ||
    typeof identityKey !== 'string'
  )
    return null
  return { token, expiresAt, identityKey }
}

export function createTokenClient(opts: {
  endpoint: string
  identityKey: string | null
  fetch?: typeof fetch
  /** Current time in epoch seconds (the unit of `expiresAt`). */
  now?: () => number
}): TokenClient {
  const { endpoint, identityKey } = opts
  const now = opts.now ?? nowSeconds

  async function request(): Promise<string | null> {
    const started = generationOf(endpoint)
    let entry: Entry | null = null
    try {
      const doFetch = opts.fetch ?? globalThis.fetch
      const response = await doFetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
      })
      if (response.ok) entry = parse(await response.json())
    } catch {
      entry = null
    }
    // Dropped (sign-out, invalidate) while the request was in flight.
    if (started !== generationOf(endpoint)) return null
    // getToken() removed any stale entry before requesting, so a failure needs
    // no further cache write. A token for someone else than the identity this
    // mount renders for is refused.
    if (!entry || (identityKey !== null && entry.identityKey !== identityKey))
      return null
    // A null identity is never reused, so there is nothing to cache for it.
    if (identityKey !== null) cache.set(endpoint, entry)
    return entry.token
  }

  return {
    getToken() {
      const cached = cache.get(endpoint)
      if (cached) {
        if (
          identityKey !== null &&
          cached.identityKey === identityKey &&
          cached.expiresAt - SKEW_SECONDS > now()
        )
          return Promise.resolve(cached.token)
        // A null-key client (public island) never reuses a token, and leaves
        // the entry of the identity a private island renders for alone.
        if (identityKey !== null) cache.delete(endpoint)
      }
      const pending = inflight.get(endpoint)
      if (pending && pending.identityKey === identityKey) return pending.promise
      const promise = request().finally(() => {
        if (inflight.get(endpoint)?.promise === promise)
          inflight.delete(endpoint)
      })
      inflight.set(endpoint, { identityKey, promise })
      return promise
    },
    invalidate(rejected) {
      if (rejected === undefined) return drop(endpoint)
      // A rejected token only drops the cache entry that still holds it: a newer
      // token or a refresh already in flight (another action's 401) is kept, so
      // concurrent 401s share one refetch.
      if (cache.get(endpoint)?.token === rejected) drop(endpoint)
    },
  }
}
