// `pnpm examples:demo-keys`: prints the environment variables of the live
// demo's five Vercel projects (docs/maintainers/live-demo.md), with NEW keys
// on every run. It writes nothing: paste each value into the project's
// settings, then the keys exist only there.
//
// The URLs default to https://<prefix><name>.vercel.app; set
// SHOP_ORIGIN, CART_ORIGIN, APP_ROUTER_ORIGIN, PAGES_ROUTER_ORIGIN or
// SPA_ORIGIN to override one, and --prefix <prefix> to change the prefix
// (default next-federation-example-).
import { privateJwk } from './keys.mjs'

const argv = process.argv.slice(2)
const at = argv.indexOf('--prefix')
const prefix = at === -1 ? 'next-federation-example-' : argv[at + 1]
if (!prefix || prefix.startsWith('-')) {
  console.error('usage: pnpm examples:demo-keys [--prefix <prefix>]')
  console.error('--prefix needs a value, for example --prefix my-demo-')
  process.exit(1)
}
const url = (env, name) =>
  process.env[env] || `https://${prefix}${name}.vercel.app`

const shop = url('SHOP_ORIGIN', 'vite-remote')
const cart = url('CART_ORIGIN', 'components-remote')
const appRouter = url('APP_ROUTER_ORIGIN', 'app-router')
const pagesRouter = url('PAGES_ROUTER_ORIGIN', 'pages-router')
const spa = url('SPA_ORIGIN', 'react-spa')

const month = new Date().toISOString().slice(0, 7)
const components = privateJwk(`demo-components-${month}`)
const { d: _private, ...componentsPublic } = components
void _private
const signingKey = (host) => ({
  ...privateJwk(`demo-${host}-${month}`),
  alg: 'ES256',
})

// [project, folder, [name, value, private?][]]
const PROJECTS = [
  [
    `${prefix}vite-remote`,
    'examples/vite-remote',
    [
      ['NF_PUBLIC_ORIGIN', shop],
      ['APP_ROUTER_ORIGIN', appRouter],
      ['PAGES_ROUTER_ORIGIN', pagesRouter],
      ['SPA_ORIGIN', spa],
    ],
  ],
  [
    `${prefix}components-remote`,
    'examples/components-remote',
    [
      ['NF_PUBLIC_ORIGIN', cart],
      ['NF_COMPONENTS_SIGNING_KEY', components, true],
    ],
  ],
  [
    `${prefix}app-router`,
    'examples/next-app-router',
    [
      ['SHOP_ORIGIN', shop],
      ['CART_ORIGIN', cart],
      ['APP_ROUTER_ORIGIN', appRouter],
      ['NF_SIGNING_KEY', signingKey('app'), true],
      ['NF_COMPONENTS_PUBLIC_KEY', componentsPublic],
    ],
  ],
  [
    `${prefix}pages-router`,
    'examples/next-pages-router',
    [
      ['SHOP_ORIGIN', shop],
      ['CART_ORIGIN', cart],
      ['PAGES_ROUTER_ORIGIN', pagesRouter],
      ['NF_SIGNING_KEY', signingKey('pages'), true],
      ['NF_COMPONENTS_PUBLIC_KEY', componentsPublic],
    ],
  ],
  [
    `${prefix}react-spa`,
    'examples/react-spa',
    [
      ['VITE_SHOP_ORIGIN', shop],
      ['VITE_CART_ORIGIN', cart],
    ],
  ],
]

console.log(`# Live demo environment variables. New keys on every run: nothing is saved.
# Per project, set each NAME to the text after the first "=", for Production
# only (previews are not built). Mark the private keys Sensitive. Deploy the
# remotes first.`)
for (const [project, folder, vars] of PROJECTS) {
  console.log(`\n## ${project} (Root Directory ${folder})`)
  for (const [name, value, secret] of vars) {
    if (secret) console.log(`# private key: Sensitive, this project only`)
    console.log(
      `${name}=${typeof value === 'string' ? value : JSON.stringify(value)}`
    )
  }
}
