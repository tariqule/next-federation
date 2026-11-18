// The island handler as a Vercel Function (Node.js runtime, Web `fetch`
// export). vercel.json rewrites `/_nf/*` and `/b/<buildId>/_nf/*` here.
// Static assets never reach it: Vercel serves `/b/<buildId>/assets/*` from
// the static output.
import handler, { buildId } from '../dist/vercel/entry.js'

const PINNED = /^\/b\/([^/]+)\//

/** What `nf-serve` answers for a build it no longer serves. */
const retired = (): Response =>
  new Response(JSON.stringify({ error: 'NF-023' }), {
    status: 410,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  })

export default {
  fetch(request: Request): Promise<Response> | Response {
    // A deployment holds one build. Without Skew Protection, Vercel sends a
    // path pinned to an earlier build here too, and this build cannot
    // render it: answer as a retired build.
    const pinned = PINNED.exec(new URL(request.url).pathname)
    if (pinned && pinned[1] !== buildId) return retired()
    return handler(request)
  },
}
