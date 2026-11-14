import { cookies } from 'next/headers';
import {
  REMOTES,
  hostKeys,
  mintFor,
  type RemoteName,
} from '../../../../lib/federation';

// Host routes the user creates: JWKS for remotes, token endpoint for islands (design §9a).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ nf: string[] }> },
) {
  const { nf } = await params;
  if (nf[0] !== 'jwks' || !request.headers)
    return new Response(null, { status: 404 });
  return Response.json((await hostKeys()).publicJwks);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ nf: string[] }> },
) {
  const { nf } = await params;
  if (nf[0] !== 'token') return new Response(null, { status: 404 });
  const aud = new URL(request.url).searchParams.get('aud');
  if (!aud || !Object.hasOwn(REMOTES, aud))
    return new Response(null, { status: 400 });
  const sub = (await cookies()).get('nf-user')?.value;
  if (!sub) return new Response(null, { status: 401 });
  return Response.json(
    { token: await mintFor(aud as RemoteName, sub) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
