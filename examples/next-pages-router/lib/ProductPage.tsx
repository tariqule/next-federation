import { RemoteIsland } from '@next-federation/next/pages'
import type { IslandProps } from '@next-federation/next/pages'
import type { RemoteComponentDescriptor } from '@next-federation/next/pages/server'
import { CartButton } from './CartButton'

export type ProductPageProps = {
  sku: string
  locale: string
  product: IslandProps
  links: IslandProps
  cart: RemoteComponentDescriptor | null
}

const TEXT = {
  en: { title: 'Product', more: 'More products' },
  fr: { title: 'Produit', more: 'Autres produits' },
}

// Two islands from the `shop` remote and a client component from the `cart`
// remote. Props come from getProductPageProps (lib/product-props.ts).
export function ProductPage({
  sku,
  locale,
  product,
  links,
  cart,
}: ProductPageProps) {
  const t = locale === 'fr' ? TEXT.fr : TEXT.en
  return (
    <main>
      <h1>
        {t.title} {sku}
      </h1>
      <RemoteIsland {...product} fallback={<p>product unavailable</p>} />
      <CartButton descriptor={cart} sku={sku} />
      <h2>{t.more}</h2>
      <RemoteIsland key={sku} {...links} fallback={<p>links unavailable</p>} />
    </main>
  )
}
