import { Link } from '@next-federation/island'
import { Counter } from './Counter'

// Hrefs are host-relative; Link adds the host's basePath and locale from the
// navigation bridge.
export default async function Links({ slug }: { slug: string }) {
  const other = slug === 'one' ? 'two' : 'one'
  return (
    <nav data-island="Links">
      <span data-testid="slug">on {slug}</span>{' '}
      <Link href={`/nav/${other}`}>go to {other}</Link> <Counter />
    </nav>
  )
}
