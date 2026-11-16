import type { GetServerSideProps } from 'next'
import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'
import { getIslandProps } from '../lib/federation'

// Review Focus 3. Props above the protocol's GET limit (2048 base64url
// characters) are sent by POST. The two Echo islands have equal props in a
// different key order; both carry the unicode string too. (The Pages Router
// keeps no island cache: each is fetched.)
const PAD = 'x'.repeat(3000)
// Latin with a combining accent, CJK, right-to-left, an emoji ZWJ sequence
// and an astral symbol (test/e2e/robustness.spec.ts has the same string).
const UNICODE = 'héllo é · 日本語 · עברית · 👩🏽‍💻 · 𝄞'

type Props = { islands: IslandProps[] }

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const id = String(ctx.query.id)
  return {
    props: {
      islands: await Promise.all([
        getIslandProps(ctx, {
          remote: 'fake',
          island: 'Echo',
          props: { id, pad: PAD, tag: 'big', text: UNICODE },
        }),
        getIslandProps(ctx, {
          remote: 'fake',
          island: 'Echo',
          props: { text: UNICODE, tag: 'big', pad: PAD, id },
        }),
        getIslandProps(ctx, {
          remote: 'b',
          island: 'Banner',
          props: { text: UNICODE },
        }),
      ]),
    },
  }
}

export default function BigProps({ islands }: Props) {
  return (
    <main>
      <h1>Big props</h1>
      {islands.map((island, i) => (
        <RemoteIsland key={i} {...island} fallback={<p>echo unavailable</p>} />
      ))}
    </main>
  )
}
