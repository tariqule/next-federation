// `pnpm examples:walkthrough`: builds and starts every example (as
// `pnpm examples:start` does), drives them in Chromium with the repo's
// Playwright (test/e2e), checks what each step shows, and saves 1280×800
// screenshots to docs/examples/screenshots/. Step (f) redeploys the island
// remote (a new build, nf-serve restarted) while a page stays open.
// Needs the packages built (`pnpm build`) and Playwright's Chromium
// (`pnpm --filter e2e exec playwright install chromium`).
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { ensureKeys } from './keys.mjs'
import {
  APPS,
  EXAMPLES,
  URLS,
  freshRun,
  runScript,
  startScript,
  startStack,
  stopAll,
  stopApp,
  stopOnSignal,
  waitFor,
} from './stack.mjs'

const ROOT = join(EXAMPLES, '..')
const OUT = join(ROOT, 'docs', 'examples', 'screenshots')
const { chromium, expect } = createRequire(
  join(ROOT, 'test', 'e2e', 'package.json')
)('@playwright/test')

const VIEWPORT = { width: 1280, height: 800 }
const shots = []

async function shot(page, name) {
  const path = join(OUT, `${name}.png`)
  await page.screenshot({ path })
  shots.push(path)
  console.log(`  saved ${path.slice(ROOT.length + 1)}`)
}

/** The build id printed by the ProductPanel island on the page. */
async function islandBuild(page) {
  const text = await page.locator('.shop-build').first().textContent()
  return text.replace('remote build ', '').trim()
}

async function walkthrough(browser) {
  const app = await browser.newContext({ viewport: VIEWPORT })
  const page = await app.newPage()

  console.log('(a) App Router: server-rendered island (JavaScript off)')
  const noJs = await browser.newContext({
    viewport: VIEWPORT,
    javaScriptEnabled: false,
  })
  const staticPage = await noJs.newPage()
  await staticPage.goto(`${URLS.app}/`)
  await expect(staticPage.getByText('Trail shoe')).toBeVisible()
  await expect(staticPage.getByText('Add A1 to cart')).toBeVisible()
  await shot(staticPage, 'a-app-router-server-rendered-island')
  await noJs.close()

  console.log('(g) App Router: server-rendered client component (Mode A)')
  const response = await page.goto(`${URLS.app}/`)
  const html = (await response.text()).replaceAll('<!-- -->', '')
  if (!html.includes('Add A1 to cart')) {
    throw new Error('the Mode A component is not in the server HTML')
  }
  const add = page.getByRole('button', { name: 'Add A1 to cart' })
  await expect(add).toBeVisible()
  await shot(page, 'g-app-router-mode-a-server-rendered')

  console.log('(h) the same component after two clicks: the host cart updates')
  await add.click()
  await add.click()
  await expect(page.getByText('Cart: 2 item(s)')).toBeVisible()
  await expect(page.getByText('2 in your cart')).toBeVisible()
  await shot(page, 'h-app-router-mode-a-after-click')

  console.log('(c) island link: host navigation without a reload')
  await page.evaluate(() => (window.__walkthrough = 'same document'))
  await page
    .locator('.shop-links')
    .getByRole('link', { name: 'Rain jacket' })
    .click()
  await expect(page).toHaveURL(`${URLS.app}/products/B2`)
  await expect(page.getByRole('heading', { name: 'Product B2' })).toBeVisible()
  await expect(page.getByText('Rain jacket').first()).toBeVisible()
  if ((await page.evaluate(() => window.__walkthrough)) !== 'same document') {
    throw new Error('the island link reloaded the page')
  }
  // In-memory host state survived: the cart still has two items.
  await expect(page.getByText('Cart: 2 item(s)')).toBeVisible()
  await shot(page, 'c-island-link-navigates-host')

  console.log('(b) private island after signing in')
  await page.goto(`${URLS.app}/orders`)
  await expect(page.getByText('Sign in to see your orders.')).toBeVisible()
  await page.getByPlaceholder('any name').fill('ada')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(
    page.getByRole('heading', { name: 'Orders for ada' })
  ).toBeVisible()
  await shot(page, 'b-private-island-signed-in')

  console.log('(d) Pages Router in French, with basePath /shop')
  await page.goto(`${URLS.pages}/fr`)
  await expect(page.getByRole('heading', { name: 'Produit A1' })).toBeVisible()
  await expect(page.getByText(/Prix\s*:\s*89,00/)).toBeVisible()
  const link = page
    .locator('.shop-links')
    .getByRole('link', { name: 'Rain jacket' })
  await expect(link).toHaveAttribute('href', '/shop/fr/products/B2')
  await shot(page, 'd-pages-router-french-basepath')

  console.log('(e) SPA with two remotes (an island and a client component)')
  await page.goto(`${URLS.spa}/`)
  await expect(page.getByText('Trail shoe')).toBeVisible()
  // The island's own stylesheet is loaded (a bordered panel).
  await expect(page.locator('.shop-panel')).toHaveCSS(
    'border-top-style',
    'solid'
  )
  const spaAdd = page.getByRole('button', { name: 'Add A1 to cart' })
  await spaAdd.click()
  await expect(page.getByText('Cart: 1')).toBeVisible()
  await shot(page, 'e-spa-two-remotes')

  console.log('(f) redeploying the island remote while a page is open')
  await page.goto(`${URLS.app}/`)
  const before = await islandBuild(page)
  await page.getByRole('button', { name: 'Add A1 to cart' }).click()
  await shot(page, 'f1-before-redeploy')
  const remote = APPS.find((a) => a.key === 'remote')
  const newBuild = `walkthrough-${Date.now().toString(36)}`
  await runScript(remote, 'build', { env: { NF_BUILD_ID: newBuild } })
  await stopApp('remote')
  startScript(remote, 'start')
  await waitFor(remote.ready)
  // The open page keeps working: its island still runs (old build).
  const plus = page.locator('.shop-quantity').getByRole('button', { name: '+' })
  await plus.click()
  await expect(page.locator('.shop-quantity output')).toHaveText('2')
  // A client navigation mounts a never-cached island: the new build renders
  // it, in the same document, next to the old build's code.
  await page
    .locator('.shop-links')
    .getByRole('link', { name: 'Camp mug' })
    .click()
  await expect(page.getByRole('heading', { name: 'Product C3' })).toBeVisible()
  const after = await islandBuild(page)
  if (after !== newBuild) {
    throw new Error(
      `expected build ${newBuild} after the redeploy, got ${after}`
    )
  }
  await expect(page.getByText('Cart: 1 item(s)')).toBeVisible()
  await plus.click()
  await expect(page.locator('.shop-quantity output')).toHaveText('2')
  console.log(`  builds: ${before} -> ${after}, no reload`)
  await shot(page, 'f2-after-redeploy-same-tab')
  await app.close()
}

stopOnSignal()
mkdirSync(OUT, { recursive: true })
ensureKeys()
freshRun()
let browser
try {
  console.log('examples: building and starting (logs in examples/.logs)')
  await startStack('start')
  browser = await chromium.launch()
  await walkthrough(browser)
  console.log(`examples: walkthrough passed, ${shots.length} screenshots`)
} catch (error) {
  console.error(`examples: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
} finally {
  await browser?.close()
  await stopAll()
}
