import type { MetadataRoute } from 'next'
import { source } from '@/lib/source'
import { SITE_URL } from '@/lib/seo'

// No lastModified: pages are synced from docs/ at build time, so file times
// would all be the build time and tell crawlers nothing.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, priority: 1 },
    ...source
      .getPages()
      .filter((p) => p.url !== '/docs') // /docs redirects to the first guide
      .map((p) => ({ url: `${SITE_URL}${p.url}`, priority: 0.7 })),
  ]
}
