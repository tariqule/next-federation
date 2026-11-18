import { Suspense } from 'react'
import { getComponentDescriptor } from '@next-federation/next/server'
import { Embedded } from 'example-inspect'
import { federation, RemoteIsland } from './federation'
import { SiteMiniCart, SiteNav, SiteSearch } from './header.app'

const TRAIL = ['Storefront', 'App Router layout']

// The descriptor names the header build to render. It is cached (the
// remote's descriptor revalidate), so it is part of the static shell.
async function Part({
  lang,
  part: Component,
}: {
  lang: string
  part: typeof SiteNav
}) {
  const descriptor = await getComponentDescriptor(federation, 'header')
  return (
    <div data-embed-content="">
      <Component descriptor={descriptor} lang={lang} />
    </div>
  )
}

/** The storefront header: host markup around remote pieces. */
export function SiteHeader({ lang }: { lang: string }) {
  const component = (name: string, part: typeof SiteNav) => (
    <Embedded
      kind="remote component"
      remote="header"
      name={name}
      router="App Router"
      cache="static"
      trail={TRAIL}
    >
      <Suspense fallback={<span>…</span>}>
        <Part lang={lang} part={part} />
      </Suspense>
    </Embedded>
  )
  return (
    <header className="site-header">
      <strong className="brand">Trailhead</strong>
      {component('Header', SiteNav)}
      {component('SearchBox', SiteSearch)}
      {component('MiniCart', SiteMiniCart)}
      {/* A private island in a static shell: it streams in per request. */}
      <Embedded
        kind="island"
        remote="account"
        name="AccountBadge"
        router="App Router"
        cache="streamed"
        isPrivate
        trail={TRAIL}
      >
        <RemoteIsland
          remote="account"
          island="AccountBadge"
          locale={lang}
          private
          fallback={<span>…</span>}
          errorFallback={<a href={`/store/${lang}/account`}>Sign in</a>}
        />
      </Embedded>
    </header>
  )
}
