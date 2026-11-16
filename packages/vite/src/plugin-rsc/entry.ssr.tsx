// The remote's `ssr` entry: turns one island's RSC stream into an HTML
// fragment (no document shell; the host embeds it).
import { BridgeProvider, serverBridge } from '@next-federation/island'
import type { HostContext } from '@next-federation/protocol'
import {
  createFromReadableStream,
  getClientEntryUrl,
} from '@vitejs/plugin-rsc/ssr'
import { use } from 'react'
import type { ReactNode } from 'react'
import { renderToReadableStream } from 'react-dom/server.edge'

export async function renderIslandHtml(
  rsc: ReadableStream<Uint8Array>,
  options: { identifierPrefix: string; host: HostContext }
): Promise<string> {
  const payload = createFromReadableStream<ReactNode>(rsc)
  function Root(): ReactNode {
    return use(payload)
  }
  const stream = await renderToReadableStream(
    <BridgeProvider value={serverBridge(options.host)}>
      <Root />
    </BridgeProvider>,
    { identifierPrefix: options.identifierPrefix }
  )
  await stream.allReady
  return new Response(stream).text()
}

/** The built client entry (the island bootstrap) URL. */
export function clientEntryUrl(): string {
  return getClientEntryUrl()
}
