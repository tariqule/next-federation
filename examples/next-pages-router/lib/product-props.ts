// Server-side only (getServerSideProps): fetches what one product page shows.
import type { GetServerSideProps } from 'next'
import { getComponentDescriptor } from '@next-federation/next/pages/server'
import { federation, getIslandProps } from './federation'
import type { ProductPageProps } from './ProductPage'

const SKUS = ['A1', 'B2', 'C3']

export const getProductPageProps =
  (fixedSku?: string): GetServerSideProps<ProductPageProps> =>
  async (ctx) => {
    const sku = fixedSku ?? String(ctx.params?.sku)
    // The remote's products only: any other SKU is a 404 (as in the App
    // Router host), so a public deployment asks the remote for these only.
    if (!SKUS.includes(sku)) return { notFound: true }
    const locale = ctx.locale ?? 'en'
    const [product, links, cart] = await Promise.all([
      // Islands, rendered by the remote. The price format needs the locale,
      // so it is a prop: React context does not cross into an island. (The
      // island's Link gets the basePath and locale without being told.)
      getIslandProps(ctx, {
        remote: 'shop',
        island: 'ProductPanel',
        props: { sku, locale },
      }),
      getIslandProps(ctx, {
        remote: 'shop',
        island: 'Links',
        props: { current: sku },
      }),
      // Remote component: names the `cart` remote build to server-render.
      getComponentDescriptor(federation, 'cart'),
    ])
    return { props: { sku, locale, product, links, cart } }
  }
