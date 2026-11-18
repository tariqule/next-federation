import { notFound } from 'next/navigation'
import { Embedded } from 'example-inspect'
import { PagePanel } from 'example-inspect/client'
import { RemoteIsland } from '../../../../lib/federation'
import { CATEGORY_SLUGS, LOCALES } from '../../../../lib/federation.config'
import { GUIDES, SOURCE } from '../../../../lib/guides'

const TRAIL = ['Storefront', 'App Router page /[lang]/c/[category]']

export function generateStaticParams() {
  return LOCALES.flatMap((lang) =>
    CATEGORY_SLUGS.map((category) => ({ lang, category }))
  )
}

// CDP (category page): the CDP remote's islands, prerendered per category
// and locale. The grid is cached for 10 minutes (per-island revalidate).
export default async function Category({
  params,
}: {
  params: Promise<{ lang: string; category: string }>
}) {
  const { lang, category } = await params
  if (!CATEGORY_SLUGS.includes(category)) notFound()
  return (
    <main>
      <PagePanel
        mode="partial"
        router="App Router"
        why="Prerendered per category and locale (generateStaticParams); only the header's private AccountBadge streams in."
        file={`${SOURCE}/app/[lang]/c/[category]/page.tsx`}
        guide={GUIDES.caching}
      />
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
        revalidate={600}
        trail={TRAIL}
      >
        <RemoteIsland
          remote="cdp"
          island="ProductGrid"
          props={{ category, locale: lang }}
          locale={lang}
          revalidate={600}
          fallback={<p>loading products…</p>}
          errorFallback={<p>Products are unavailable right now.</p>}
        />
      </Embedded>
    </main>
  )
}
