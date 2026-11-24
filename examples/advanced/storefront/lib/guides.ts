const DOCS = 'https://github.com/tariqule/next-federation/blob/main/docs/guides'

export const GUIDES = {
  caching: { href: `${DOCS}/caching.mdx`, label: 'Caching' },
  identity: { href: `${DOCS}/identity.mdx`, label: 'Identity' },
  actions: {
    href: `${DOCS}/server-actions.mdx`,
    label: 'Server Actions in islands',
  },
  blocking: {
    href: `${DOCS}/getting-started-app-router.mdx#put-private-content-in-the-first-html`,
    label: 'Private content in the first HTML (blocking)',
  },
  components: {
    href: `${DOCS}/remote-components/security.mdx#mixed-router-hosts`,
    label: 'Remote components: mixed-router hosts',
  },
}

export const SOURCE = 'examples/advanced/storefront'
