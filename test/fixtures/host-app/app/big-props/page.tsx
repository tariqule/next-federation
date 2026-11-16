import { Suspense } from 'react'
import { RemoteIsland } from '../../lib/federation'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// Review Focus 3. Props above the protocol's GET limit (2048 base64url
// characters) are sent by POST; the two Echo islands have equal props in a
// different key order, so they share one cache entry (canonical JSON). Both
// carry the unicode string too.
const PAD = 'x'.repeat(3000)
// Latin with a combining accent, CJK, right-to-left, an emoji ZWJ sequence
// and an astral symbol (test/e2e/robustness.spec.ts has the same string).
const UNICODE = 'héllo é · 日本語 · עברית · 👩🏽‍💻 · 𝄞'

async function Body({ searchParams }: { searchParams: SearchParams }) {
  const id = String((await searchParams).id)
  return (
    <>
      <RemoteIsland
        remote="fake"
        island="Echo"
        props={{ id, pad: PAD, tag: 'big', text: UNICODE }}
        fallback={<p>loading echo…</p>}
        errorFallback={<p>echo unavailable</p>}
      />
      <RemoteIsland
        remote="fake"
        island="Echo"
        props={{ text: UNICODE, tag: 'big', pad: PAD, id }}
        fallback={<p>loading echo…</p>}
        errorFallback={<p>echo unavailable</p>}
      />
      <RemoteIsland
        remote="b"
        island="Banner"
        props={{ text: UNICODE }}
        fallback={<p>loading banner…</p>}
      />
    </>
  )
}

export default function BigProps({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <main>
      <h1>Big props</h1>
      <Suspense fallback={<p>loading big props…</p>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  )
}
