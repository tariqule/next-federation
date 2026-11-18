/** Options for {@link warmUp}. */
export type WarmUpOptions = {
  /** Request headers (e.g. the cookie that signs a user in). */
  headers?: Record<string, string>
  /** The body of a warm response matches this (e.g. the island's content). */
  ready: RegExp
  /** Give up after this long (default 60 s). */
  deadlineMs?: number
  /** Pause between attempts (default 1 s). */
  intervalMs?: number
}

/**
 * Requests `url` until a response is 2xx and its body matches `ready`, or
 * the deadline passes. Returns whether it got there; callers ignore the
 * result, as the test's own assertions decide.
 *
 * Under `next dev` the first request to a page compiles the page, and the
 * remote's dev server compiles the island it serves, while the host's island
 * fetch timeout (3 s) is running: a freshly started host can render the
 * island's fallback (NF-008) once. A warm-up request absorbs that cold start.
 * It runs outside the browser, so the test still inspects every request it
 * makes itself.
 */
export async function warmUp(
  url: string,
  {
    headers = {},
    ready,
    deadlineMs = 60_000,
    intervalMs = 1_000,
  }: WarmUpOptions
): Promise<boolean> {
  const deadline = Date.now() + deadlineMs
  for (;;) {
    const left = deadline - Date.now()
    if (left <= 0) return false
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(left),
      })
      const body = await res.text()
      if (res.ok && ready.test(body)) return true
    } catch {
      // Not answering yet, or the attempt timed out: try again.
    }
    if (deadline - Date.now() <= intervalMs) return false
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/** One page for {@link warmUpWithin}. */
export type WarmUpStep = Omit<WarmUpOptions, 'deadlineMs'> & { url: string }

/**
 * Warms the pages in order within one budget: each step gets what the
 * earlier ones left, so the whole warm-up ends within `budgetMs` (plus one
 * request's tail) and fits the hook's timeout. Returns the URLs that never
 * got ready, for a clear message instead of a hook timeout.
 */
export async function warmUpWithin(
  steps: WarmUpStep[],
  budgetMs: number
): Promise<string[]> {
  const deadline = Date.now() + budgetMs
  const cold: string[] = []
  for (const { url, ...options } of steps) {
    const left = deadline - Date.now()
    const ready =
      left > 0 && (await warmUp(url, { ...options, deadlineMs: left }))
    if (!ready) cold.push(url)
  }
  return cold
}
