import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { Form } from '../src/form.tsx'
import * as clientEntry from '../src/index.client.ts'
import * as serverEntry from '../src/index.server.ts'
import { requireIdentity as serverRequireIdentity } from '@next-federation/server'
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const tree = (action = rs.fn()) => (
  <Form action={action} id="f" className="cart">
    <input name="sku" defaultValue="A1" autoFocus />
    <button type="submit">Add</button>
  </Form>
)

test('server-rendered markup has the fields inside a disabled, borderless fieldset', () => {
  const html = renderToString(tree())
  const host = document.createElement('div')
  host.innerHTML = html
  const form = host.querySelector('form')!
  expect(form.id).toBe('f')
  expect(form.className).toBe('cart')
  const fieldset = form.querySelector(':scope > fieldset')!
  expect(fieldset).not.toBeNull()
  expect(fieldset.hasAttribute('disabled')).toBe(true)
  expect(fieldset.getAttribute('style')).toMatch(/border:\s*0/)
  expect(fieldset.querySelector('input[name="sku"]')).not.toBeNull()
  expect(fieldset.querySelector('button[type="submit"]')).not.toBeNull()
})

test('the fieldset is enabled once the root has committed', async () => {
  const container = document.createElement('div')
  container.innerHTML = renderToString(tree())
  document.body.appendChild(container)
  const fieldset = container.querySelector('fieldset')!
  expect(fieldset.disabled).toBe(true)
  let root!: Root
  await act(async () => {
    root = hydrateRoot(container, tree())
  })
  expect(container.querySelector('fieldset')).toBe(fieldset)
  expect(fieldset.disabled).toBe(false)
  await act(async () => root.unmount())
  container.remove()
})

test('disabled stays in force after hydration when the caller asks for it', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const node = (
    <Form action={rs.fn()} disabled>
      <button>x</button>
    </Form>
  )
  container.innerHTML = renderToString(node)
  let root!: Root
  await act(async () => {
    root = hydrateRoot(container, node)
  })
  expect(container.querySelector('fieldset')!.disabled).toBe(true)
  await act(async () => root.unmount())
  container.remove()
})

test('Form and requireIdentity are exported from both entries', () => {
  expect(clientEntry.Form).toBe(Form)
  expect(serverEntry.Form).toBe(Form)
  expect(serverEntry.requireIdentity).toBe(serverRequireIdentity)
  // The client entry marks with the same global symbol, so types and behaviour agree.
  const fn = clientEntry.requireIdentity(async () => 1)
  expect(
    (fn as unknown as Record<symbol, unknown>)[
      Symbol.for('next-federation.requires-identity')
    ]
  ).toBe(true)
})
