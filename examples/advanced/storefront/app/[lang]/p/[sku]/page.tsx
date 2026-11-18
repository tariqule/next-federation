import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { getComponentDescriptor } from '@next-federation/next/server'
import { Embedded } from 'example-inspect'
import { PagePanel } from 'example-inspect/client'
import { federation, RemoteIsland } from '../../../../lib/federation'
import { LOCALES, SKUS } from '../../../../lib/federation.config'
import { GUIDES, SOURCE } from '../../../../lib/guides'
import { AddToCart } from '../../../../lib/header.app'

const TRAIL = ['Storefront', 'App Router page /[lang]/p/[sku]']

export function generateStaticParams() {
  return LOCALES.flatMap((lang) => SKUS.map((sku) => ({ lang, sku })))
}

async function AddToCartButton({ sku, lang }: { sku: string; lang: string }) {
  const descriptor = await getComponentDescriptor(federation, 'header')
  return (
    <div data-embed-content="">
      <AddToCart
        descriptor={descriptor}
        sku={sku}
        label={lang === 'fr' ? 'Ajouter au panier' : 'Add to cart'}
      />
    </div>
  )
}

// PDP (product detail page): a static shell with two public PDP islands and
// a remote component, plus a private island that streams in per request.
export default async function Product({
  params,
}: {
  params: Promise<{ lang: string; sku: string }>
}) {
  const { lang, sku } = await params
  if (!SKUS.includes(sku)) notFound()
  return (
    <main>
      <PagePanel
        mode="partial"
        router="App Router"
        why="ProductDetail, Recommendations and AddToCart are in the prerendered shell; the private ForYou and AccountBadge islands stream in per request."
        file={`${SOURCE}/app/[lang]/p/[sku]/page.tsx`}
        guide={GUIDES.caching}
      />
      <Embedded
        kind="island"
        remote="pdp"
        name="ProductDetail"
        router="App Router"
        cache="static"
        revalidate={3600}
        trail={TRAIL}
      >
        <RemoteIsland
          remote="pdp"
          island="ProductDetail"
          props={{ sku, locale: lang }}
          locale={lang}
          fallback={<p>loading the product…</p>}
          errorFallback={<p>This product is unavailable right now.</p>}
        />
      </Embedded>
      {/* The header remote's AddToCart updates the host's cart (shared context). */}
      <Embedded
        kind="remote component"
        remote="header"
        name="AddToCart"
        router="App Router"
        cache="static"
        trail={TRAIL}
      >
        <Suspense fallback={<span>…</span>}>
          <AddToCartButton sku={sku} lang={lang} />
        </Suspense>
      </Embedded>
      <h2>{lang === 'fr' ? 'Vous aimerez aussi' : 'You may also like'}</h2>
      <Embedded
        kind="island"
        remote="pdp"
        name="Recommendations"
        router="App Router"
        cache="static"
        revalidate={3600}
        trail={TRAIL}
      >
        <RemoteIsland
          remote="pdp"
          island="Recommendations"
          props={{ sku, locale: lang }}
          locale={lang}
          fallback={<p>loading…</p>}
        />
      </Embedded>
      <Embedded
        kind="island"
        remote="pdp"
        name="ForYou"
        router="App Router"
        cache="streamed"
        isPrivate
        trail={TRAIL}
      >
        <RemoteIsland
          remote="pdp"
          island="ForYou"
          props={{ locale: lang }}
          locale={lang}
          private
          fallback={<p>loading your picks…</p>}
          errorFallback={<p>Sign in to see picks for you.</p>}
        />
      </Embedded>
    </main>
  )
}
