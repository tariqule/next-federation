import { createFromReadableStream, getClientEntryUrl } from '@vitejs/plugin-rsc/ssr'
import { use, type ReactNode } from 'react'
import { renderToReadableStream } from 'react-dom/server.edge'

// RSC stream → HTML for one island. No document shell: the host embeds this fragment.
export async function renderHtml(rsc: ReadableStream<Uint8Array>, identifierPrefix: string): Promise<string> {
  const payload = createFromReadableStream<ReactNode>(rsc)
  function Root() {
    return use(payload)
  }
  const stream = await renderToReadableStream(<Root />, { identifierPrefix })
  await stream.allReady
  return new Response(stream).text()
}

export function clientEntryUrl(): string {
  return getClientEntryUrl()
}
