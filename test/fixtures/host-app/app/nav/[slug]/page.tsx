import { RemoteIsland } from '../../../lib/federation'

export function generateStaticParams() {
  return [{ slug: 'one' }, { slug: 'two' }]
}

export default async function Nav({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return (
    <main>
      <h1>Nav {slug}</h1>
      <RemoteIsland
        key={slug}
        remote="a"
        island="Links"
        props={{ slug }}
        fallback={<p>loading links…</p>}
      />
    </main>
  )
}
