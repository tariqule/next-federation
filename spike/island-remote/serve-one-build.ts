// Runs one remote build's server (its rsc entry: a Web Request → Response handler) on an
// internal port. Started by serve-versions.ts, one process per build.
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [dir, portArg] = process.argv.slice(2);
const port = Number(portArg);
const { default: handler } = (await import(
  pathToFileURL(join(dir!, 'rsc', 'index.js')).href
)) as {
  default: (request: Request) => Promise<Response>;
};

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers))
    if (typeof v === 'string') headers.set(k, v);
  const hasBody =
    req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0;
  const response = await handler(
    new Request(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method,
      headers,
      body: hasBody ? Buffer.concat(chunks) : undefined,
    }),
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, '127.0.0.1', () => process.send?.('ready'));
