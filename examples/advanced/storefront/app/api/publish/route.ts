import { cookies } from 'next/headers'
import { revalidateIsland } from '../../../lib/federation'
import { sessionFrom } from '../../../lib/session'

// "Publish": expires the cached CDP and PDP islands at once, so every page
// that shows them is regenerated with fresh envelopes on its next request.
// The admin page posts here. In production, the remotes' deploy pipeline
// would call a route like this (as a webhook with its own secret) after a
// deploy or a catalog change.
export async function POST(request: Request) {
  // Refuse cross-site form posts: only this storefront may post.
  const origin = request.headers.get('origin')
  if (origin !== null && origin !== new URL(request.url).origin) {
    return new Response('Forbidden', { status: 403 })
  }
  const store = await cookies()
  const session = sessionFrom((name) => store.get(name)?.value)
  if (session?.role !== 'admin') {
    return new Response('Admins only (demo session)', { status: 403 })
  }
  // Tags: nf:cdp and nf:pdp (every island of each remote). One island only:
  // revalidateIsland('cdp', 'ProductGrid') expires nf:cdp:ProductGrid.
  revalidateIsland('cdp')
  revalidateIsland('pdp')
  return new Response(null, {
    status: 303,
    headers: { Location: `/store/admin?published=${Date.now()}` },
  })
}
