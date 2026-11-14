// Self-hosted production setup for a remote that keeps every build online (design §6
// "Build pinning and deploy skew"). Each build's server runs in ITS OWN process, because
// plugin-rsc's server runtime keeps process-wide state; this router fronts them:
//   /b/<build>/assets/*   static assets of that build (never deleted on redeploy)
//   /b/<build>/_nf/*      that build's island and action handlers (build-pinned actions)
//   /_nf/*                the current build; `?build=<id>` picks another one (test hook that
//                         stands in for an island response cached before the redeploy)
import { fork } from 'node:child_process';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT ?? 4100);
const ROOT = join(
  import.meta.dirname,
  'dist',
  `${process.env.NF_REMOTE ?? 'a'}-versions`,
);
const builds = readdirSync(ROOT).sort();
const current = process.env.NF_CURRENT ?? builds.at(-1)!;

// One child process per build, on internal ports.
const backends = new Map<string, number>();
await Promise.all(
  builds.map(
    (id, i) =>
      new Promise<void>((resolve, reject) => {
        const port = PORT + 50 + i;
        const child = fork(join(import.meta.dirname, 'serve-one-build.ts'), [
          join(ROOT, id),
          String(port),
        ]);
        child.once('message', () => resolve());
        child.once('exit', (code) =>
          reject(new Error(`build ${id} exited (${code})`)),
        );
        process.once('exit', () => child.kill());
        backends.set(id, port);
      }),
  ),
);

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
};

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const pinned = /^\/b\/([^/]+)(\/.*)$/.exec(url.pathname);
  const build = pinned
    ? pinned[1]!
    : (url.searchParams.get('build') ?? current);
  const path = pinned ? pinned[2]! : url.pathname;

  if (pinned && path.startsWith('/assets/')) {
    const dir = join(ROOT, build, 'client');
    const file = normalize(join(dir, path));
    if (
      !file.startsWith(dir) ||
      !existsSync(file) ||
      !statSync(file).isFile()
    ) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'access-control-allow-origin': '*', // public, immutable build assets
      'cache-control': 'public, max-age=31536000, immutable',
    });
    createReadStream(file).pipe(res);
    return;
  }

  const port = backends.get(build);
  if (!port) {
    res.writeHead(404).end(`unknown build: ${build}`);
    return;
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers))
    if (typeof v === 'string') headers.set(k, v);
  const upstream = await fetch(`http://127.0.0.1:${port}${path}${url.search}`, {
    method: req.method,
    headers,
    body: await readBody(req),
  });
  res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
  res.end(Buffer.from(await upstream.arrayBuffer()));
}).listen(PORT, '127.0.0.1', () => {
  console.log(
    `serving builds ${builds.join(', ')} (current ${current}) on ${PORT}`,
  );
});
