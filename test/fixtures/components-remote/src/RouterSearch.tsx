import { useSearchParams } from 'next/navigation'

/** The `q` search param, with `next/navigation` (rewired by the build). */
export default function RouterSearch() {
  const q = useSearchParams().get('q')
  return <span data-testid="router-search">q={q ?? 'none'}</span>
}
