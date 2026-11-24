'use client'
import { useRouter } from 'next/navigation'
import { createRemoteComponent } from '@next-federation/next/components'
import type { RemoteComponentDescriptor } from '@next-federation/react/components'
import { headerLinks, headerShared } from './header-shared'
import type { HeaderLinks } from './header-shared'

// App Router bindings of the header remote's components (Rspack build).
// They run on this host's React; on the server they render only from a
// verified (signed) build.
const Header = createRemoteComponent<{ links: HeaderLinks }>({
  expose: './Header',
  shared: headerShared,
  fallback: <span>loading the header…</span>,
  errorFallback: <span>header unavailable</span>,
})
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
export const AddToCart = createRemoteComponent<{ sku: string; label: string }>({
  expose: './AddToCart',
  shared: headerShared,
  fallback: <span>loading…</span>,
  errorFallback: <span>add to cart unavailable</span>,
})

type Props = { descriptor: RemoteComponentDescriptor | null; lang: string }

// The header's links are its own next/link, rewired by its build: this entry
// gives them the App Router, so they navigate with this host's router.
export function SiteNav({ descriptor, lang }: Props) {
  return <Header descriptor={descriptor} links={headerLinks(lang)} />
}

export function SiteMiniCart({ descriptor }: Props) {
  return <MiniCart descriptor={descriptor} />
}

export function SiteSearch({ descriptor, lang }: Props) {
  const router = useRouter()
  return (
    <SearchBox
      descriptor={descriptor}
      // Before hydration the form posts here (basePath included).
      action={`/store/${lang}/search`}
      onSearch={(q) =>
        router.push(`/${lang}/search?q=${encodeURIComponent(q)}`)
      }
      label={lang === 'fr' ? 'Rechercher' : 'Search'}
    />
  )
}
