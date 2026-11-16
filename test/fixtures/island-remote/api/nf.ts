// The island handler as a Vercel Function (Node.js runtime, Web `fetch`
// export). vercel.json rewrites `/_nf/*` and `/b/<buildId>/_nf/*` here; the
// request URL keeps the path that was asked for. Static assets never reach
// it: Vercel serves `/b/<buildId>/assets/*` from the static output.
import handler, { buildId } from '../dist/vercel/entry.js'

const PINNED = /^\/b\/([^/]+)\//

/** Same answer as `nf-serve` for a build it does not serve. */
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
    const pinned = PINNED.exec(new URL(request.url).pathname)
    // A deployment holds one build. A path pinned to another build (an
    // earlier deployment's) is retired here: without Skew Protection, Vercel
    // routes it to this deployment, which cannot render that build.
    if (pinned && pinned[1] !== buildId) return retired()
    return handler(request)
  },
}
