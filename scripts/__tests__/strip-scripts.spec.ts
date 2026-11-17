// The e2e helper lives with the Playwright specs; its unit test runs here
// because Playwright would pick up any *.spec.ts under test/e2e.
import { markup, stripScripts } from '../../test/e2e/lib/strip-scripts.ts'

const page = (body: string) =>
  `<!DOCTYPE html><html><head><script src="/a.js"></script></head><body>${body}</body></html>`

test('drops every script element and keeps all other bytes as they were', () => {
  const html = page(
    `<div data-island="A" class='x'>Hi &amp; <b>there</b><!-- --></div><script>self.__x.push([1,"<div>fallback</div>"])</script>`
  )
  expect(stripScripts(html)).toBe(
    `<!DOCTYPE html><html><head></head><body><div data-island="A" class='x'>Hi &amp; <b>there</b><!-- --></div></body></html>`
  )
})

test('drops upper-case, spaced and attribute-heavy script tags', () => {
  const html = page(
    `<p>a</p><SCRIPT type="module">x()</SCRIPT ><p>b</p><script\nid="d" data-x=">">y</script\t>`
  )
  expect(stripScripts(html)).not.toMatch(/script/i)
  expect(stripScripts(html)).toContain('<p>a</p><p>b</p>')
})

test('a script whose text holds </div> or a fake tag ends where the parser says', () => {
  const html = page(
    `<script>"</div><script>"; if (a<b) {}</script><main>kept</main>`
  )
  expect(stripScripts(html)).toContain('<body><main>kept</main></body>')
})

test('scripts inside svg go too; markup also drops React text separators', () => {
  const html = page(`<svg><script>z</script><rect/></svg>a<!-- -->b`)
  expect(markup(html)).toContain('<body><svg><rect/></svg>ab</body>')
})
