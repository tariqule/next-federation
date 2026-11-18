import { withNextFederation } from '@next-federation/next/config'

// basePath and the locale are sent to the remote, so island links render as
// /shop/fr/products/B2 on the French pages.
export default withNextFederation({
  basePath: '/shop',
  i18n: { locales: ['en', 'fr'], defaultLocale: 'en' },
  // The app lives under /shop: send `/` there.
  async redirects() {
    return [
      {
        source: '/',
        destination: '/shop',
        basePath: false,
        permanent: false,
      },
    ]
  },
})
