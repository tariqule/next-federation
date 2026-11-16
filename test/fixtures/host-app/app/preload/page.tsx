import { Suspense } from 'react'
import { RemoteIsland, preloadIsland } from '../../lib/federation'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const DELAY_MS = 300

// The island load starts before the page's own 300 ms of work; the
// RemoteIsland below reuses it (one request to the remote). The page prints
// when that work started, so a test can check the remote saw the request
// before it ended.
async function Body({ searchParams }: { searchParams: SearchParams }) {
  const { id } = await searchParams
  const spec = { remote: 'fake', island: 'Echo', props: { id: String(id) } }
  const startedAt = Date.now()
  preloadIsland(spec)
  await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
  return (
    <>
      <p data-testid="preload-timing">
        started {startedAt} delay {DELAY_MS}
      </p>
      <RemoteIsland
        {...spec}
        fallback={<p>loading echo…</p>}
        errorFallback={<p>echo unavailable</p>}
      />
    </>
  )
}

export default function Preload({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <main>
      <h1>Preload</h1>
      <Suspense fallback={<p>loading preload…</p>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  )
}
