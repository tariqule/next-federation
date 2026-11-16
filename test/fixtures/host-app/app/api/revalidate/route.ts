import { revalidateIsland } from '../../../lib/federation'

// Test hook, as a remote-deploy webhook would call it: expires the island
// cache of `?remote=` (default `a`).
export async function POST(request: Request) {
  const remote = new URL(request.url).searchParams.get('remote') ?? 'a'
  revalidateIsland(remote)
  return Response.json({ revalidated: remote })
}
