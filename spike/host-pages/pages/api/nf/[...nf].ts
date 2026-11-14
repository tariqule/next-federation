import type { NextApiRequest, NextApiResponse } from 'next';
import {
  REMOTES,
  hostKeys,
  mintFor,
  type RemoteName,
} from '../../../lib/federation';

// Host routes the user creates: JWKS for remotes, token endpoint for islands (design §9a).
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const [route] = (req.query.nf as string[]) ?? [];
  if (req.method === 'GET' && route === 'jwks') {
    return res.json((await hostKeys()).publicJwks);
  }
  if (req.method === 'POST' && route === 'token') {
    const aud = String(req.query.aud ?? '');
    if (!Object.hasOwn(REMOTES, aud)) return res.status(400).end();
    const sub = req.cookies['nf-user'];
    if (!sub) return res.status(401).end();
    res.setHeader('cache-control', 'no-store');
    return res.json({ token: await mintFor(aud as RemoteName, sub) });
  }
  res.status(404).end();
}
