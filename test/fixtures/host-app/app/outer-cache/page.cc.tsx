import { cacheLife } from 'next/cache'
import { Suspense } from 'react'
import { RemoteIsland } from '../../lib/federation'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// A host-level 'use cache' with a long lifetime around an island: an island
// failure inside it must not be cached for that lifetime.
async function CachedSection({ id }: { id: string }) {
  'use cache'
  cacheLife('hours')
  return (
    <section>
      <h2>cached section {id}</h2>
      <RemoteIsland
        remote="fake"
        island="Flaky"
        props={{ id }}
        fallback={<p>loading flaky…</p>}
        errorFallback={<p>flaky unavailable</p>}
      />
    </section>
  )
}

async function Body({ searchParams }: { searchParams: SearchParams }) {
  const { id } = await searchParams
  return <CachedSection id={String(id)} />
}

export default function OuterCache({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <main>
      <h1>Outer cache</h1>
      <Suspense fallback={<p>loading section…</p>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  )
}
