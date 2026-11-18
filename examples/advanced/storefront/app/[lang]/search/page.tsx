import { Suspense } from 'react'
import { Embedded } from 'example-inspect'
import { PagePanel } from 'example-inspect/client'
import { RemoteIsland } from '../../../lib/federation'
import { GUIDES, SOURCE } from '../../../lib/guides'

const TRAIL = ['Storefront', 'App Router page /[lang]/search']

// The query is per request, so the results render inside <Suspense> (a
// dynamic hole in the static shell). The island's envelope is still cached,
// one entry per query: the props are part of the cache key.
async function Results({
  lang,
  searchParams,
}: {
  lang: string
  searchParams: Promise<{ q?: string | string[] }>
}) {
  const { q } = await searchParams
  const query = (Array.isArray(q) ? q[0] : q)?.slice(0, 64) ?? ''
  return (
    <RemoteIsland
      remote="serp"
      island="SearchResults"
      props={{ q: query, locale: lang }}
      locale={lang}
      fallback={<p>searching…</p>}
      errorFallback={<p>Search is unavailable right now.</p>}
    />
  )
}

// SERP (search results page).
export default async function Search({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>
  searchParams: Promise<{ q?: string | string[] }>
}) {
  const { lang } = await params
  return (
    <main>
      <PagePanel
        mode="partial"
        router="App Router"
        why="The page shell is static; the results depend on ?q= and stream in per request (each query's envelope is cached)."
        file={`${SOURCE}/app/[lang]/search/page.tsx`}
        guide={GUIDES.caching}
      />
      <h1>{lang === 'fr' ? 'Recherche' : 'Search'}</h1>
      <p>
        {lang === 'fr'
          ? 'Utilisez la recherche de l’en-tête.'
          : 'Use the search box in the header, for example “camp”.'}
      </p>
      <Embedded
        kind="island"
        remote="serp"
        name="SearchResults"
        router="App Router"
        cache="streamed"
        revalidate={3600}
        trail={TRAIL}
      >
        <Suspense fallback={<p>searching…</p>}>
          <Results lang={lang} searchParams={searchParams} />
        </Suspense>
      </Embedded>
    </main>
  )
}
