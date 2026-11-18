import * as CartContext from 'example-cart-context'
import * as DesignSystem from 'example-design-system'
import * as SessionContext from 'example-session-context'

// Demo probe (example-design-system): mark this host's copy, so the header
// remote's elements say which copy rendered them.
DesignSystem.claimCopy('host')

/**
 * The modules this host passes to the header remote (its `shared` list).
 * The two contexts must be the host's own module objects: the remote then
 * reads the host's cart and session. The design system satisfies the
 * remote's ^2.0.0, so the remote uses this copy instead of its bundled one.
 */
export const headerShared = {
  'example-cart-context': { version: '1.0.0', module: CartContext },
  'example-session-context': { version: '1.0.0', module: SessionContext },
  'example-design-system': {
    version: DesignSystem.version,
    module: DesignSystem,
  },
}

export type HeaderLinks = { href: string; label: string }[]

export function headerLinks(lang: string): HeaderLinks {
  return [
    { href: `/${lang}`, label: lang === 'fr' ? 'Accueil' : 'Home' },
    { href: `/${lang}/c/shoes`, label: lang === 'fr' ? 'Chaussures' : 'Shoes' },
    {
      href: `/${lang}/c/outdoor`,
      label: lang === 'fr' ? 'Plein air' : 'Outdoor',
    },
    { href: `/${lang}/account`, label: lang === 'fr' ? 'Compte' : 'Account' },
    // A Pages Router route: links between the two routers reload the page.
    { href: '/admin', label: 'Admin' },
  ]
}
