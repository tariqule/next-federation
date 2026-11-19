import { Embedded } from 'example-inspect'
import { PagePanel } from 'example-inspect/client'
import { RemoteIsland } from '../../lib/federation'
import { GUIDES, SOURCE } from '../../lib/guides'

const TRAIL = ['Storefront', 'App Router page /[lang]']

// The home page: a static shell. Its two public islands are prerendered into
// it and cached for an hour, until the admin's "Publish" expires them.
export default async function Home({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  return (
    <main>
      <PagePanel
        mode="partial"
        router="App Router"
        why="The page and its public islands are prerendered (static); only the header's private AccountBadge streams in per request."
        file={`${SOURCE}/app/[lang]/page.tsx`}
        guide={GUIDES.caching}
      />
      <h1>{lang === 'fr' ? 'Bienvenue' : 'Welcome to Trailhead'}</h1>
      <p>
        {lang === 'fr'
          ? 'Une boutique faite de morceaux servis par plusieurs applications.'
          : 'A shop page made of pieces that separate apps serve at runtime.'}
      </p>
      <Embedded
        kind="island"
        remote="cdp"
        name="CategoryNav"
        router="App Router"
        cache="static"
        revalidate={3600}
        trail={TRAIL}
      >
        <RemoteIsland
          remote="cdp"
          island="CategoryNav"
          props={{ locale: lang }}
          locale={lang}
          fallback={<p>loading categories…</p>}
        />
      </Embedded>
      <Embedded
        kind="island"
        remote="cdp"
        name="ProductGrid"
        router="App Router"
        cache="static"
        revalidate={3600}
        trail={TRAIL}
      >
        <RemoteIsland
          remote="cdp"
          island="ProductGrid"
          props={{ category: 'shoes', locale: lang }}
          locale={lang}
          fallback={<p>loading products…</p>}
          errorFallback={<p>Products are unavailable right now.</p>}
        />
      </Embedded>
    </main>
  )
}
