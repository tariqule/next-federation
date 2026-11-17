// The island SSR entry renders with react-dom/server.edge: a <form> with a
// function action makes React emit its form-replay script. The island
// handler must recognise this React's copy exactly (removed, no NF-018).
import { stripIslandHtml } from '@next-federation/server'
import { createElement } from 'react'
import { renderToReadableStream } from 'react-dom/server.edge'
import { version } from 'react-dom'

async function render(node: ReturnType<typeof createElement>) {
  const stream = await renderToReadableStream(node)
  await stream.allReady
  return new Response(stream).text()
}

test(`react-dom ${version}'s form-replay script is removed and recognised`, async () => {
  const html = await render(
    createElement(
      'form',
      { action: async () => {} },
      createElement('button', null, 'go')
    )
  )
  expect(html).toContain('<script>')
  const r = stripIslandHtml(html)
  expect(r.html).not.toContain('<script')
  expect(r.removed).toEqual([
    { tag: 'script', attrs: '', known: 'react-form-replay' },
  ])
})
