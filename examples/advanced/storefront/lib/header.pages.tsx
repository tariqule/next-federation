import Link from 'next/link'
import { useRouter } from 'next/router'
import { createRemoteComponent } from '@next-federation/next/pages/components'
import type { RemoteComponentDescriptor } from '@next-federation/react/components'
import { headerLinks, headerShared } from './header-shared'
import type { HeaderLinks } from './header-shared'

// Pages Router bindings of the same header components. In a mixed-router
// app each router has its own React, so each has its own remote component
// runtime (and loads the remote's server code once per router).
const Header = createRemoteComponent<{ Link: typeof Link; links: HeaderLinks }>(
  {
    expose: './Header',
    shared: headerShared,
    fallback: <span>loading the header…</span>,
    errorFallback: <span>header unavailable</span>,
  }
)
const MiniCart = createRemoteComponent({
  expose: './MiniCart',
  shared: headerShared,
  fallback: <span>cart…</span>,
  errorFallback: <span>cart unavailable</span>,
})
const SearchBox = createRemoteComponent<{
  action: string
  onSearch?: (query: string) => void
  label?: string
}>({
  expose: './SearchBox',
  shared: headerShared,
  fallback: <span>search…</span>,
  errorFallback: <span>search unavailable</span>,
})

type Props = { descriptor: RemoteComponentDescriptor | null }

export function PagesNav({ descriptor }: Props) {
  return (
    <Header descriptor={descriptor} Link={Link} links={headerLinks('en')} />
  )
}

export function PagesMiniCart({ descriptor }: Props) {
  return <MiniCart descriptor={descriptor} />
}

export function PagesSearch({ descriptor }: Props) {
  const router = useRouter()
  return (
    <SearchBox
      descriptor={descriptor}
      action="/store/en/search"
      // The search page is an App Router route: a full page load.
      onSearch={(q) => router.push(`/en/search?q=${encodeURIComponent(q)}`)}
    />
  )
}
