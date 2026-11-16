// Runs ONE build's server (its rsc entry: a Web Request -> Response handler) in this
// process. Forked once per live build by serve-builds.ts, because plugin-rsc's server
// runtime keeps process-wide state. Reports its ephemeral port to the parent.
import { createServer } from 'node:http'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { toNodeListener } from './listener.ts'

const dir = process.argv[2]
if (!dir || !process.send) {
  process.exit(2)
}
const { default: handler } = (await import(
  pathToFileURL(join(dir, 'rsc', 'index.js')).href
)) as { default: (request: Request) => Promise<Response> }

const server = createServer(toNodeListener(handler))
server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  process.send?.({
    port: typeof address === 'object' && address ? address.port : 0,
  })
})
process.on('disconnect', () => process.exit(0))
