import { source } from '@/lib/source'
import { renderOg } from '@/lib/og'

// Per-page Open Graph image. A route handler, because the opengraph-image
// file convention cannot live under an optional catch-all segment.
export const dynamic = 'force-static'

export function generateStaticParams() {
  return source.generateParams()
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug?: string[] }> }
) {
  const { slug } = await ctx.params
  const page = source.getPage(slug)
  if (!page) return new Response('Not found', { status: 404 })
  const d = page.data.description ?? ''
  return renderOg(
    page.data.title,
    d.length > 110 ? d.slice(0, d.lastIndexOf(' ', 107)) + '...' : d
  )
}
