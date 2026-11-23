// node examples/scripts/platform.mjs <start | dev | smoke>
//   start  (pnpm examples:platform)        production builds, served
//   dev    (pnpm examples:platform:dev)    dev servers (no React sharing)
//   smoke  (pnpm examples:platform:smoke)  production builds, HTTP checks, stop
// The commerce platform in examples/advanced (README.md there). Demo keys are
// written first if missing (examples/scripts/keys.mjs). Ctrl-C stops it.
import { ensureKeys } from './keys.mjs'
import { freshRun, startStack, stopAll, stopOnSignal } from './stack.mjs'

const STORE = 'http://localhost:13410/store'
const at = (port) => `http://127.0.0.1:${port}`
const islandRemote = (key, port) => ({
  key,
  dir: `advanced/${key}-remote`,
  port,
  ready: `${at(port)}/_nf/health`,
  remote: true,
})

/** The apps, in start order: remotes first (the storefront build prerenders pages that fetch from them). */
export const PLATFORM = [
  islandRemote('cdp', 13400),
  islandRemote('pdp', 13401),
  islandRemote('serp', 13402),
  islandRemote('account', 13403),
  {
    key: 'header',
    dir: 'advanced/header-remote-rspack',
    port: 13404,
    ready: `${at(13404)}/_nf/components.json`,
    remote: true,
    // Hosts server-render remote components from a build only.
    buildInDev: true,
  },
  {
    key: 'storefront',
    dir: 'advanced/storefront',
    port: 13410,
    ready: `${STORE}/en`,
    next: true,
  },
]

const PAGES = `
  Storefront (App Router)    ${STORE}/en          (French: ${STORE}/fr)
    category page (CDP)      ${STORE}/en/c/outdoor
    product page (PDP)       ${STORE}/en/p/A1
    search (SERP)            ${STORE}/en/search?q=camp
    account (blocking)       ${STORE}/en/account  (sign in as customer or admin)
  Admin (Pages Router)       ${STORE}/admin
  Remotes                    ${at(13400)}/_nf/health … ${at(13403)}/_nf/health, ${at(13404)}/_nf/components.json`

// --- smoke checks -------------------------------------------------------------

/**
 * Every JWT-shaped string in `body` whose payload names a user or an
 * audience: an identity token. (The header remote's signed descriptor is a
 * JWS too, with no `sub` or `aud`: public, and expected in the page.)
 */
function identityTokens(body) {
  const jwts = body.match(/eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g) ?? []
  return jwts.filter((jwt) => {
    try {
      const claims = JSON.parse(
        Buffer.from(jwt.split('.')[1], 'base64url').toString()
      )
      return 'sub' in claims || 'aud' in claims
    } catch {
      return true
    }
  })
}

/**
 * Fetches `url`; requires status 200, every `includes`, none of `excludes`
 * in the markup (scripts removed: the RSC payload also lists fallbacks that
 * did not render), and no identity token anywhere in the response.
 */
async function expectPage(url, { includes = [], excludes = [], init } = {}) {
  const res = await fetch(url, { redirect: 'manual', ...init })
  // React separates adjacent text with <!-- -->: ignore it.
  const body = (await res.text()).replaceAll('<!-- -->', '')
  // Test-only text matching, never rendered: drop every script element
  // (any case, repeated until nothing changes) before checking what shows.
  let markup = body
  for (let before = ''; before !== markup; ) {
    before = markup
    markup = markup.replace(/<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi, '')
  }
  const missing = includes.filter((text) => !body.includes(text))
  const present = excludes.filter((text) => markup.includes(text))
  if (identityTokens(body).length > 0) present.push('an identity token')
  if (res.status !== 200 || missing.length > 0 || present.length > 0) {
    throw new Error(
      `${url}: status ${res.status}` +
        (missing.length
          ? `, missing ${missing.map((m) => JSON.stringify(m)).join(', ')}`
          : '') +
        (present.length
          ? `, must not contain ${present.map(String).join(', ')}`
          : '')
    )
  }
  console.log(`  ok  ${url}`)
  return body
}

/**
 * Requires a header link (`class="header-link"`) whose href starts with
 * the storefront's basePath, `/store/`, in either attribute order.
 */
function expectHeaderLink(body, url) {
  const anchors = body.match(/<a\b[^>]*>/g) ?? []
  const ok = anchors.some(
    (a) => a.includes('class="header-link"') && a.includes('href="/store/')
  )
  if (!ok) throw new Error(`${url}: no header link with href="/store/…"`)
  console.log(`  ok  ${url}: header link href="/store/…"`)
}

/** Signs in through the storefront's demo session route; returns the Cookie header. */
async function signIn(user, role) {
  const res = await fetch(`${STORE}/api/session`, {
    method: 'POST',
    body: new URLSearchParams({ user, role, next: '/en/account' }),
    redirect: 'manual',
  })
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0])
  if (res.status !== 303 || cookies.length < 2) {
    throw new Error(`sign-in answered ${res.status} without cookies`)
  }
  return cookies.join('; ')
}

// The library's mark for a remote component the server left to the browser.
const BROWSER_ONLY = '<template data-nf-browser-only'

async function smoke() {
  for (const port of [13400, 13401, 13402, 13403]) {
    await expectPage(`${at(port)}/_nf/health`)
  }
  // The Rspack build's descriptor, signed (nf-describe with the demo key).
  await expectPage(`${at(13404)}/_nf/components.json`, {
    includes: ['"name": "header"', '"jws"'],
  })

  // Static shell: the CDP islands and the header components, server-rendered
  // (the header from the verified Rspack build, with the host's design system).
  const shell = await expectPage(`${STORE}/en`, {
    includes: [
      'Trail shoe',
      'rendered by the CDP remote',
      'class="header-link"',
      'data-ds-copy="host"',
    ],
    excludes: [BROWSER_ONLY],
  })
  // The header's next/link, rewired to the storefront's router: its hrefs
  // get the /store basePath.
  expectHeaderLink(shell, `${STORE}/en`)
  await expectPage(`${STORE}/fr/c/outdoor`, {
    includes: ['Veste de pluie', 'href="/store/fr/p/B1"'],
  })
  await expectPage(`${STORE}/en/p/A1`, {
    includes: ['Trail shoe', 'Photo 1', 'Road runner', 'Add to cart'],
    excludes: [BROWSER_ONLY],
  })
  await expectPage(`${STORE}/en/search?q=camp`, {
    includes: ['results for “camp”'],
  })

  // One sign-in, private islands from two remotes, each with its own token.
  const customer = await signIn('smoke', 'customer')
  const account = await expectPage(`${STORE}/en/account`, {
    init: { headers: { cookie: customer } },
    includes: ['Orders for smoke', 'Profile', 'Hi, smoke'],
    excludes: ['Sign in to see your'],
  })
  // Blocking: the islands are in place in the first HTML, ahead of any
  // streamed Suspense content.
  const streamed = account.indexOf('<div hidden id="S:')
  if (streamed !== -1 && account.indexOf('Orders for smoke') > streamed) {
    throw new Error(
      'account: the blocking Orders island was streamed, not in the first HTML'
    )
  }
  console.log('  ok  account: blocking islands in the first HTML, no token')
  await expectPage(`${STORE}/en/p/B2`, {
    init: { headers: { cookie: customer } },
    includes: ['Picked for smoke'],
  })

  // A Server Action round trip, as the island's browser code sends it: to
  // the account remote's build, with a token for the `account` audience.
  const base = account.match(/http:\/\/127\.0\.0\.1:13403\/b\/[\w-]+\//)?.[0]
  const id = account.match(/[\w/.-]+#updateProfile/)?.[0]
  if (!base || !id)
    throw new Error('account: no action id or build base in the HTML')
  const tokenRes = await fetch(
    `${STORE}/api/next-federation/token?aud=account`,
    {
      method: 'POST',
      headers: { cookie: customer },
    }
  )
  const { token } = await tokenRes.json()
  const action = (auth) =>
    fetch(`${base}_nf/action?island=Profile`, {
      method: 'POST',
      headers: {
        'x-nf-action': id,
        'content-type': 'text/plain;charset=UTF-8',
        ...(auth ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(['Smoke Tester']),
    })
  const ok = await action(true)
  const reply = await ok.text()
  if (ok.status !== 200 || !reply.includes('"ok":true')) {
    throw new Error(`updateProfile: ${ok.status} ${reply.slice(0, 200)}`)
  }
  const refused = await action(false)
  if (refused.status !== 401) {
    throw new Error(
      `updateProfile without a token answered ${refused.status}, not 401`
    )
  }
  console.log('  ok  Server Action: 200 with the token, 401 (NF-014) without')
  await expectPage(`${STORE}/en/account`, {
    init: { headers: { cookie: customer } },
    includes: ['Smoke Tester'],
  })

  // The admin island checks the role claim in the signed token.
  await expectPage(`${STORE}/admin`, {
    init: { headers: { cookie: customer } },
    includes: [
      'Admins only',
      'data-testid="inventory-refused"',
      'Trail shoe',
      'class="header-link"',
    ],
    excludes: ['data-testid="inventory"', BROWSER_ONLY],
  })
  const admin = await signIn('boss', 'admin')
  await expectPage(`${STORE}/admin`, {
    init: { headers: { cookie: admin } },
    includes: ['data-testid="inventory"', 'In stock', '+10'],
    excludes: ['Admins only'],
  })
}

const mode = process.argv[2]
if (!['dev', 'start', 'smoke'].includes(mode)) {
  console.error(
    'usage: node examples/scripts/platform.mjs <start | dev | smoke>'
  )
  process.exit(1)
}

if (ensureKeys()) console.log('platform: wrote demo keys (.env.local files)')
stopOnSignal()

try {
  if (mode === 'smoke') {
    freshRun(PLATFORM)
    console.log('platform: building and starting (logs in examples/.logs)')
    await startStack('start', { apps: PLATFORM })
    console.log('platform: smoke checks')
    await smoke()
    console.log('platform: smoke passed')
    await stopAll()
  } else {
    await startStack(mode, { log: 'console', apps: PLATFORM })
    console.log(`\nplatform: all running (Ctrl-C stops them)${PAGES}\n`)
  }
} catch (error) {
  console.error(`platform: ${error instanceof Error ? error.message : error}`)
  await stopAll()
  process.exit(1)
}
