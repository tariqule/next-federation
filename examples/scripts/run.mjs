// node examples/scripts/run.mjs <dev | start | smoke>
//   dev    (pnpm examples:dev)    dev servers; Ctrl-C stops everything
//   start  (pnpm examples:start)  production builds, served; Ctrl-C stops
//   smoke  (pnpm examples:smoke)  production builds, a few HTTP checks, stop
// Demo keys are written first if missing (examples/scripts/keys.mjs).
import { ensureKeys } from './keys.mjs'
import { URLS, freshRun, startStack, stopAll, stopOnSignal } from './stack.mjs'

const mode = process.argv[2]
if (!['dev', 'start', 'smoke'].includes(mode)) {
  console.error('usage: node examples/scripts/run.mjs <dev | start | smoke>')
  process.exit(1)
}

if (ensureKeys()) console.log('examples: wrote demo keys (.env.local files)')
stopOnSignal()

const PAGES = `
  App Router host     ${URLS.app}            (signed-in island: ${URLS.app}/orders)
  Pages Router host   ${URLS.pages}       (French: ${URLS.pages}/fr)
  React SPA host      ${URLS.spa}
  island remote       ${URLS.remote}/_nf/health
  components remote   ${URLS.components}/_nf/components.json`

/** One smoke check: fetch `url`, require status 200 and every `includes`. */
async function expectPage(url, includes, init) {
  const res = await fetch(url, { redirect: 'manual', ...init })
  // React separates adjacent text with <!-- -->: ignore it.
  const body = (await res.text()).replaceAll('<!-- -->', '')
  const missing = includes.filter((text) => !body.includes(text))
  if (res.status !== 200 || missing.length > 0) {
    throw new Error(
      `${url}: status ${res.status}${missing.length ? `, missing ${missing.map((m) => JSON.stringify(m)).join(', ')}` : ''}`
    )
  }
  console.log(`  ok  ${url}`)
}

/** Signs in through the host's demo form route; returns the Cookie header. */
async function signIn(url, user) {
  const res = await fetch(url, {
    method: 'POST',
    body: new URLSearchParams({ user }),
    redirect: 'manual',
  })
  const cookie = res.headers.get('set-cookie')
  if (res.status !== 303 || !cookie) {
    throw new Error(`${url}: sign-in answered ${res.status} without a cookie`)
  }
  return cookie.split(';')[0]
}

async function smoke() {
  await expectPage(`${URLS.remote}/_nf/health`, [])
  await expectPage(`${URLS.components}/_nf/components.json`, ['"cart"'])
  // Server-rendered island HTML and a server-rendered client component.
  await expectPage(`${URLS.app}/`, [
    'Trail shoe',
    'remote build',
    'Add A1 to cart',
  ])
  const appUser = await signIn(`${URLS.app}/api/session`, 'smoke')
  await expectPage(`${URLS.app}/orders`, ['Orders for smoke'], {
    headers: { cookie: appUser },
  })
  // basePath + French locale: island links carry both.
  await expectPage(`${URLS.pages}/fr`, [
    'Produit A1',
    'Trail shoe',
    'href="/shop/fr/products/B2"',
    'Add A1 to cart',
  ])
  const pagesUser = await signIn(`${URLS.pages}/api/session`, 'smoke')
  await expectPage(`${URLS.pages}/orders`, ['Orders for smoke'], {
    headers: { cookie: pagesUser },
  })
  // The SPA renders in the browser; check it is served.
  await expectPage(`${URLS.spa}/`, ['<div id="root">'])
}

try {
  if (mode === 'smoke') {
    freshRun()
    console.log('examples: building and starting (logs in examples/.logs)')
    await startStack('start')
    console.log('examples: smoke checks')
    await smoke()
    console.log('examples: smoke passed')
    await stopAll()
  } else {
    await startStack(mode, { log: 'console' })
    console.log(`\nexamples: all running (Ctrl-C stops them)${PAGES}\n`)
  }
} catch (error) {
  console.error(`examples: ${error instanceof Error ? error.message : error}`)
  await stopAll()
  process.exit(1)
}
