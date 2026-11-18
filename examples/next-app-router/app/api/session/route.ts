// DEMO ONLY: "signs in" whoever is named in the form, with a plain cookie and
// no password. Use your real authentication; next-federation only needs
// getIdentity() (lib/federation.ts) to return the signed-in user.
export async function POST(request: Request) {
  const form = await request.formData()
  const user = String(form.get('user') ?? '')
    .replace(/[^\w-]/g, '')
    .slice(0, 32)
  const response = new Response(null, {
    status: 303,
    headers: { Location: '/orders' },
  })
  // Secure over https (always on Vercel); plain http stays usable locally.
  const secure =
    new URL(request.url).protocol === 'https:' || process.env.VERCEL
      ? '; Secure'
      : ''
  const cookie = user
    ? `demo-user=${user}; Path=/; HttpOnly; SameSite=Lax${secure}`
    : `demo-user=; Path=/; Max-Age=0${secure}`
  response.headers.append('Set-Cookie', cookie)
  return response
}
