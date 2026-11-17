// Gate G1 (Phase 3): before an island hydrates, `<Form>` (from @next-federation/island)
// renders its fields inside a disabled `<fieldset>`. This proves, in every engine, that
// such markup cannot be submitted: not by Enter (on the body, after Tab presses, or in the
// autofocused field), not by clicking the submit button, and not by a `<button form=…>`
// inside the fieldset. A control page without `disabled` proves the checks can fail.
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Exactly what <Form> server-renders (see packages/island/src/form.tsx).
const FIELDSET_STYLE = 'border:0;padding:0;margin:0;min-width:0'
const page = (disabled: boolean) => `<!doctype html>
<html><head><meta charset="utf-8"><title>gate</title></head>
<body>
<p>before</p>
<form id="f" action="/submitted" method="post">
  <fieldset ${disabled ? 'disabled=""' : ''} style="${FIELDSET_STYLE}">
    <input name="sku" value="A1" autofocus>
    <input name="qty" value="1">
    <button type="submit" id="submit">Add</button>
    <button type="submit" form="f" id="formbutton">Add (form=)</button>
  </fieldset>
</form>
<p>after</p>
</body></html>`

let server: Server
let base = ''
let submissions = 0

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/submitted') {
      submissions++
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end('<p id="done">submitted</p>')
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(page(req.url !== '/control'))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})
test.beforeEach(() => {
  submissions = 0
})

async function settle(p: Page) {
  await p.waitForTimeout(400)
}

async function expectNotSubmitted(p: Page) {
  await settle(p)
  expect(submissions).toBe(0)
  expect(new URL(p.url()).pathname).toBe('/')
}

test('autofocus does not focus a field in a disabled fieldset', async ({
  page: p,
}) => {
  await p.goto(base + '/')
  await settle(p)
  const focused = await p.evaluate(() => document.activeElement?.tagName)
  expect(focused === 'BODY' || focused === undefined).toBe(true)
})

test('Enter on the body does not submit', async ({ page: p }) => {
  await p.goto(base + '/')
  await p.keyboard.press('Enter')
  await expectNotSubmitted(p)
})

test('Tab x5 then Enter does not submit', async ({ page: p }) => {
  await p.goto(base + '/')
  for (let i = 0; i < 5; i++) await p.keyboard.press('Tab')
  await p.keyboard.press('Enter')
  await p.keyboard.press('Space')
  await expectNotSubmitted(p)
})

test('clicking a field then Enter does not submit', async ({ page: p }) => {
  await p.goto(base + '/')
  const box = (await p.locator('input[name="sku"]').boundingBox())!
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await p.keyboard.press('Enter')
  await expectNotSubmitted(p)
})

test('clicking the submit button and a <button form=…> does not submit', async ({
  page: p,
}) => {
  await p.goto(base + '/')
  for (const id of ['#submit', '#formbutton']) {
    const box = (await p.locator(id).boundingBox())!
    await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  }
  await expectNotSubmitted(p)
})

test('control: without disabled, autofocus + Enter does submit', async ({
  page: p,
}) => {
  await p.goto(base + '/control')
  await settle(p)
  expect(
    await p.evaluate(() => document.activeElement?.getAttribute('name'))
  ).toBe('sku')
  await p.keyboard.press('Enter')
  await p.waitForURL('**/submitted')
  expect(submissions).toBe(1)
})

test('control: without disabled, a <button form=…> click does submit', async ({
  page: p,
}) => {
  await p.goto(base + '/control')
  const box = (await p.locator('#formbutton').boundingBox())!
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await p.waitForURL('**/submitted')
  expect(submissions).toBe(1)
})
