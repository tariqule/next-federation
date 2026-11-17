import { Suspense } from 'react'
import { RemoteIsland } from '../../../lib/federation'

export function generateStaticParams() {
  return [{ slug: 'one' }, { slug: 'two' }]
}

// `params` is read inside <Suspense>, as Next recommends: with
// partialPrefetching (the cacheComponents host) URL data outside a boundary
// is reported as blocking an instant navigation.
async function NavBody({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return (
    <>
      <h1>Nav {slug}</h1>
      <RemoteIsland
        key={slug}
        remote="a"
        island="Links"
        props={{ slug }}
        fallback={<p>loading links…</p>}
      />
    </>
  )
}

export default function Nav({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <main>
      <Suspense fallback={<p>loading nav…</p>}>
        <NavBody params={params} />
      </Suspense>
    </main>
  )
}
